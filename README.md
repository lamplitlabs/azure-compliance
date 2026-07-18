<p align="center">
  <a href="https://github.com/bitesinbyte/azure-compliance">
    <img src="https://github.com/bitesinbyte/azure-compliance/raw/main/.github/images/logo.svg" width="256px" />
  </a>
</p>
<h1 align="center">Azure Compliance | Bites In Byte</h1>

Auto-synced compliance coverage matrix for Azure services, sourced from Microsoft's [Service Trust Portal](https://servicetrust.microsoft.com). Search, filter, and explore compliance certifications across 17 frameworks for Azure and Azure Government.

**Live site:** [azure-compliance.bitesinbyte.com](https://azure-compliance.bitesinbyte.com)

## How it works

1. A Go CLI (`cmd/sync`) downloads the compliance PDF from the Service Trust Portal
2. Text is extracted locally using a PDF parser
3. Azure OpenAI parses the compliance matrix into structured JSON
4. The JSON is committed to `data/azure-compliance.json` and the GitHub Gist is updated for backward compatibility
5. GitHub Pages serves an interactive, searchable compliance table from `web/`

Data is checked on the **1st of every month** via GitHub Actions. If the source document has changed, the data is re-synced. You can also trigger a manual sync.

## Frameworks

The compliance data covers **17 frameworks** across **2 clouds** (Azure, Azure Government):

| Framework | Key |
|---|---|
| CSA STAR Certification | `csaStarCertification` |
| CSA STAR Attestation | `csaStarAttestation` |
| ISO 27001, 27018 | `iso27001_27018` |
| ISO 27017 | `iso27017` |
| ISO 27701 | `iso27701` |
| ISO 9001, 22301, 20000-1 | `iso9001_22301_20000` |
| SOC 1, 2, 3 | `soc1_2_3` |
| GSMA SAS-SM | `gsmaSasSm` |
| HIPAA BAA | `hipaaBaa` |
| HITRUST | `hitrust` |
| K-ISMS | `kIsms` |
| PCI 3DS | `pci3ds` |
| PCI DSS | `pciDss` |
| Australia IRAP | `australiaIrap` |
| Germany C5 | `germanyC5` |
| Singapore MTCS Level 3 | `singaporeMtcsLevel3` |
| Spain ENS High | `spainEnsHigh` |

## Disclaimer

This data reflects Microsoft's platform-level compliance attestation scope as published in the official audit reports obtained from the Service Trust Portal. It does **not** constitute a compliance certification for any customer workload. Customers must independently assess their own control implementations. Always refer to the [Microsoft Service Trust Portal](https://servicetrust.microsoft.com) for the most current and authoritative compliance information.

## Need Help?

If you need any help or if you find any issue, please raise it [here](https://github.com/bitesinbyte/azure-compliance/discussions).

## License

Licensed under the [MIT license](https://github.com/bitesinbyte/azure-compliance/blob/main/LICENSE).
