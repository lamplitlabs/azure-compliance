# Azure Compliance MCP

Read-only MCP service for the public [Azure Compliance](https://azure-compliance.bitesinbyte.com) dataset.

## Local development

Requires Node.js 22.

```bash
npm ci
npm run dev
npm test
npm run build
npm start
```

The server listens on `PORT` (default `8080`). Its MCP connection URL is:

```text
http://localhost:8080/mcp
```

Production clients connect directly to:

```text
https://azure-compliance-mcp.purplefield-872ca910.germanywestcentral.azurecontainerapps.io/mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "azure-compliance": {
      "type": "http",
      "url": "https://azure-compliance-mcp.purplefield-872ca910.germanywestcentral.azurecontainerapps.io/mcp"
    }
  }
}
```

## Environment

| Variable | Default |
| --- | --- |
| `PORT` | `8080` |
| `HOST` | `127.0.0.1` locally; `0.0.0.0` when `NODE_ENV=production` |
| `MCP_PUBLIC_URL` | Production MCP endpoint shown above |
| `DATA_URL` | `https://azure-compliance.bitesinbyte.com/data/azure-compliance.json` |
| `DATA_CACHE_TTL_MS` | `300000` (bounded to 1 second–1 hour) |
| `DATA_FETCH_TIMEOUT_MS` | `15000` (bounded to 1–60 seconds) |
| `ALLOWED_ORIGINS` | Production website and common localhost development origins |
| `ALLOWED_HOSTS` | Production Container App hostname and loopback hostnames |

`ALLOWED_ORIGINS` contains comma-separated exact origins. `ALLOWED_HOSTS` contains
comma-separated hostnames without ports. Requests without an `Origin` header are allowed for
native MCP clients.

## Docker

```bash
docker build -t azure-compliance-mcp .
docker run --rm -p 8080:8080 azure-compliance-mcp
```

The image uses Node 22, runs as the non-root `node` user, and checks `/healthz`.

## Discovery metadata

Server Cards and MCP Catalogs are **experimental discovery metadata**, not connection URLs:

- `GET /mcp/server-card`
- `GET /.well-known/mcp/catalog.json`
- `GET /.well-known/mcp.json` (compatibility Server Card representation)

The MCP endpoint itself is `/mcp`. Health is available at `GET /healthz`.

Run a live dual-protocol check with:

```bash
npm run smoke -- https://example.com/mcp
```
