import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const endpoint = process.argv[2] || process.env.MCP_PUBLIC_URL;
if (!endpoint) {
  throw new Error("Pass the MCP endpoint URL as an argument or MCP_PUBLIC_URL.");
}

await verifyProtocol(
  "modern-smoke",
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  "2026-07-28"
);
await verifyProtocol("legacy-smoke", undefined, "2025-11-25");

console.log(`Modern and legacy MCP smoke checks passed for ${endpoint}.`);

async function verifyProtocol(name, clientOptions, expectedVersion) {
  const clientInfo = { name, version: "1.0.0" };
  const client = clientOptions
    ? new Client(clientInfo, clientOptions)
    : new Client(clientInfo);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));

  await client.connect(transport);
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), expectedVersion);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ["list_frameworks", "query_services", "get_service"]
    );

    const result = await client.callTool({
      name: "list_frameworks",
      arguments: {},
    });
    assert.notEqual(result.isError, true);
    assert.ok(
      Array.isArray(result.structuredContent?.frameworks) &&
        result.structuredContent.frameworks.length > 0
    );
  } finally {
    await client.close();
  }
}
