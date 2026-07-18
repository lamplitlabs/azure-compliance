import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  hostHeaderValidation,
  toNodeHandler,
  type NodeIncomingMessageLike
} from '@modelcontextprotocol/node';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_ALLOWED_ORIGINS,
  SERVER_VERSION
} from './constants.js';
import type { ComplianceDataProvider } from './data.js';
import { createComplianceMcpHandler } from './mcp.js';
import {
  catalogDocument,
  type MetadataDocument,
  serverCardDocument
} from './metadata.js';

export interface HttpServiceOptions {
  provider: ComplianceDataProvider;
  allowedOrigins?: string[];
  allowedHosts?: string[];
}

export interface AzureComplianceHttpService {
  server: Server;
  handler: McpHttpHandler;
  close(): Promise<void>;
}

export function createHttpService(options: HttpServiceOptions): AzureComplianceHttpService {
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS]).map(normalizeConfiguredOrigin)
  );
  const allowedHosts = options.allowedHosts ?? [...DEFAULT_ALLOWED_HOSTS];
  const validateHost = hostHeaderValidation(allowedHosts);
  const handler = createComplianceMcpHandler(options.provider);
  const nodeHandler = toNodeHandler(
    {
      fetch: async (request, handlerOptions) => {
        const response = await handler.fetch(request, handlerOptions);
        const origin = request.headers.get('origin');
        if (origin && isAllowedOrigin(origin, allowedOrigins)) {
          response.headers.set('Access-Control-Allow-Origin', origin);
          response.headers.append('Vary', 'Origin');
          response.headers.set(
            'Access-Control-Expose-Headers',
            'Mcp-Protocol-Version, Mcp-Session-Id'
          );
        }
        return response;
      }
    },
    { onerror: (error) => console.error('Node MCP adapter error:', error) }
  );

  const server = createServer((request, response) => {
    void routeRequest(request, response, {
      allowedOrigins,
      validateHost,
      nodeHandler
    }).catch((error: unknown) => {
      console.error('HTTP request error:', error);
      if (!response.headersSent) {
        writeJson(response, 500, { error: 'Internal server error.' }, { 'Cache-Control': 'no-store' });
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });

  return {
    server,
    handler,
    async close() {
      await handler.close();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

interface RouteContext {
  allowedOrigins: Set<string>;
  validateHost: ReturnType<typeof hostHeaderValidation>;
  nodeHandler: ReturnType<typeof toNodeHandler>;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (request.method === 'GET' && pathname === '/healthz') {
    writeJson(
      response,
      200,
      { status: 'ok', service: 'azure-compliance-mcp', version: SERVER_VERSION },
      { 'Cache-Control': 'no-store' }
    );
    return;
  }

  if (request.method === 'GET' && pathname === '/mcp/server-card') {
    writeMetadata(request, response, serverCardDocument);
    return;
  }

  if (request.method === 'GET' && pathname === '/.well-known/mcp/catalog.json') {
    writeMetadata(request, response, catalogDocument);
    return;
  }

  if (request.method === 'GET' && pathname === '/.well-known/mcp.json') {
    writeMetadata(request, response, serverCardDocument);
    return;
  }

  if (pathname === '/mcp') {
    if (!context.validateHost(request, response)) {
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(singleHeader(origin), context.allowedOrigins)) {
      writeJson(response, 403, { error: 'Origin not allowed.' }, { 'Cache-Control': 'no-store' });
      return;
    }
    if (request.method === 'OPTIONS') {
      const originValue = origin === undefined ? undefined : singleHeader(origin);
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          singleHeader(request.headers['access-control-request-headers']) ??
          'Accept, Content-Type, Last-Event-ID, Mcp-Protocol-Version, Mcp-Session-Id',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        Vary: 'Origin, Access-Control-Request-Headers'
      };
      if (originValue) {
        headers['Access-Control-Allow-Origin'] = originValue;
      }
      response.writeHead(204, headers);
      response.end();
      return;
    }
    await context.nodeHandler(request as unknown as NodeIncomingMessageLike, response);
    return;
  }

  writeJson(response, 404, { error: 'Not found.' }, { 'Cache-Control': 'no-store' });
}

function writeMetadata(
  request: IncomingMessage,
  response: ServerResponse,
  document: MetadataDocument
): void {
  const headers: Record<string, string> = {
    'Content-Type': document.contentType,
    'Content-Length': Buffer.byteLength(document.body).toString(),
    'Cache-Control': 'public, max-age=3600',
    ETag: document.etag,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    Vary: 'Accept'
  };
  if (request.headers['if-none-match'] === document.etag) {
    delete headers['Content-Length'];
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, headers);
  response.end(document.body);
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  additionalHeaders: Record<string, string> = {}
): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body).toString(),
    ...additionalHeaders
  });
  response.end(body);
}

function normalizeConfiguredOrigin(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError(`Invalid allowed origin "${value}".`);
  }
  return url.origin;
}

function isAllowedOrigin(value: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      allowedOrigins.has(url.origin)
    );
  } catch {
    return false;
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
