#!/bin/sh
# Daily check: Go vet and tests for azure-compliance.
set -e
mise exec go@1.24.1 -- sh -c 'go vet ./... && go test ./...'
