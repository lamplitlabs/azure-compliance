package normalizer

import (
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		// Aliases resolve to their canonical name.
		{name: "short alias", in: "app service", want: "Azure App Service"},
		{name: "full alias", in: "azure app service", want: "Azure App Service"},
		{name: "legacy name", in: "Web Apps", want: "Azure App Service"},
		{name: "acronym", in: "AKS", want: "Azure Kubernetes Service"},
		{name: "renamed product", in: "Azure Active Directory", want: "Microsoft Entra ID"},
		{name: "renamed search", in: "Azure Cognitive Search", want: "Azure AI Search"},
		{name: "no-space alias", in: "CosmosDB", want: "Azure Cosmos DB"},
		{name: "storage files", in: "file storage", want: "Azure Files"},

		// Matching is case-insensitive and whitespace-insensitive.
		{name: "upper case alias", in: "KEY VAULT", want: "Azure Key Vault"},
		{name: "mixed case alias", in: "kEy VaUlT", want: "Azure Key Vault"},
		{name: "surrounding spaces", in: "  key vault  ", want: "Azure Key Vault"},
		{name: "inner runs of spaces", in: "key    vault", want: "Azure Key Vault"},
		{name: "tabs and newlines from PDF text", in: "key\t\nvault", want: "Azure Key Vault"},

		// Unknown names get an "Azure " prefix unless they already carry a brand.
		{name: "unknown gets prefix", in: "Bastion", want: "Azure Bastion"},
		{name: "unknown multi-word gets prefix", in: "Data Factory", want: "Azure Data Factory"},
		{name: "already azure", in: "Azure Data Factory", want: "Azure Data Factory"},
		{name: "already azure lower case kept", in: "azure data factory", want: "azure data factory"},
		{name: "already microsoft", in: "Microsoft Defender for Cloud", want: "Microsoft Defender for Cloud"},
		{name: "already microsoft upper case", in: "MICROSOFT Purview", want: "MICROSOFT Purview"},
		{name: "unknown whitespace collapsed", in: "  Azure   Data\tFactory ", want: "Azure Data Factory"},
		{name: "azure as part of a word is not a brand", in: "Azurite", want: "Azure Azurite"},
		{name: "microsoft as part of a word is not a brand", in: "MicrosoftGraph", want: "Azure MicrosoftGraph"},

		// Malformed input: blank names are returned untouched.
		{name: "empty", in: "", want: ""},
		{name: "spaces only", in: "   ", want: "   "},
		{name: "whitespace only", in: "\t\n", want: "\t\n"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Normalize(tt.in); got != tt.want {
				t.Errorf("Normalize(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// TestNormalizeIdempotent checks that running the normalizer twice changes
// nothing, so a re-sync of already normalized names keeps them stable.
func TestNormalizeIdempotent(t *testing.T) {
	inputs := []string{
		"app service", "AKS", "Azure Active Directory", "Bastion",
		"Azure Data Factory", "Microsoft Defender for Cloud", "  key   vault ",
	}
	for _, in := range inputs {
		t.Run(in, func(t *testing.T) {
			once := Normalize(in)
			if twice := Normalize(once); twice != once {
				t.Errorf("Normalize(Normalize(%q)) = %q, want %q", in, twice, once)
			}
		})
	}
}

// TestAliasMapConsistency guards the alias table itself: a key that is not
// lower case or carries extra whitespace can never match, and a canonical
// value that normalizes to something else would split one service in two.
func TestAliasMapConsistency(t *testing.T) {
	for alias, canonical := range aliasMap {
		t.Run(alias, func(t *testing.T) {
			if alias != strings.ToLower(alias) {
				t.Errorf("alias key %q is not lower case and can never match", alias)
			}
			if alias != strings.Join(strings.Fields(alias), " ") {
				t.Errorf("alias key %q has extra whitespace and can never match", alias)
			}
			if canonical == "" {
				t.Errorf("alias %q maps to an empty name", alias)
			}
			if got := Normalize(canonical); got != canonical {
				t.Errorf("canonical %q (from alias %q) normalizes to %q", canonical, alias, got)
			}
		})
	}
}
