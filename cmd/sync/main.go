package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/lamplitlabs/azure-compliance/internal/gist"
	"github.com/lamplitlabs/azure-compliance/internal/normalizer"
	"github.com/lamplitlabs/azure-compliance/internal/parser"
	"github.com/lamplitlabs/azure-compliance/internal/report"
	"github.com/lamplitlabs/azure-compliance/internal/state"
	"github.com/lamplitlabs/azure-compliance/internal/stp"
)

const (
	documentGUID = "7adf2d9e-d7b5-4e71-bad8-713e6a183cf3"
	gistID       = "6c34ec94d1bf0d851e91f6be4abbc908"
)

func main() {
	githubToken := mustEnv("GIT_PERSONAL_TOKEN")
	endpoint := mustEnv("AZURE_OPENAI_ENDPOINT")
	apiKey := mustEnv("AZURE_OPENAI_API_KEY")
	deployment := mustEnv("AZURE_OPENAI_DEPLOYMENT")

	// Determine output directory (default: data/)
	outputDir := os.Getenv("OUTPUT_DIR")
	if outputDir == "" {
		outputDir = "data"
	}

	// Step 1: Download PDF from Service Trust Portal
	log.Println("[STP] Downloading PDF from Service Trust Portal...")
	result, err := stp.DownloadPDF(documentGUID)
	if err != nil {
		log.Fatalf("[STP] Failed to download PDF: %v", err)
	}
	log.Printf("[STP] Downloaded %d KB, whenLastModified: %s", len(result.PDFBytes)/1024, result.WhenLastModified)

	// Step 2: Check if document has changed
	checkTime := time.Now().UTC().Format(time.RFC3339)
	runState := state.Load()
	if runState.LastComplianceVersion != "" && runState.LastComplianceVersion == result.WhenLastModified {
		log.Printf("[Compliance] Document unchanged (whenLastModified: %s). Skipping.", result.WhenLastModified)
		// Update lastCheck even when skipping (we did check)
		state.Save(state.RunState{
			LastCheck:             checkTime,
			LastSync:              runState.LastSync,
			LastComplianceVersion: runState.LastComplianceVersion,
		})
		return
	}

	// Step 3: Parse PDF via Azure OpenAI
	log.Println("[AI] Parsing PDF via Azure OpenAI...")
	inputFile, err := parser.ParsePDF(result.PDFBytes, endpoint, apiKey, deployment)
	if err != nil {
		log.Fatalf("[AI] Failed to parse PDF: %v", err)
	}
	log.Printf("[AI] Extracted %d entries from: %s", len(inputFile.Entries), inputFile.SourceDocument)

	// Step 4: Normalize service names and build report
	for i := range inputFile.Entries {
		inputFile.Entries[i].ServiceName = normalizer.Normalize(inputFile.Entries[i].ServiceName)
	}

	complianceReport := report.Build(inputFile, checkTime, checkTime)
	log.Printf("[Report] Built report with %d normalized services.", len(complianceReport.Services))

	// Step 5: Serialize to JSON
	jsonData, err := json.MarshalIndent(complianceReport, "", "  ")
	if err != nil {
		log.Fatalf("[Report] Failed to serialize report: %v", err)
	}

	// Step 6: Write JSON to data/ directory (for GitHub Pages)
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		log.Fatalf("[Output] Failed to create output directory: %v", err)
	}
	outputPath := filepath.Join(outputDir, "azure-compliance.json")
	if err := os.WriteFile(outputPath, jsonData, 0o644); err != nil {
		log.Fatalf("[Output] Failed to write %s: %v", outputPath, err)
	}
	log.Printf("[Output] Wrote %s (%d bytes)", outputPath, len(jsonData))

	// Step 7: Update GitHub Gist (backward compatibility)
	syncDate := time.Now().UTC().Format("2006-01-02 15:04:05 UTC")
	description := fmt.Sprintf(
		"Azure Services Compliance Coverage Matrix | Based on Microsoft's official compliance offerings report from the Service Trust Portal | Last synced: %s",
		syncDate,
	)
	if err := gist.Update(githubToken, gistID, "azure-compliance.json", string(jsonData), description); err != nil {
		log.Printf("[Gist] WARNING: Failed to update gist: %v", err)
	} else {
		log.Printf("[Gist] Updated gist %s", gistID)
	}

	// Step 8: Save run state
	state.Save(state.RunState{
		LastCheck:             checkTime,
		LastSync:              checkTime,
		LastComplianceVersion: result.WhenLastModified,
	})
	log.Println("[Compliance] Sync completed successfully.")
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("Required environment variable %s is not set.", key)
	}
	return v
}
