package parser

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/lamplitlabs/azure-compliance/internal/report"
)

// buildPDF returns a minimal valid PDF with one page per entry of pages,
// each page showing its text in Helvetica. Offsets in the xref table are
// computed so the reader can open it.
func buildPDF(t *testing.T, pages ...string) []byte {
	t.Helper()
	var objs []string
	// 1: catalog, 2: pages, 3: font, then page/content pairs.
	kids := make([]string, len(pages))
	for i := range pages {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	objs = append(objs,
		"<< /Type /Catalog /Pages 2 0 R >>",
		fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pages)),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	)
	for i, text := range pages {
		stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
		objs = append(objs,
			fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", 5+2*i),
			fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		)
	}

	var sb strings.Builder
	sb.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = sb.Len()
		fmt.Fprintf(&sb, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := sb.Len()
	fmt.Fprintf(&sb, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&sb, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&sb, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return []byte(sb.String())
}

func TestChunk(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		size int
		want [][]string
	}{
		{name: "nil input", in: nil, size: 2, want: nil},
		{name: "empty input", in: []string{}, size: 2, want: nil},
		{name: "smaller than size", in: []string{"a"}, size: 2, want: [][]string{{"a"}}},
		{name: "exact multiple", in: []string{"a", "b", "c", "d"}, size: 2, want: [][]string{{"a", "b"}, {"c", "d"}}},
		{name: "remainder in last chunk", in: []string{"a", "b", "c", "d", "e"}, size: 2, want: [][]string{{"a", "b"}, {"c", "d"}, {"e"}}},
		{name: "size one", in: []string{"a", "b"}, size: 1, want: [][]string{{"a"}, {"b"}}},
		{name: "size equals length", in: []string{"a", "b", "c"}, size: 3, want: [][]string{{"a", "b", "c"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := chunk(tt.in, tt.size)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("chunk(%v, %d) = %v, want %v", tt.in, tt.size, got, tt.want)
			}
		})
	}
}

// TestChunkKeepsEveryService checks the production batch size loses and
// duplicates nothing, so every service from the PDF reaches the matrix.
func TestChunkKeepsEveryService(t *testing.T) {
	for _, n := range []int{1, batchSize - 1, batchSize, batchSize + 1, 3*batchSize + 7} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			in := make([]string, n)
			for i := range in {
				in[i] = fmt.Sprintf("svc-%d", i)
			}
			var flat []string
			for _, c := range chunk(in, batchSize) {
				if len(c) == 0 || len(c) > batchSize {
					t.Fatalf("chunk of length %d, want 1..%d", len(c), batchSize)
				}
				flat = append(flat, c...)
			}
			if !reflect.DeepEqual(flat, in) {
				t.Errorf("chunks flattened differ from input")
			}
		})
	}
}

func TestExtractText(t *testing.T) {
	tests := []struct {
		name    string
		pdf     []byte
		want    []string
		wantErr bool
	}{
		{name: "one page", pdf: buildPDF(t, "Azure Key Vault"), want: []string{"--- Page 1 ---", "Azure Key Vault"}},
		{name: "two pages in order", pdf: buildPDF(t, "Azure", "Azure Government"), want: []string{"--- Page 1 ---", "--- Page 2 ---", "Azure Government"}},
		{name: "empty input", pdf: []byte{}, wantErr: true},
		{name: "not a pdf", pdf: []byte("hello, this is not a PDF"), wantErr: true},
		{name: "truncated pdf", pdf: buildPDF(t, "Azure")[:40], wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := extractText(tt.pdf)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("extractText() = %q, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("extractText() error = %v", err)
			}
			for _, w := range tt.want {
				if !strings.Contains(got, w) {
					t.Errorf("extractText() = %q, missing %q", got, w)
				}
			}
			if i1, i2 := strings.Index(got, "--- Page 1 ---"), strings.Index(got, "--- Page 2 ---"); i2 >= 0 && i2 < i1 {
				t.Errorf("pages out of order in %q", got)
			}
		})
	}
}

// fakeOpenAI serves Azure OpenAI chat completions from a handler that gets
// the decoded request; it records every request it saw.
type fakeOpenAI struct {
	mu       sync.Mutex
	requests []azureOpenAIRequest
	paths    []string
	apiKeys  []string
}

func (f *fakeOpenAI) server(t *testing.T, respond func(req azureOpenAIRequest) (int, string)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req azureOpenAIRequest
		if err := json.Unmarshal(body, &req); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		f.mu.Lock()
		f.requests = append(f.requests, req)
		f.paths = append(f.paths, r.URL.RequestURI())
		f.apiKeys = append(f.apiKeys, r.Header.Get("api-key"))
		f.mu.Unlock()
		status, out := respond(req)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, out)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// completion wraps content the way Azure OpenAI returns a chat completion.
func completion(t *testing.T, content string) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestCallAzureOpenAI(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		want    string
		wantErr string
	}{
		{name: "success", status: 200, body: `{"choices":[{"message":{"content":"hi"}}]}`, want: "hi"},
		{name: "first choice wins", status: 200, body: `{"choices":[{"message":{"content":"one"}},{"message":{"content":"two"}}]}`, want: "one"},
		{name: "no choices", status: 200, body: `{"choices":[]}`, wantErr: "no choices"},
		{name: "malformed body", status: 200, body: `{"choices":`, wantErr: "failed to parse response"},
		{name: "bad request is not retried", status: 400, body: `bad deployment`, wantErr: "status 400: bad deployment"},
		{name: "unauthorized is not retried", status: 401, body: `denied`, wantErr: "status 401"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeOpenAI{}
			srv := fake.server(t, func(azureOpenAIRequest) (int, string) { return tt.status, tt.body })

			got, err := callAzureOpenAI(srv.URL+"/", "secret-key", "my-deploy",
				[]chatMessage{{Role: "user", Content: "q"}}, &responseFormat{Type: "json_object"})
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("err = %v", err)
			} else if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}

			if len(fake.requests) != 1 {
				t.Fatalf("server saw %d requests, want 1", len(fake.requests))
			}
			wantPath := "/openai/deployments/my-deploy/chat/completions?api-version=2025-04-01-preview"
			if fake.paths[0] != wantPath {
				t.Errorf("path = %q, want %q (trailing slash of endpoint must be trimmed)", fake.paths[0], wantPath)
			}
			if fake.apiKeys[0] != "secret-key" {
				t.Errorf("api-key header = %q", fake.apiKeys[0])
			}
			req := fake.requests[0]
			if len(req.Messages) != 1 || req.Messages[0].Content != "q" || req.ResponseFormat == nil || req.ResponseFormat.Type != "json_object" {
				t.Errorf("request body = %+v", req)
			}
		})
	}
}

func TestGetServiceNames(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
		wantErr bool
	}{
		{name: "plain list", content: `{"serviceNames":["Azure Key Vault","Azure Storage"]}`, want: []string{"Azure Key Vault", "Azure Storage"}},
		{name: "case-insensitive duplicates keep first", content: `{"serviceNames":["Azure Storage","azure storage","AZURE STORAGE"]}`, want: []string{"Azure Storage"}},
		{name: "whitespace trimmed and deduplicated", content: `{"serviceNames":[" Azure DNS ","Azure DNS"]}`, want: []string{"Azure DNS"}},
		{name: "empty names dropped", content: `{"serviceNames":["","Azure CDN"]}`, want: []string{"Azure CDN"}},
		{name: "empty list", content: `{"serviceNames":[]}`, want: nil},
		{name: "missing field", content: `{}`, want: nil},
		{name: "content not JSON", content: `Sure! Here are the services: Key Vault`, wantErr: true},
		{name: "wrong type", content: `{"serviceNames":"Azure Key Vault"}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeOpenAI{}
			srv := fake.server(t, func(azureOpenAIRequest) (int, string) { return 200, completion(t, tt.content) })

			got, err := getServiceNames(srv.URL, "k", "d", "PDF TEXT")
			if tt.wantErr {
				if err == nil {
					t.Fatalf("got %v, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %q, want %q", got, tt.want)
			}
			req := fake.requests[0]
			if !strings.Contains(req.Messages[len(req.Messages)-1].Content, "PDF TEXT") {
				t.Errorf("PDF text not sent to the model")
			}
			if req.ResponseFormat == nil || req.ResponseFormat.Type != "json_schema" || !json.Valid(req.ResponseFormat.JSONSchema) {
				t.Errorf("response format = %+v, want valid json_schema", req.ResponseFormat)
			}
		})
	}
}

func TestGetServiceNamesWhitespaceOnlyName(t *testing.T) {
	// A name of only spaces is skipped, like an empty one.
	fake := &fakeOpenAI{}
	srv := fake.server(t, func(azureOpenAIRequest) (int, string) {
		return 200, completion(t, `{"serviceNames":["  ","Azure CDN"]}`)
	})
	got, err := getServiceNames(srv.URL, "k", "d", "x")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"Azure CDN"}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestGetComplianceEntries(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []report.ServiceEntry
		wantErr bool
	}{
		{
			name:    "flags for both clouds",
			content: `{"sourceDocument":"doc","verifiedDate":"2026-01-01","entries":[{"serviceName":"Azure Key Vault","azure":{"iso27001_27018":true,"soc1_2_3":true,"spainEnsHigh":true},"azureGovernment":{"hipaaBaa":true}}]}`,
			want: []report.ServiceEntry{{
				ServiceName:     "Azure Key Vault",
				Azure:           report.ComplianceFrameworks{Iso27001_27018: true, Soc1_2_3: true, SpainEnsHigh: true},
				AzureGovernment: report.ComplianceFrameworks{HipaaBaa: true},
			}},
		},
		{
			name:    "missing government block means all false",
			content: `{"entries":[{"serviceName":"Azure CDN","azure":{"pciDss":true}}]}`,
			want:    []report.ServiceEntry{{ServiceName: "Azure CDN", Azure: report.ComplianceFrameworks{PciDss: true}}},
		},
		{
			name:    "unknown fields ignored",
			content: `{"entries":[{"serviceName":"Azure DNS","azure":{"madeUpFramework":true},"note":"x"}]}`,
			want:    []report.ServiceEntry{{ServiceName: "Azure DNS"}},
		},
		{name: "no entries", content: `{"entries":[]}`, want: []report.ServiceEntry{}},
		{name: "content not JSON", content: `I could not read the table.`, wantErr: true},
		{name: "flag as string", content: `{"entries":[{"serviceName":"A","azure":{"pciDss":"yes"}}]}`, wantErr: true},
		{name: "truncated JSON", content: `{"entries":[{"serviceName":"A"`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeOpenAI{}
			srv := fake.server(t, func(azureOpenAIRequest) (int, string) { return 200, completion(t, tt.content) })

			got, err := getComplianceEntries(srv.URL, "k", "d", "PDF TEXT", []string{"Azure Key Vault", "Azure CDN"})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("got %+v, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
			user := fake.requests[0].Messages[len(fake.requests[0].Messages)-1].Content
			for _, w := range []string{"PDF TEXT", "1. Azure Key Vault\n", "2. Azure CDN\n"} {
				if !strings.Contains(user, w) {
					t.Errorf("user prompt missing %q", w)
				}
			}
		})
	}
}

// frameworkTags lists the JSON names of all ComplianceFrameworks fields.
func frameworkTags(t *testing.T) []string {
	t.Helper()
	typ := reflect.TypeOf(report.ComplianceFrameworks{})
	tags := make([]string, typ.NumField())
	for i := range tags {
		tags[i] = strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
	}
	return tags
}

// TestResponseSchemaMatchesReport keeps the schema sent to the model in step
// with report.ComplianceFrameworks: a framework missing from one side would
// silently come back false for every service in the matrix.
func TestResponseSchemaMatchesReport(t *testing.T) {
	var schema struct {
		Schema struct {
			Required   []string `json:"required"`
			Properties struct {
				Entries struct {
					Items struct {
						Required   []string `json:"required"`
						Properties map[string]struct {
							Properties map[string]struct {
								Type string `json:"type"`
							} `json:"properties"`
							Required []string `json:"required"`
						} `json:"properties"`
					} `json:"items"`
				} `json:"entries"`
			} `json:"properties"`
		} `json:"schema"`
	}
	if err := json.Unmarshal([]byte(getResponseSchema()), &schema); err != nil {
		t.Fatalf("response schema is not valid JSON: %v", err)
	}
	tags := frameworkTags(t)
	if len(tags) != 17 {
		t.Fatalf("report.ComplianceFrameworks has %d fields, want 17", len(tags))
	}
	items := schema.Schema.Properties.Entries.Items
	for _, cloud := range []string{"azure", "azureGovernment"} {
		t.Run(cloud, func(t *testing.T) {
			p, ok := items.Properties[cloud]
			if !ok {
				t.Fatalf("schema has no %q object", cloud)
			}
			if len(p.Properties) != len(tags) {
				t.Errorf("schema %s has %d properties, want %d", cloud, len(p.Properties), len(tags))
			}
			for _, tag := range tags {
				if p.Properties[tag].Type != "boolean" {
					t.Errorf("schema %s.%s type = %q, want boolean", cloud, tag, p.Properties[tag].Type)
				}
			}
			if !reflect.DeepEqual(p.Required, tags) {
				t.Errorf("schema %s required = %v, want %v", cloud, p.Required, tags)
			}
		})
	}
	for _, want := range []string{"serviceName", "azure", "azureGovernment"} {
		if !contains(items.Required, want) {
			t.Errorf("entry schema does not require %q", want)
		}
	}
	if !contains(schema.Schema.Required, "entries") {
		t.Errorf("top-level schema does not require entries")
	}
}

// TestUserPromptMatchesReport checks the example JSON in the user prompt
// names every framework field, in both clouds.
func TestUserPromptMatchesReport(t *testing.T) {
	prompt := buildUserPrompt()
	for _, tag := range frameworkTags(t) {
		if n := strings.Count(prompt, `"`+tag+`"`); n != 2 {
			t.Errorf("user prompt names %q %d times, want 2 (azure and azureGovernment)", tag, n)
		}
	}
	if !strings.Contains(buildSystemPrompt(), "17. Spain ENS High") {
		t.Errorf("system prompt does not list all 17 frameworks")
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// isNamesRequest tells the service-name step from a batch request.
func isNamesRequest(req azureOpenAIRequest) bool {
	return req.ResponseFormat != nil && strings.Contains(string(req.ResponseFormat.JSONSchema), `"service_names"`)
}

// requestedServices returns the numbered services a batch request asks for.
func requestedServices(req azureOpenAIRequest) []string {
	var out []string
	user := req.Messages[len(req.Messages)-1].Content
	for _, line := range strings.Split(user, "\n") {
		var n int
		var name string
		if i := strings.Index(line, ". "); i > 0 {
			if _, err := fmt.Sscanf(line[:i], "%d", &n); err == nil && n > 0 {
				name = line[i+2:]
				out = append(out, name)
			}
		}
	}
	return out
}

func TestParsePDF(t *testing.T) {
	manyNames := make([]string, batchSize+3)
	for i := range manyNames {
		manyNames[i] = fmt.Sprintf("Service %03d", i)
	}

	tests := []struct {
		name        string
		pdf         []byte
		names       []string
		failBatches bool
		wantErr     string
		wantNames   []string
		wantCalls   int
	}{
		{
			name:      "single batch",
			pdf:       buildPDF(t, "Key Vault Storage"),
			names:     []string{"Azure Key Vault", "Azure Storage", "azure storage"},
			wantNames: []string{"Azure Key Vault", "Azure Storage"},
			wantCalls: 2,
		},
		{
			name:      "two batches keep order",
			pdf:       buildPDF(t, "many"),
			names:     manyNames,
			wantNames: manyNames,
			wantCalls: 3,
		},
		{name: "malformed pdf makes no requests", pdf: []byte("not a pdf"), wantErr: "failed to extract PDF text", wantCalls: 0},
		{name: "no services found", pdf: buildPDF(t, "empty"), names: []string{}, wantErr: "zero service entries", wantCalls: 1},
		{name: "batch failure fails the sync", pdf: buildPDF(t, "x"), names: []string{"Azure DNS"}, failBatches: true, wantErr: "batch 1 failed", wantCalls: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeOpenAI{}
			srv := fake.server(t, func(req azureOpenAIRequest) (int, string) {
				if isNamesRequest(req) {
					b, _ := json.Marshal(serviceNamesResponse{ServiceNames: tt.names})
					return 200, completion(t, string(b))
				}
				if tt.failBatches {
					return 400, "content filtered"
				}
				var in report.ComplianceInput
				for _, name := range requestedServices(req) {
					in.Entries = append(in.Entries, report.ServiceEntry{ServiceName: name, Azure: report.ComplianceFrameworks{Soc1_2_3: true}})
				}
				b, _ := json.Marshal(in)
				return 200, completion(t, string(b))
			})

			got, err := ParsePDF(tt.pdf, srv.URL, "k", "d")
			if len(fake.requests) != tt.wantCalls {
				t.Errorf("server saw %d requests, want %d", len(fake.requests), tt.wantCalls)
			}
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			var gotNames []string
			for _, e := range got.Entries {
				gotNames = append(gotNames, e.ServiceName)
				if !e.Azure.Soc1_2_3 {
					t.Errorf("%s lost its flags", e.ServiceName)
				}
			}
			if !reflect.DeepEqual(gotNames, tt.wantNames) {
				t.Errorf("entries = %q, want %q", gotNames, tt.wantNames)
			}
			if got.SourceDocument == "" || len(got.VerifiedDate) != len("2006-01-02") {
				t.Errorf("source %q / verified date %q not set", got.SourceDocument, got.VerifiedDate)
			}
		})
	}
}
