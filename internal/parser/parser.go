package parser

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/lamplitlabs/azure-compliance/internal/report"
	"github.com/ledongthuc/pdf"
)

const (
	batchSize      = 80
	maxConcurrency = 5
	maxRetries     = 3
)

// ParsePDF extracts compliance data from a PDF using Azure OpenAI.
func ParsePDF(pdfBytes []byte, endpoint, apiKey, deployment string) (*report.ComplianceInput, error) {
	// Step 1: Extract text from PDF
	log.Println("[AI] Extracting text from PDF...")
	pdfText, err := extractText(pdfBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to extract PDF text: %w", err)
	}
	log.Printf("[AI] Extracted %d characters from PDF.", len(pdfText))

	// Step 2: Get list of all service names
	log.Println("[AI] Step 1: Getting list of all service names...")
	serviceNames, err := getServiceNames(endpoint, apiKey, deployment, pdfText)
	if err != nil {
		return nil, fmt.Errorf("failed to get service names: %w", err)
	}
	log.Printf("[AI] Found %d services. Processing in batches of %d...", len(serviceNames), batchSize)

	// Step 3: Process in batches concurrently
	batches := chunk(serviceNames, batchSize)
	log.Printf("[AI] Processing %d batches concurrently (max %d at a time)...", len(batches), maxConcurrency)

	type batchResult struct {
		index   int
		entries []report.ServiceEntry
		err     error
	}

	results := make([]batchResult, len(batches))
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	for i, batch := range batches {
		wg.Add(1)
		go func(idx int, b []string) {
			defer wg.Done()
			sem <- struct{}{}        // acquire semaphore
			defer func() { <-sem }() // release semaphore

			log.Printf("[AI] Processing batch %d/%d (%d services)...", idx+1, len(batches), len(b))
			entries, err := getComplianceEntries(endpoint, apiKey, deployment, pdfText, b)
			results[idx] = batchResult{index: idx, entries: entries, err: err}
			if err != nil {
				log.Printf("[AI] Batch %d failed: %v", idx+1, err)
			} else {
				log.Printf("[AI] Batch %d returned %d entries.", idx+1, len(entries))
			}
		}(i, batch)
	}

	wg.Wait()

	var allEntries []report.ServiceEntry
	for _, r := range results {
		if r.err != nil {
			return nil, fmt.Errorf("batch %d failed: %w", r.index+1, r.err)
		}
		allEntries = append(allEntries, r.entries...)
	}

	if len(allEntries) == 0 {
		return nil, fmt.Errorf("Azure OpenAI returned zero service entries from the PDF")
	}

	log.Printf("[AI] Extracted %d service entries total.", len(allEntries))

	return &report.ComplianceInput{
		SourceDocument: "Microsoft Azure Compliance Offerings",
		VerifiedDate:   time.Now().UTC().Format("2006-01-02"),
		Entries:        allEntries,
	}, nil
}

func extractText(pdfBytes []byte) (string, error) {
	reader := bytes.NewReader(pdfBytes)
	r, err := pdf.NewReader(reader, int64(len(pdfBytes)))
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}

	var sb strings.Builder
	numPages := r.NumPage()
	for i := 1; i <= numPages; i++ {
		page := r.Page(i)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(nil)
		if err != nil {
			log.Printf("[AI] Warning: failed to extract text from page %d: %v", i, err)
			continue
		}
		sb.WriteString(fmt.Sprintf("--- Page %d ---\n", i))
		sb.WriteString(text)
		sb.WriteString("\n\n")
	}

	return sb.String(), nil
}

// azureOpenAIRequest represents the request body for Azure OpenAI Chat Completions.
type azureOpenAIRequest struct {
	Messages       []chatMessage   `json:"messages"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type       string          `json:"type"`
	JSONSchema json.RawMessage `json:"json_schema,omitempty"`
}

type azureOpenAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type serviceNamesResponse struct {
	ServiceNames []string `json:"serviceNames"`
}

func getServiceNames(endpoint, apiKey, deployment, pdfText string) ([]string, error) {
	messages := []chatMessage{
		{
			Role:    "system",
			Content: "You extract Azure service names from compliance documents. Return ONLY a JSON object with a serviceNames array of service name strings exactly as they appear in the document.",
		},
		{
			Role:    "user",
			Content: fmt.Sprintf("List ALL Azure service names from both the Azure and Azure Government compliance tables in this document. Return a JSON object with a serviceNames array of unique service names.\n\n%s", pdfText),
		},
	}

	schema := json.RawMessage(`{
		"name": "service_names",
		"strict": false,
		"schema": {
			"type": "object",
			"properties": {
				"serviceNames": {
					"type": "array",
					"items": { "type": "string" }
				}
			},
			"required": ["serviceNames"]
		}
	}`)

	content, err := callAzureOpenAI(endpoint, apiKey, deployment, messages, &responseFormat{
		Type:       "json_schema",
		JSONSchema: schema,
	})
	if err != nil {
		return nil, err
	}

	var resp serviceNamesResponse
	if err := json.Unmarshal([]byte(content), &resp); err != nil {
		return nil, fmt.Errorf("failed to parse service names: %w", err)
	}

	// Deduplicate
	seen := make(map[string]bool)
	var unique []string
	for _, name := range resp.ServiceNames {
		lower := strings.ToLower(strings.TrimSpace(name))
		if !seen[lower] && name != "" {
			seen[lower] = true
			unique = append(unique, strings.TrimSpace(name))
		}
	}

	return unique, nil
}

func getComplianceEntries(endpoint, apiKey, deployment, pdfText string, serviceNames []string) ([]report.ServiceEntry, error) {
	var serviceList strings.Builder
	for i, name := range serviceNames {
		serviceList.WriteString(fmt.Sprintf("%d. %s\n", i+1, name))
	}

	messages := []chatMessage{
		{
			Role:    "system",
			Content: buildSystemPrompt(),
		},
		{
			Role: "user",
			Content: fmt.Sprintf(`Here is the extracted text from the PDF:

%s

Extract compliance data ONLY for these specific services:
%s

%s`, pdfText, serviceList.String(), buildUserPrompt()),
		},
	}

	schema := json.RawMessage(getResponseSchema())

	content, err := callAzureOpenAI(endpoint, apiKey, deployment, messages, &responseFormat{
		Type:       "json_schema",
		JSONSchema: schema,
	})
	if err != nil {
		return nil, err
	}

	var inputFile report.ComplianceInput
	if err := json.Unmarshal([]byte(content), &inputFile); err != nil {
		return nil, fmt.Errorf("failed to parse compliance entries: %w", err)
	}

	return inputFile.Entries, nil
}

func callAzureOpenAI(endpoint, apiKey, deployment string, messages []chatMessage, respFmt *responseFormat) (string, error) {
	url := fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=2025-04-01-preview", strings.TrimRight(endpoint, "/"), deployment)

	reqBody := azureOpenAIRequest{
		Messages:       messages,
		ResponseFormat: respFmt,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	log.Printf("[AI] Request payload size: %d bytes", len(bodyBytes))

	client := &http.Client{Timeout: 10 * time.Minute}

	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			backoff := time.Duration(attempt*attempt) * 10 * time.Second
			log.Printf("[AI] Retry %d/%d after %v...", attempt, maxRetries, backoff)
			time.Sleep(backoff)
		}

		req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
		if err != nil {
			return "", fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("api-key", apiKey)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed (attempt %d): %w", attempt, err)
			log.Printf("[AI] HTTP request failed (attempt %d): %v", attempt, err)
			continue
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response (attempt %d): %w", attempt, err)
			log.Printf("[AI] Failed to read response body (attempt %d): %v", attempt, err)
			continue
		}

		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("Azure OpenAI returned status %d (attempt %d): %s", resp.StatusCode, attempt, string(respBody))
			log.Printf("[AI] Retryable error %d (attempt %d): %s", resp.StatusCode, attempt, string(respBody))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("Azure OpenAI returned status %d: %s", resp.StatusCode, string(respBody))
		}

		var openAIResp azureOpenAIResponse
		if err := json.Unmarshal(respBody, &openAIResp); err != nil {
			return "", fmt.Errorf("failed to parse response: %w", err)
		}

		if len(openAIResp.Choices) == 0 {
			return "", fmt.Errorf("Azure OpenAI returned no choices")
		}

		return openAIResp.Choices[0].Message.Content, nil
	}

	return "", fmt.Errorf("all %d attempts failed: %w", maxRetries, lastErr)
}

func buildSystemPrompt() string {
	return `You are an Azure compliance data extraction specialist.
You will be given a PDF document from Microsoft's Service Trust Portal
that contains a compliance offerings matrix for Azure services.

The document has a matrix showing Azure services as rows and compliance
frameworks as columns. There are two separate tables: one for Azure
(commercial) and one for Azure Government.

The compliance frameworks (columns) are:
1. CSA STAR Certification
2. CSA STAR Attestation
3. ISO 27001, 27018
4. ISO 27017
5. ISO 27701
6. ISO 9001, 22301, 20000-1
7. SOC 1, 2, 3
8. GSMA SAS-SM
9. HIPAA BAA
10. HITRUST
11. K-ISMS
12. PCI 3DS
13. PCI DSS
14. Australia IRAP
15. Germany C5
16. Singapore MTCS Level 3
17. Spain ENS High

Rules:
- Extract EVERY Azure service row from both the Azure and Azure Government tables.
- For each service, set each framework flag to true if the cell contains a checkmark,
  "Yes", or similar positive indicator; set to false otherwise.
- Use the exact service names as they appear in the document.
- Set sourceDocument to the full document title as it appears in the PDF.
- Set verifiedDate to today's date in ISO 8601 format.
- Do NOT skip any service or framework. Be exhaustive.`
}

func buildUserPrompt() string {
	return `Extract the full Azure compliance offerings matrix from this PDF.
There are two tables: one for Azure (commercial) and one for Azure Government.

For each Azure service, return its compliance status across all 17 frameworks
for both Azure and Azure Government clouds.

Return a JSON object with this structure:
{
  "sourceDocument": "<full document title and version from the PDF>",
  "verifiedDate": "<today's date YYYY-MM-DD>",
  "entries": [
    {
      "serviceName": "<Azure service name as listed>",
      "azure": {
        "csaStarCertification": true/false,
        "csaStarAttestation": true/false,
        "iso27001_27018": true/false,
        "iso27017": true/false,
        "iso27701": true/false,
        "iso9001_22301_20000": true/false,
        "soc1_2_3": true/false,
        "gsmaSasSm": true/false,
        "hipaaBaa": true/false,
        "hitrust": true/false,
        "kIsms": true/false,
        "pci3ds": true/false,
        "pciDss": true/false,
        "australiaIrap": true/false,
        "germanyC5": true/false,
        "singaporeMtcsLevel3": true/false,
        "spainEnsHigh": true/false
      },
      "azureGovernment": {
        "csaStarCertification": true/false,
        "csaStarAttestation": true/false,
        "iso27001_27018": true/false,
        "iso27017": true/false,
        "iso27701": true/false,
        "iso9001_22301_20000": true/false,
        "soc1_2_3": true/false,
        "gsmaSasSm": true/false,
        "hipaaBaa": true/false,
        "hitrust": true/false,
        "kIsms": true/false,
        "pci3ds": true/false,
        "pciDss": true/false,
        "australiaIrap": true/false,
        "germanyC5": true/false,
        "singaporeMtcsLevel3": true/false,
        "spainEnsHigh": true/false
      }
    }
  ]
}

If a service only appears in one table (e.g., only in Azure, not in Azure Government),
set all flags for the missing cloud to false.`
}

func getResponseSchema() string {
	return `{
		"name": "compliance_input_file",
		"strict": false,
		"schema": {
			"type": "object",
			"properties": {
				"sourceDocument": { "type": "string" },
				"verifiedDate": { "type": "string" },
				"entries": {
					"type": "array",
					"items": {
						"type": "object",
						"properties": {
							"serviceName": { "type": "string" },
							"azure": {
								"type": "object",
								"properties": {
									"csaStarCertification": { "type": "boolean" },
									"csaStarAttestation": { "type": "boolean" },
									"iso27001_27018": { "type": "boolean" },
									"iso27017": { "type": "boolean" },
									"iso27701": { "type": "boolean" },
									"iso9001_22301_20000": { "type": "boolean" },
									"soc1_2_3": { "type": "boolean" },
									"gsmaSasSm": { "type": "boolean" },
									"hipaaBaa": { "type": "boolean" },
									"hitrust": { "type": "boolean" },
									"kIsms": { "type": "boolean" },
									"pci3ds": { "type": "boolean" },
									"pciDss": { "type": "boolean" },
									"australiaIrap": { "type": "boolean" },
									"germanyC5": { "type": "boolean" },
									"singaporeMtcsLevel3": { "type": "boolean" },
									"spainEnsHigh": { "type": "boolean" }
								},
								"required": ["csaStarCertification", "csaStarAttestation", "iso27001_27018", "iso27017", "iso27701", "iso9001_22301_20000", "soc1_2_3", "gsmaSasSm", "hipaaBaa", "hitrust", "kIsms", "pci3ds", "pciDss", "australiaIrap", "germanyC5", "singaporeMtcsLevel3", "spainEnsHigh"]
							},
							"azureGovernment": {
								"type": "object",
								"properties": {
									"csaStarCertification": { "type": "boolean" },
									"csaStarAttestation": { "type": "boolean" },
									"iso27001_27018": { "type": "boolean" },
									"iso27017": { "type": "boolean" },
									"iso27701": { "type": "boolean" },
									"iso9001_22301_20000": { "type": "boolean" },
									"soc1_2_3": { "type": "boolean" },
									"gsmaSasSm": { "type": "boolean" },
									"hipaaBaa": { "type": "boolean" },
									"hitrust": { "type": "boolean" },
									"kIsms": { "type": "boolean" },
									"pci3ds": { "type": "boolean" },
									"pciDss": { "type": "boolean" },
									"australiaIrap": { "type": "boolean" },
									"germanyC5": { "type": "boolean" },
									"singaporeMtcsLevel3": { "type": "boolean" },
									"spainEnsHigh": { "type": "boolean" }
								},
								"required": ["csaStarCertification", "csaStarAttestation", "iso27001_27018", "iso27017", "iso27701", "iso9001_22301_20000", "soc1_2_3", "gsmaSasSm", "hipaaBaa", "hitrust", "kIsms", "pci3ds", "pciDss", "australiaIrap", "germanyC5", "singaporeMtcsLevel3", "spainEnsHigh"]
							}
						},
						"required": ["serviceName", "azure", "azureGovernment"]
					}
				}
			},
			"required": ["sourceDocument", "verifiedDate", "entries"]
		}
	}`
}

func chunk(slice []string, size int) [][]string {
	var chunks [][]string
	for i := 0; i < len(slice); i += size {
		end := i + size
		if end > len(slice) {
			end = len(slice)
		}
		chunks = append(chunks, slice[i:end])
	}
	return chunks
}
