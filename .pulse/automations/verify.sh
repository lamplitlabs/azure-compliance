#!/bin/sh
# Daily check: Go vet + tests for azure-compliance.
set -e
go vet ./... && go test ./...
