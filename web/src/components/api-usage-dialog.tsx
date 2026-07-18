"use client";

import { useState } from "react";
import { Check, Copy, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DATA_API_URL,
  MCP_CATALOG_URL,
  MCP_CLIENT_CONFIG_EXAMPLE,
  MCP_COMPATIBILITY_PROTOCOL,
  MCP_COMPATIBILITY_SERVER_CARD_URL,
  MCP_ENDPOINT_URL,
  MCP_PRIMARY_PROTOCOL,
  MCP_SERVER_CARD_URL,
  SITE_URL,
} from "@/lib/constants";

interface CodeBlockProps {
  code: string;
  language?: string;
}

function CodeBlock({ code, language = "bash" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="group relative rounded-lg border bg-muted/50">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ApiUsageDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="lg" className="gap-2" />
        }
      >
        <BookOpen className="h-4 w-4" />
        API Usage
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>API, MCP &amp; Query Usage</DialogTitle>
          <DialogDescription>
            Use the JSON endpoint, remote MCP server, or URL query parameters
            to integrate compliance data into your workflows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* JSON API */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">JSON Endpoint</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Fetch the full compliance dataset as JSON. Updated weekly.
            </p>
            <CodeBlock code={DATA_API_URL} />
          </section>

          {/* Fetch examples */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Fetch with cURL</h3>
            <CodeBlock code={`curl -s ${DATA_API_URL} | jq '.services | length'`} />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Fetch with JavaScript
            </h3>
            <CodeBlock
              language="javascript"
              code={`const res = await fetch(
  "${DATA_API_URL}"
);
const data = await res.json();

// Find HIPAA-compliant Azure services
const hipaaServices = data.services.filter(
  (s) => s.azure.hipaaBaa
);
console.log(hipaaServices.map((s) => s.serviceName));`}
            />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Fetch with Python</h3>
            <CodeBlock
              language="python"
              code={`import requests

data = requests.get(
    "${DATA_API_URL}"
).json()

# Services with SOC 1,2,3 on Azure Government
soc_gov = [
    s["serviceName"]
    for s in data["services"]
    if s["azureGovernment"]["soc1_2_3"]
]
print(soc_gov)`}
            />
          </section>

          {/* JSON Structure */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">JSON Structure</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Each service entry contains compliance booleans for both Azure and
              Azure Government.
            </p>
            <CodeBlock
              language="json"
              code={`{
  "schemaVersion": "2.0",
  "generatedAt": "2026-04-13",
  "lastCheck": "2026-04-13T04:44:18Z",
  "lastSync": "2026-04-13T04:44:18Z",
  "frameworks": ["CSA STAR Certification", ...],
  "clouds": ["Azure", "Azure Government"],
  "services": [
    {
      "serviceName": "Azure Cosmos DB",
      "azure": {
        "hipaaBaa": true,
        "pciDss": true,
        "soc1_2_3": true,
        ...
      },
      "azureGovernment": {
        "hipaaBaa": true,
        ...
      }
    }
  ]
}`}
            />
          </section>

          {/* Query parameters */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              URL Query Parameters
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Share pre-filtered views of the compliance matrix using URL query
              parameters. Works on GitHub Pages.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-semibold">Param</th>
                    <th className="px-3 py-2 text-left font-semibold">Values</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-3 py-2 font-mono text-[11px]">q</td>
                    <td className="px-3 py-2 text-muted-foreground">any text</td>
                    <td className="px-3 py-2 text-muted-foreground">Search by service name</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono text-[11px]">cloud</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">azure | gov</td>
                    <td className="px-3 py-2 text-muted-foreground">Filter by cloud</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono text-[11px]">framework</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">hipaaBaa, pciDss, soc1_2_3, ...</td>
                    <td className="px-3 py-2 text-muted-foreground">Filter by framework key</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono text-[11px]">compliance</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">compliant | partial | none</td>
                    <td className="px-3 py-2 text-muted-foreground">Filter by compliance level</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* MCP Integration */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">MCP (Model Context Protocol)</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Connect URL-based remote MCP clients directly to the MCP endpoint.
              The Server Card and Catalog are separate experimental discovery
              metadata, not MCP transports.
            </p>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium">MCP endpoint (connection URL)</p>
                <CodeBlock code={MCP_ENDPOINT_URL} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Remote client config</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Add the endpoint through your client&apos;s remote server UI or
                  equivalent URL-based configuration:
                </p>
                <CodeBlock
                  language="json"
                  code={MCP_CLIENT_CONFIG_EXAMPLE}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Experimental discovery metadata</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Discovery-aware clients may read these documents before
                  connecting. Other clients can use the endpoint above directly.
                </p>
                <div className="space-y-1.5">
                  <div>
                    <p className="mb-1 text-xs font-medium">Catalog</p>
                    <CodeBlock code={MCP_CATALOG_URL} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">Runtime Server Card</p>
                    <CodeBlock code={MCP_SERVER_CARD_URL} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">Compatibility Server Card</p>
                    <CodeBlock code={MCP_COMPATIBILITY_SERVER_CARD_URL} />
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Protocol support</p>
                <p className="text-xs text-muted-foreground">
                  The remote&apos;s primary protocol is{" "}
                  {MCP_PRIMARY_PROTOCOL.displayLabel};{" "}
                  {MCP_COMPATIBILITY_PROTOCOL.displayLabel} remains supported
                  for compatibility. Server Card and Catalog discovery remain
                  experimental.
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Data scope</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    Compliance coverage for 200+ Azure services
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    17 compliance frameworks across Azure and Azure Government
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    Auto-synced weekly from Microsoft Service Trust Portal
                  </li>
                </ul>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Example prompts</p>
                <div className="space-y-1.5">
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
                    &ldquo;Which Azure services are HIPAA compliant?&rdquo;
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
                    &ldquo;List services with PCI DSS on Azure Government.&rdquo;
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground italic">
                    &ldquo;Compare ISO 27001 coverage between Azure and Azure Gov for storage services.&rdquo;
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Example URLs */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Example URLs</h3>
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Search for Cosmos DB:
                </p>
                <CodeBlock code={`${SITE_URL}/?q=cosmos`} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  HIPAA-compliant Azure services:
                </p>
                <CodeBlock
                  code={`${SITE_URL}/?framework=hipaaBaa&cloud=azure`}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Fully compliant Azure Government services:
                </p>
                <CodeBlock
                  code={`${SITE_URL}/?cloud=gov&compliance=compliant`}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  All framework keys (use as <code className="rounded bg-muted px-1 font-mono text-[11px]">framework</code> value):
                </p>
                <CodeBlock
                  code={`csaStarCertification  csaStarAttestation
iso27001_27018        iso27017
iso27701              iso9001_22301_20000
soc1_2_3              gsmaSasSm
hipaaBaa              hitrust
kIsms                 pci3ds
pciDss                australiaIrap
germanyC5             singaporeMtcsLevel3
spainEnsHigh`}
                />
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
