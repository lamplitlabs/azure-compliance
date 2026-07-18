import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ALLOWED_ORIGINS } from './constants.js';
import { HttpComplianceDataProvider } from './data.js';
import { createHttpService } from './http.js';

const port = envInteger('PORT', 8080, 1, 65_535);
const defaultHost = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
const host = process.env.HOST?.trim() || defaultHost;
const provider = new HttpComplianceDataProvider({
  ...(process.env.DATA_URL ? { dataUrl: process.env.DATA_URL } : {}),
  ttlMs: envInteger('DATA_CACHE_TTL_MS', 300_000, 1_000, 3_600_000),
  timeoutMs: envInteger('DATA_FETCH_TIMEOUT_MS', 15_000, 1_000, 60_000)
});
const service = createHttpService({
  provider,
  allowedOrigins: csvEnv('ALLOWED_ORIGINS', [...DEFAULT_ALLOWED_ORIGINS]),
  allowedHosts: csvEnv('ALLOWED_HOSTS', [...DEFAULT_ALLOWED_HOSTS])
});

service.server.listen(port, host, () => {
  console.error(`Azure Compliance MCP listening on ${host}:${port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`Received ${signal}; shutting down.`);
  try {
    await service.close();
  } catch (error) {
    console.error('Graceful shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value.`);
  }
  return values;
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
