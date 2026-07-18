import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const metadata = await readJson("../src/lib/mcp-metadata.json");
const card = await readJson("../public/.well-known/mcp.json");
const catalog = await readJson("../public/.well-known/mcp/catalog.json");

assert.match(metadata.serverName, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
assert.match(metadata.serverVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.ok(
  metadata.serverDescription.length > 0 &&
    metadata.serverDescription.length <= 100
);
for (const url of [
  metadata.siteUrl,
  metadata.repository.url,
  metadata.icon.src,
  metadata.remote.url,
  metadata.serverCardUrl,
  metadata.compatibilityServerCardUrl,
  metadata.catalogUrl,
]) {
  new URL(url);
}
assert.equal(metadata.serverCardUrl, `${metadata.remote.url}/server-card`);
assert.equal(
  metadata.compatibilityServerCardUrl,
  `${metadata.siteUrl}/.well-known/mcp.json`
);

const supportedProtocolVersions = [
  metadata.protocolVersions.primary.version,
  metadata.protocolVersions.compatibility.version,
];
const expectedCard = {
  $schema: metadata.serverCardSchema,
  name: metadata.serverName,
  title: metadata.serverTitle,
  description: metadata.serverDescription,
  version: metadata.serverVersion,
  websiteUrl: metadata.siteUrl,
  repository: metadata.repository,
  icons: [metadata.icon],
  remotes: [
    {
      ...metadata.remote,
      supportedProtocolVersions,
    },
  ],
};
const expectedCatalog = {
  specVersion: metadata.catalogSpecVersion,
  entries: [
    {
      identifier: metadata.catalogIdentifier,
      type: metadata.serverCardMediaType,
      url: metadata.serverCardUrl,
    },
  ],
};

assert.deepEqual(card, expectedCard);
assert.deepEqual(catalog, expectedCatalog);

console.log("MCP Server Card and Catalog metadata are valid.");
