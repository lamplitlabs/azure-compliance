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
import { DATA_URL } from "@/lib/constants";

const SITE_URL = "https://azure-compliance.lamplitlabs.com";
const JSON_URL = `${SITE_URL}/data/azure-compliance.json`;

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
          <DialogTitle>API &amp; Query Usage</DialogTitle>
          <DialogDescription>
            Use the JSON endpoint or URL query parameters to integrate
            compliance data into your workflows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* JSON API */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">JSON Endpoint</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Fetch the full compliance dataset as JSON. Updated weekly.
            </p>
            <CodeBlock code={JSON_URL} />
          </section>

          {/* Fetch examples */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Fetch with cURL</h3>
            <CodeBlock code={`curl -s ${JSON_URL} | jq '.services | length'`} />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Fetch with JavaScript
            </h3>
            <CodeBlock
              language="javascript"
              code={`const res = await fetch(
  "${JSON_URL}"
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
    "${JSON_URL}"
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
