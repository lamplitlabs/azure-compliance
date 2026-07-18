import { McpServer, createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  DATA_URL,
  ICON_URL,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  WEBSITE_ORIGIN
} from './constants.js';
import type { ComplianceDataProvider } from './data.js';
import { getFrameworks } from './data.js';
import { getService, queryServices } from './query.js';

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const queryInputSchema = z
  .object({
    serviceName: z.string().trim().min(1).max(100).optional(),
    cloud: z.enum(['azure', 'azureGovernment']).optional(),
    frameworkKey: z.string().trim().min(1).max(100).optional(),
    compliant: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(25)
  })
  .strict()
  .refine((value) => value.compliant === undefined || value.frameworkKey !== undefined, {
    message: 'compliant requires frameworkKey.',
    path: ['compliant']
  });

const serviceInputSchema = z
  .object({
    serviceName: z.string().trim().min(1).max(200)
  })
  .strict();

export function createComplianceMcpHandler(provider: ComplianceDataProvider): McpHttpHandler {
  return createMcpHandler(
    () => {
      const server = new McpServer(
        {
          name: SERVER_NAME,
          title: SERVER_TITLE,
          version: SERVER_VERSION,
          description: SERVER_DESCRIPTION,
          websiteUrl: WEBSITE_ORIGIN,
          icons: [{ src: ICON_URL, mimeType: 'image/svg+xml', sizes: ['any'] }]
        },
        {
          supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
          instructions:
            'Use the read-only tools and resources to inspect Azure service compliance coverage.',
          cacheHints: {
            'tools/list': { ttlMs: 300_000, cacheScope: 'public' },
            'resources/list': { ttlMs: 300_000, cacheScope: 'public' },
            'resources/read': { ttlMs: 300_000, cacheScope: 'public' },
            'server/discover': { ttlMs: 300_000, cacheScope: 'public' }
          }
        }
      );

      server.registerResource(
        'azure-compliance-dataset',
        DATA_URL,
        {
          title: 'Complete Azure compliance dataset',
          description: 'The complete validated Azure compliance dataset as JSON.',
          mimeType: 'application/json',
          cacheHint: { ttlMs: 300_000, cacheScope: 'public' }
        },
        async (uri) => {
          try {
            const data = await provider.getData();
            return {
              contents: [
                {
                  uri: uri.href,
                  mimeType: 'application/json',
                  text: JSON.stringify(data)
                }
              ]
            };
          } catch (error) {
            throw dataError('Unable to read the Azure compliance dataset', error);
          }
        }
      );

      server.registerResource(
        'azure-compliance-metadata',
        'azure-compliance://metadata',
        {
          title: 'Azure compliance dataset metadata',
          description: 'Dataset timestamps, source details, clouds, and framework keys.',
          mimeType: 'application/json',
          cacheHint: { ttlMs: 300_000, cacheScope: 'public' }
        },
        async (uri) => {
          try {
            const data = await provider.getData();
            const metadata = {
              schemaVersion: data.schemaVersion,
              generatedAt: data.generatedAt,
              lastCheck: data.lastCheck,
              lastSync: data.lastSync,
              sourceDescription: data.sourceDescription,
              clouds: data.clouds,
              frameworks: getFrameworks(data),
              serviceCount: data.services.length,
              disclaimer: data.disclaimer
            };
            return {
              contents: [
                {
                  uri: uri.href,
                  mimeType: 'application/json',
                  text: JSON.stringify(metadata)
                }
              ]
            };
          } catch (error) {
            throw dataError('Unable to read Azure compliance metadata', error);
          }
        }
      );

      server.registerTool(
        'list_frameworks',
        {
          title: 'List compliance frameworks',
          description: 'List valid framework keys and display names for subsequent queries.',
          inputSchema: z.object({}).strict(),
          annotations: readOnlyAnnotations
        },
        async () =>
          withToolErrors(async () => {
            const data = await provider.getData();
            const output = { frameworks: getFrameworks(data) };
            return toolResult(
              output,
              `${output.frameworks.length} frameworks: ${output.frameworks
                .map((framework) => `${framework.key} (${framework.name})`)
                .join(', ')}`
            );
          })
      );

      server.registerTool(
        'query_services',
        {
          title: 'Query Azure services',
          description:
            'Search services by name and optionally filter a framework result by cloud and compliance value.',
          inputSchema: queryInputSchema,
          annotations: readOnlyAnnotations
        },
        async (input) =>
          withToolErrors(async () => {
            const data = await provider.getData();
            const output = queryServices(data, input);
            const names = output.services.map((service) => service.serviceName).join(', ');
            return toolResult(
              output,
              `${output.totalMatches} match(es); returned ${output.returned}${
                output.truncated ? ' (truncated)' : ''
              }.${names ? ` Services: ${names}` : ''}`
            );
          })
      );

      server.registerTool(
        'get_service',
        {
          title: 'Get Azure service compliance',
          description:
            'Get complete compliance data for one service using exact match first, then an unambiguous substring.',
          inputSchema: serviceInputSchema,
          annotations: readOnlyAnnotations
        },
        async ({ serviceName }) =>
          withToolErrors(async () => {
            const data = await provider.getData();
            const output = getService(data, serviceName);
            if (output.status === 'found') {
              return toolResult(
                output,
                `Found ${output.service.serviceName} by ${output.matchType} match.`
              );
            }
            if (output.status === 'ambiguous') {
              return toolResult(
                output,
                `Ambiguous service name "${output.query}". Candidates: ${output.candidates.join(', ')}.`,
                true
              );
            }
            return toolResult(output, `No service found for "${output.query}".`, true);
          })
      );

      return server;
    },
    {
      legacy: 'stateless',
      responseMode: 'auto',
      onerror: (error) => console.error('MCP handler error:', error)
    }
  );
}

function toolResult(structuredContent: object, text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
    ...(isError ? { isError: true } : {})
  };
}

async function withToolErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown compliance data error.';
    return {
      content: [{ type: 'text' as const, text: message }],
      structuredContent: { error: message },
      isError: true
    };
  }
}

function dataError(prefix: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : 'Unknown error.';
  return new Error(`${prefix}: ${detail}`, { cause: error });
}
