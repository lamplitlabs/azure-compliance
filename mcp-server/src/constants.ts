export const SERVER_NAME = 'com.bitesinbyte/azure-compliance';
export const SERVER_TITLE = 'Azure Compliance';
export const SERVER_VERSION = '1.0.0';
export const SERVER_DESCRIPTION =
  'Query Azure service compliance across 17 frameworks and Azure Government.';

const DEFAULT_MCP_ENDPOINT =
  'https://azure-compliance-mcp.purplefield-872ca910.germanywestcentral.azurecontainerapps.io/mcp';
export const MCP_ENDPOINT = normalizeHttpUrl(
  process.env.MCP_PUBLIC_URL?.trim() || DEFAULT_MCP_ENDPOINT,
  'MCP_PUBLIC_URL'
);
export const WEBSITE_ORIGIN = 'https://azure-compliance.bitesinbyte.com';
export const DATA_URL = `${WEBSITE_ORIGIN}/data/azure-compliance.json`;
export const ICON_URL = `${WEBSITE_ORIGIN}/icon.svg`;
export const REPOSITORY_URL = 'https://github.com/bitesinbyte/azure-compliance';
export const SERVER_CARD_URL = `${MCP_ENDPOINT}/server-card`;
export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25'] as const;

export const DEFAULT_ALLOWED_ORIGINS = [
  WEBSITE_ORIGIN,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:6274',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:6274',
  'http://127.0.0.1:8080'
] as const;

export const DEFAULT_ALLOWED_HOSTS = [
  'azure-compliance-mcp.purplefield-872ca910.germanywestcentral.azurecontainerapps.io',
  'localhost',
  '127.0.0.1',
  '[::1]'
] as const;

function normalizeHttpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(`${name} must be an HTTP(S) URL without credentials, query, or fragment.`);
  }
  return url.toString().replace(/\/+$/, '');
}
