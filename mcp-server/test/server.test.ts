import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ComplianceDataProvider, ComplianceDataset } from '../src/data.js';
import { HttpComplianceDataProvider, validateDataset } from '../src/data.js';
import { createHttpService, type AzureComplianceHttpService } from '../src/http.js';
import { getService, queryServices } from '../src/query.js';

const fixture: ComplianceDataset = validateDataset({
  schemaVersion: '2.0',
  generatedAt: '2026-07-18',
  lastCheck: '2026-07-18T00:00:00Z',
  lastSync: '2026-07-18T00:00:00Z',
  sourceDescription: 'Test data',
  frameworks: ['Framework One', 'Framework Two'],
  clouds: ['Azure', 'Azure Government'],
  disclaimer: 'Test data only.',
  services: [
    {
      serviceName: 'Azure Alpha',
      azure: { frameworkOne: true, frameworkTwo: false },
      azureGovernment: { frameworkOne: false, frameworkTwo: true }
    },
    {
      serviceName: 'Azure Alpha Extended',
      azure: { frameworkOne: false, frameworkTwo: false },
      azureGovernment: { frameworkOne: false, frameworkTwo: false }
    },
    {
      serviceName: 'Beta Service',
      azure: { frameworkOne: true, frameworkTwo: true },
      azureGovernment: { frameworkOne: true, frameworkTwo: false }
    }
  ]
});

const provider: ComplianceDataProvider = {
  async getData() {
    return fixture;
  }
};

describe('query behavior', () => {
  test('filters case-insensitively, by cloud and compliance, with deterministic limits', () => {
    const result = queryServices(fixture, {
      serviceName: 'azure',
      cloud: 'azureGovernment',
      frameworkKey: 'frameworkOne',
      compliant: false,
      limit: 1
    });

    assert.equal(result.totalMatches, 2);
    assert.equal(result.returned, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.services[0]?.serviceName, 'Azure Alpha');
    assert.deepEqual(result.services[0]?.compliance, { azureGovernment: false });
  });

  test('rejects invalid framework, limit, and detached compliance inputs', () => {
    assert.throws(
      () => queryServices(fixture, { frameworkKey: 'missing', limit: 10 }),
      /Unknown framework key/
    );
    assert.throws(() => queryServices(fixture, { limit: 0 }), /between 1 and 100/);
    assert.throws(() => queryServices(fixture, { limit: 101 }), /between 1 and 100/);
    assert.throws(
      () => queryServices(fixture, { compliant: true, limit: 10 }),
      /requires frameworkKey/
    );
  });

  test('resolves exact, unambiguous substring, ambiguous, and not-found services', () => {
    assert.equal(getService(fixture, 'azure alpha').status, 'found');
    assert.deepEqual(getService(fixture, 'Extended'), {
      status: 'found',
      matchType: 'substring',
      service: fixture.services[1]
    });
    assert.deepEqual(getService(fixture, 'Azure'), {
      status: 'ambiguous',
      query: 'Azure',
      candidates: ['Azure Alpha', 'Azure Alpha Extended'],
      totalCandidates: 2
    });
    assert.deepEqual(getService(fixture, 'missing'), {
      status: 'not_found',
      query: 'missing'
    });
  });
});

describe('data provider', () => {
  test('validates boolean records and caches successful fetches', async () => {
    let fetches = 0;
    const dataProvider = new HttpComplianceDataProvider({
      dataUrl: 'https://data.example/compliance.json',
      ttlMs: 1_000,
      fetchFn: async () => {
        fetches += 1;
        return Response.json(fixture);
      }
    });
    const first = await dataProvider.getData();
    assert.deepEqual(first, fixture);
    assert.equal(await dataProvider.getData(), first);
    assert.equal(fetches, 1);

    const invalid = structuredClone(fixture) as unknown as {
      services: Array<{ azure: Record<string, unknown> }>;
    };
    const firstService = invalid.services[0];
    assert.ok(firstService);
    firstService.azure.frameworkOne = 'yes';
    assert.throws(() => validateDataset(invalid), /Dataset validation failed/);
  });
});

describe('HTTP and MCP integration', () => {
  let service: AzureComplianceHttpService;
  let baseUrl: URL;

  before(async () => {
    service = createHttpService({
      provider,
      allowedOrigins: ['https://allowed.example'],
      allowedHosts: ['127.0.0.1']
    });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    const address = service.server.address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${address.port}`);
  });

  after(async () => {
    await service.close();
  });

  test('serves health and experimental metadata with stable ETags', async () => {
    const health = await fetch(new URL('/healthz', baseUrl));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      service: 'azure-compliance-mcp',
      version: '1.0.0'
    });

    const card = await fetch(new URL('/mcp/server-card', baseUrl));
    assert.equal(card.status, 200);
    assert.match(card.headers.get('content-type') ?? '', /^application\/mcp-server-card\+json/);
    assert.equal(card.headers.get('access-control-allow-origin'), '*');
    const etag = card.headers.get('etag');
    assert.ok(etag);
    const cardBody = (await card.json()) as Record<string, unknown>;
    assert.equal(cardBody.name, 'com.bitesinbyte/azure-compliance');
    assert.equal(cardBody.title, 'Azure Compliance');
    assert.equal('tools' in cardBody, false);
    assert.equal('resources' in cardBody, false);
    assert.deepEqual(
      (cardBody.remotes as Array<{ supportedProtocolVersions: string[] }>)[0]
        ?.supportedProtocolVersions,
      ['2026-07-28', '2025-11-25']
    );

    const notModified = await fetch(new URL('/mcp/server-card', baseUrl), {
      headers: { 'if-none-match': etag }
    });
    assert.equal(notModified.status, 304);

    const catalog = await fetch(new URL('/.well-known/mcp/catalog.json', baseUrl));
    const catalogBody = (await catalog.json()) as {
      specVersion: string;
      entries: Array<{ type: string; url: string }>;
    };
    assert.equal(catalogBody.specVersion, 'draft');
    assert.equal(catalogBody.entries[0]?.type, 'application/mcp-server-card+json');

    const compatibility = await fetch(new URL('/.well-known/mcp.json', baseUrl));
    assert.deepEqual(await compatibility.json(), cardBody);
  });

  test('rejects invalid origins and supports allowed browser preflight', async () => {
    const rejected = await fetch(new URL('/mcp', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    });
    assert.equal(rejected.status, 403);

    const preflight = await fetch(new URL('/mcp', baseUrl), {
      method: 'OPTIONS',
      headers: {
        origin: 'https://allowed.example',
        'access-control-request-headers': 'content-type,mcp-protocol-version'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://allowed.example');
  });

  test('negotiates modern 2026-07-28 and executes tools/resources', async () => {
    const client = new Client(
      { name: 'modern-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl));
    await client.connect(transport);
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name),
        ['list_frameworks', 'query_services', 'get_service']
      );
      assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true));

      const result = await client.callTool({
        name: 'list_frameworks',
        arguments: {}
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, {
        frameworks: [
          { key: 'frameworkOne', name: 'Framework One' },
          { key: 'frameworkTwo', name: 'Framework Two' }
        ]
      });

      const metadata = await client.readResource({ uri: 'azure-compliance://metadata' });
      assert.equal(metadata.contents.length, 1);
      const content = metadata.contents[0];
      assert.ok(content && 'text' in content);
      assert.match(content.text, /"serviceCount":3/);
    } finally {
      await client.close();
    }
  });

  test('uses the stateless 2025 fallback and validates MCP tool inputs', async () => {
    const client = new Client({ name: 'legacy-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl));
    await client.connect(transport);
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
      const result = await client.callTool({
        name: 'query_services',
        arguments: {
          cloud: 'azure',
          frameworkKey: 'frameworkOne',
          compliant: true,
          limit: 10
        }
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(
        (
          result.structuredContent as {
            services: Array<{ serviceName: string }>;
          }
        ).services.map((item) => item.serviceName),
        ['Azure Alpha', 'Beta Service']
      );

      const badFramework = await client.callTool({
        name: 'query_services',
        arguments: { frameworkKey: 'missing', limit: 10 }
      });
      assert.equal(badFramework.isError, true);
      assert.match(JSON.stringify(badFramework.structuredContent), /Unknown framework key/);

      const badLimit = await client.callTool({
        name: 'query_services',
        arguments: { limit: 101 }
      });
      assert.equal(badLimit.isError, true);
      assert.match(JSON.stringify(badLimit.content), /<=100/);
    } finally {
      await client.close();
    }
  });

  test('surfaces provider failures through tools and resources', async () => {
    const failingService = createHttpService({
      provider: {
        async getData() {
          throw new Error('upstream unavailable');
        }
      },
      allowedHosts: ['127.0.0.1']
    });
    await new Promise<void>((resolve) => failingService.server.listen(0, '127.0.0.1', resolve));
    const address = failingService.server.address() as AddressInfo;
    const client = new Client({ name: 'failure-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const tool = await client.callTool({ name: 'list_frameworks', arguments: {} });
      assert.equal(tool.isError, true);
      assert.match(JSON.stringify(tool.content), /upstream unavailable/);
      await assert.rejects(
        client.readResource({ uri: 'azure-compliance://metadata' }),
        /upstream unavailable/
      );
    } finally {
      await client.close();
      await failingService.close();
    }
  });
});
