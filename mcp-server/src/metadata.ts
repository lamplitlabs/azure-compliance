import { createHash } from 'node:crypto';
import {
  ICON_URL,
  MCP_ENDPOINT,
  REPOSITORY_URL,
  SERVER_CARD_URL,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  WEBSITE_ORIGIN
} from './constants.js';

export const serverCard = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: SERVER_NAME,
  title: SERVER_TITLE,
  description: SERVER_DESCRIPTION,
  version: SERVER_VERSION,
  repository: {
    source: 'github',
    url: REPOSITORY_URL,
    subfolder: 'mcp-server'
  },
  websiteUrl: WEBSITE_ORIGIN,
  icons: [{ src: ICON_URL, mimeType: 'image/svg+xml', sizes: ['any'] }],
  remotes: [
    {
      type: 'streamable-http',
      url: MCP_ENDPOINT,
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS]
    }
  ]
} as const;

export const mcpCatalog = {
  specVersion: 'draft',
  entries: [
    {
      identifier: 'urn:air:bitesinbyte.com:azure-compliance',
      type: 'application/mcp-server-card+json',
      url: SERVER_CARD_URL
    }
  ]
} as const;

export interface MetadataDocument {
  body: string;
  etag: string;
  contentType: string;
}

export function metadataDocument(value: unknown, contentType: string): MetadataDocument {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
  return { body, etag, contentType };
}

export const serverCardDocument = metadataDocument(
  serverCard,
  'application/mcp-server-card+json; charset=utf-8'
);
export const catalogDocument = metadataDocument(mcpCatalog, 'application/json; charset=utf-8');
