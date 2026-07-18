import { z } from 'zod';
import { DATA_URL } from './constants.js';

const booleanRecordSchema = z.record(z.string().min(1), z.boolean());
const serviceSchema = z.object({
  serviceName: z.string().trim().min(1),
  azure: booleanRecordSchema,
  azureGovernment: booleanRecordSchema
});

const datasetSchema = z.object({
  schemaVersion: z.string().min(1),
  generatedAt: z.string().min(1),
  lastCheck: z.string().min(1),
  lastSync: z.string().min(1),
  sourceDescription: z.string().min(1),
  frameworks: z.array(z.string().min(1)).min(1),
  clouds: z.array(z.string().min(1)).min(1),
  disclaimer: z.string().min(1),
  services: z.array(serviceSchema).min(1)
});

export type ComplianceRecord = Record<string, boolean>;
export type ComplianceService = z.infer<typeof serviceSchema>;
export type ComplianceDataset = z.infer<typeof datasetSchema>;
export type CloudKey = 'azure' | 'azureGovernment';

export interface Framework {
  key: string;
  name: string;
}

export interface ComplianceDataProvider {
  getData(): Promise<ComplianceDataset>;
}

export class ComplianceDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ComplianceDataError';
  }
}

export function validateDataset(input: unknown): ComplianceDataset {
  const result = datasetSchema.safeParse(input);
  if (!result.success) {
    throw new ComplianceDataError(`Dataset validation failed: ${z.prettifyError(result.error)}`);
  }

  const data = result.data;
  if (new Set(data.frameworks).size !== data.frameworks.length) {
    throw new ComplianceDataError('Dataset validation failed: framework names must be unique.');
  }

  const first = data.services[0];
  if (!first) {
    throw new ComplianceDataError('Dataset validation failed: at least one service is required.');
  }

  const expectedKeys = Object.keys(first.azure);
  if (expectedKeys.length !== data.frameworks.length) {
    throw new ComplianceDataError(
      `Dataset validation failed: ${data.frameworks.length} framework names do not match ${expectedKeys.length} framework keys.`
    );
  }

  const expectedKeySet = new Set(expectedKeys);
  const serviceNames = new Set<string>();
  for (const service of data.services) {
    const normalizedName = service.serviceName.toLocaleLowerCase('en-US');
    if (serviceNames.has(normalizedName)) {
      throw new ComplianceDataError(
        `Dataset validation failed: duplicate service name "${service.serviceName}".`
      );
    }
    serviceNames.add(normalizedName);

    for (const cloud of ['azure', 'azureGovernment'] as const) {
      const keys = Object.keys(service[cloud]);
      if (
        keys.length !== expectedKeys.length ||
        keys.some((key) => !expectedKeySet.has(key))
      ) {
        throw new ComplianceDataError(
          `Dataset validation failed: service "${service.serviceName}" has inconsistent ${cloud} framework keys.`
        );
      }
    }
  }

  return data;
}

export function getFrameworks(data: ComplianceDataset): Framework[] {
  const keys = Object.keys(data.services[0]?.azure ?? {});
  return data.frameworks.map((name, index) => ({
    key: keys[index] as string,
    name
  }));
}

export interface HttpComplianceDataProviderOptions {
  dataUrl?: string;
  ttlMs?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class HttpComplianceDataProvider implements ComplianceDataProvider {
  readonly dataUrl: string;
  readonly ttlMs: number;
  readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private cached?: { data: ComplianceDataset; expiresAt: number };
  private pending: Promise<ComplianceDataset> | undefined;

  constructor(options: HttpComplianceDataProviderOptions = {}) {
    this.dataUrl = options.dataUrl ?? DATA_URL;
    this.ttlMs = boundedInteger(options.ttlMs ?? 300_000, 1_000, 3_600_000, 'cache TTL');
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 15_000, 1_000, 60_000, 'fetch timeout');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getData(): Promise<ComplianceDataset> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.data;
    }
    if (this.pending) {
      return this.pending;
    }

    this.pending = this.fetchAndValidate();
    try {
      const data = await this.pending;
      this.cached = { data, expiresAt: Date.now() + this.ttlMs };
      return data;
    } finally {
      this.pending = undefined;
    }
  }

  private async fetchAndValidate(): Promise<ComplianceDataset> {
    let response: Response;
    try {
      response = await this.fetchFn(this.dataUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new ComplianceDataError(`Failed to fetch compliance data from ${this.dataUrl}.`, {
        cause: error
      });
    }

    if (!response.ok) {
      throw new ComplianceDataError(
        `Failed to fetch compliance data from ${this.dataUrl}: HTTP ${response.status}.`
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ComplianceDataError('Compliance data response was not valid JSON.', {
        cause: error
      });
    }
    return validateDataset(body);
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
