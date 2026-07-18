import { type FrameworkKey } from "@/types/compliance";
import mcpMetadata from "./mcp-metadata.json";

export const FRAMEWORK_KEYS: FrameworkKey[] = [
  "csaStarCertification",
  "csaStarAttestation",
  "iso27001_27018",
  "iso27017",
  "iso27701",
  "iso9001_22301_20000",
  "soc1_2_3",
  "gsmaSasSm",
  "hipaaBaa",
  "hitrust",
  "kIsms",
  "pci3ds",
  "pciDss",
  "australiaIrap",
  "germanyC5",
  "singaporeMtcsLevel3",
  "spainEnsHigh",
];

export const FRAMEWORK_LABELS: Record<FrameworkKey, string> = {
  csaStarCertification: "CSA STAR Cert",
  csaStarAttestation: "CSA STAR Attest",
  iso27001_27018: "ISO 27001/18",
  iso27017: "ISO 27017",
  iso27701: "ISO 27701",
  iso9001_22301_20000: "ISO 9001+",
  soc1_2_3: "SOC 1/2/3",
  gsmaSasSm: "GSMA SAS-SM",
  hipaaBaa: "HIPAA BAA",
  hitrust: "HITRUST",
  kIsms: "K-ISMS",
  pci3ds: "PCI 3DS",
  pciDss: "PCI DSS",
  australiaIrap: "AU IRAP",
  germanyC5: "DE C5",
  singaporeMtcsLevel3: "SG MTCS L3",
  spainEnsHigh: "ES ENS High",
};

export const FRAMEWORK_FULL_NAMES: Record<FrameworkKey, string> = {
  csaStarCertification: "CSA STAR Certification",
  csaStarAttestation: "CSA STAR Attestation",
  iso27001_27018: "ISO 27001, 27018",
  iso27017: "ISO 27017",
  iso27701: "ISO 27701",
  iso9001_22301_20000: "ISO 9001, 22301, 20000-1",
  soc1_2_3: "SOC 1, 2, 3",
  gsmaSasSm: "GSMA SAS-SM",
  hipaaBaa: "HIPAA BAA",
  hitrust: "HITRUST",
  kIsms: "K-ISMS",
  pci3ds: "PCI 3DS",
  pciDss: "PCI DSS",
  australiaIrap: "Australia IRAP",
  germanyC5: "Germany C5",
  singaporeMtcsLevel3: "Singapore MTCS Level 3",
  spainEnsHigh: "Spain ENS High",
};

export const SITE_URL = mcpMetadata.siteUrl;
export const REPOSITORY_URL = mcpMetadata.repository.url;
export const DATA_URL = "./data/azure-compliance.json";
export const DATA_API_URL = `${SITE_URL}/data/azure-compliance.json`;

export const MCP_SERVER_NAME = mcpMetadata.serverName;
export const MCP_SERVER_TITLE = mcpMetadata.serverTitle;
export const MCP_SERVER_VERSION = mcpMetadata.serverVersion;
export const MCP_ENDPOINT_URL = mcpMetadata.remote.url;
export const MCP_SERVER_CARD_URL = mcpMetadata.serverCardUrl;
export const MCP_COMPATIBILITY_SERVER_CARD_URL =
  mcpMetadata.compatibilityServerCardUrl;
export const MCP_CATALOG_URL = mcpMetadata.catalogUrl;
export const MCP_PRIMARY_PROTOCOL = mcpMetadata.protocolVersions.primary;
export const MCP_COMPATIBILITY_PROTOCOL =
  mcpMetadata.protocolVersions.compatibility;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  MCP_PRIMARY_PROTOCOL.version,
  MCP_COMPATIBILITY_PROTOCOL.version,
];
export const MCP_CLIENT_CONFIG_EXAMPLE = JSON.stringify(
  {
    mcpServers: {
      "azure-compliance": {
        url: MCP_ENDPOINT_URL,
      },
    },
  },
  null,
  2
);
