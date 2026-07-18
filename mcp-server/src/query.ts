import type {
  CloudKey,
  ComplianceDataset,
  ComplianceService,
  Framework
} from './data.js';
import { getFrameworks } from './data.js';

export interface QueryServicesInput {
  serviceName?: string | undefined;
  cloud?: CloudKey | undefined;
  frameworkKey?: string | undefined;
  compliant?: boolean | undefined;
  limit: number;
}

export interface QueryServiceResult {
  serviceName: string;
  compliance?: Partial<Record<CloudKey, boolean>>;
}

export interface QueryServicesResult {
  totalMatches: number;
  returned: number;
  truncated: boolean;
  filters: Omit<QueryServicesInput, 'limit'> & { limit: number };
  services: QueryServiceResult[];
}

export type GetServiceResult =
  | { status: 'found'; matchType: 'exact' | 'substring'; service: ComplianceService }
  | { status: 'not_found'; query: string }
  | { status: 'ambiguous'; query: string; candidates: string[]; totalCandidates: number };

const compareNames = (left: ComplianceService, right: ComplianceService): number =>
  left.serviceName.localeCompare(right.serviceName, 'en-US', { sensitivity: 'base' });

export function assertFramework(data: ComplianceDataset, key: string): Framework {
  const framework = getFrameworks(data).find((candidate) => candidate.key === key);
  if (!framework) {
    const allowed = getFrameworks(data)
      .map((candidate) => candidate.key)
      .join(', ');
    throw new RangeError(`Unknown framework key "${key}". Allowed keys: ${allowed}.`);
  }
  return framework;
}

export function queryServices(
  data: ComplianceDataset,
  input: QueryServicesInput
): QueryServicesResult {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100.');
  }
  if (input.compliant !== undefined && input.frameworkKey === undefined) {
    throw new RangeError('compliant requires frameworkKey.');
  }
  if (input.frameworkKey !== undefined) {
    assertFramework(data, input.frameworkKey);
  }

  const needle = input.serviceName?.trim().toLocaleLowerCase('en-US');
  const clouds: CloudKey[] = input.cloud ? [input.cloud] : ['azure', 'azureGovernment'];
  const matches = data.services
    .filter((service) => {
      if (needle && !service.serviceName.toLocaleLowerCase('en-US').includes(needle)) {
        return false;
      }
      if (input.frameworkKey === undefined || input.compliant === undefined) {
        return true;
      }
      return clouds.some(
        (cloud) => service[cloud][input.frameworkKey as string] === input.compliant
      );
    })
    .sort(compareNames);

  const services = matches.slice(0, input.limit).map((service) => {
    if (input.frameworkKey === undefined) {
      return { serviceName: service.serviceName };
    }
    return {
      serviceName: service.serviceName,
      compliance: Object.fromEntries(
        clouds.map((cloud) => [cloud, service[cloud][input.frameworkKey as string]])
      ) as Partial<Record<CloudKey, boolean>>
    };
  });

  return {
    totalMatches: matches.length,
    returned: services.length,
    truncated: matches.length > services.length,
    filters: { ...input },
    services
  };
}

export function getService(data: ComplianceDataset, rawQuery: string): GetServiceResult {
  const query = rawQuery.trim();
  const normalized = query.toLocaleLowerCase('en-US');
  const sorted = [...data.services].sort(compareNames);
  const exact = sorted.filter(
    (service) => service.serviceName.toLocaleLowerCase('en-US') === normalized
  );

  if (exact.length === 1) {
    return { status: 'found', matchType: 'exact', service: exact[0] as ComplianceService };
  }
  if (exact.length > 1) {
    return ambiguous(query, exact);
  }

  const partial = sorted.filter((service) =>
    service.serviceName.toLocaleLowerCase('en-US').includes(normalized)
  );
  if (partial.length === 1) {
    return { status: 'found', matchType: 'substring', service: partial[0] as ComplianceService };
  }
  if (partial.length > 1) {
    return ambiguous(query, partial);
  }
  return { status: 'not_found', query };
}

function ambiguous(query: string, services: ComplianceService[]): GetServiceResult {
  return {
    status: 'ambiguous',
    query,
    candidates: services.slice(0, 20).map((service) => service.serviceName),
    totalCandidates: services.length
  };
}
