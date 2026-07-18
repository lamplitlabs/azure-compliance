import { type FrameworkKey } from "@/types/compliance";

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

export const DATA_URL = "./data/azure-compliance.json";
