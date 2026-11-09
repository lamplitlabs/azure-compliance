package parser

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lamplitlabs/azure-compliance/internal/report"
)

func TestMain(m *testing.M) {
	// The parser logs every request; keep test output readable.
	log.SetOutput(io.Discard)
	os.Exit(m.Run())
}

func TestChunk(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		size int
		want [][]string
	}{
		{name: "empty", in: nil, size: 3, want: nil},
		{name: "smaller than size", in: []string{"a", "b"}, size: 3, want: [][]string{{"a", "b"}}},
		{name: "exact multiple", in: []string{"a", "b", "c", "d"}, size: 2, want: [][]string{{"a", "b"}, {"c", "d"}}},
		{name: "remainder", in: []string{"a", "b", "c", "d", "e"}, size: 2, want: [][]string{{"a", "b"}, {"c", "d"}, {"e"}}},
		{name: "size one", in: []string{"a", "b"}, size: 1, want: [][]string{{"a"}, {"b"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := chunk(tt.in, tt.size)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("chunk(%v, %d) = %v, want %v", tt.in, tt.size, got, tt.want)
			}
		})
	}
}

func TestChunkKeepsEveryServiceAtBatchSize(t *testing.T) {
	in := make([]string, 2*batchSize+7)
	for i := range in {
		in[i] = strings.Repeat("s", i+1)
	}
	got := chunk(in, batchSize)
	if len(got) != 3 {
		t.Fatalf("got %d batches, want 3", len(got))
	}
	var flat []string
	for _, b := range got {
		if len(b) > batchSize {
			t.Fatalf("batch of %d exceeds batchSize %d", len(b), batchSize)
		}
		flat = append(flat, b...)
	}
	if !reflect.DeepEqual(flat, in) {
		t.Fatal("chunking lost or reordered services")
	}
}

// frameworkJSONKeys returns the JSON field names of report.ComplianceFrameworks.
func frameworkJSONKeys(t *testing.T) []string {
	t.Helper()
	typ := reflect.TypeOf(report.ComplianceFrameworks{})
	keys := make([]string, 0, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		tag := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if tag == "" {
			t.Fatalf("field %s has no json tag", typ.Field(i).Name)
		}
		keys = append(keys, tag)
	}
	sort.Strings(keys)
	return keys
}

// The response schema, the prompt and report.ComplianceFrameworks must agree on
// the 17 framework keys; a drift silently drops a framework from the matrix.
func TestResponseSchemaMatchesReportFrameworks(t *testing.T) {
	want := frameworkJSONKeys(t)
	if len(want) != 17 {
		t.Fatalf("report.ComplianceFrameworks has %d frameworks, want 17", len(want))
	}

	var schema struct {
		Name   string `json:"name"`
		Schema struct {
			Required   []string `json:"required"`
			Properties struct {
				Entries struct {
					Items struct {
						Required   []string `json:"required"`
						Properties map[string]struct {
							Type       string                     `json:"type"`
							Required   []string                   `json:"required"`
							Properties map[string]json.RawMessage `json:"properties"`
						} `json:"properties"`
					} `json:"items"`
				} `json:"entries"`
			} `json:"properties"`
		} `json:"schema"`
	}
	if err := json.Unmarshal([]byte(getResponseSchema()), &schema); err != nil {
		t.Fatalf("response schema is not valid JSON: %v", err)
	}
	if schema.Name == "" {
		t.Error("response schema has no name")
	}
	if got := sortedCopy(schema.Schema.Required); !reflect.DeepEqual(got, []string{"entries", "sourceDocument", "verifiedDate"}) {
		t.Errorf("top-level required = %v", got)
	}
	items := schema.Schema.Properties.Entries.Items
	if got := sortedCopy(items.Required); !reflect.DeepEqual(got, []string{"azure", "azureGovernment", "serviceName"}) {
		t.Errorf("entry required = %v", got)
	}

	for _, cloud := range []string{"azure", "azureGovernment"} {
		t.Run(cloud, func(t *testing.T) {
			obj, ok := items.Properties[cloud]
			if !ok {
				t.Fatalf("schema has no %q object", cloud)
			}
			props := make([]string, 0, len(obj.Properties))
			for k := range obj.Properties {
				props = append(props, k)
			}
			sort.Strings(props)
			if !reflect.DeepEqual(props, want) {
				t.Errorf("schema properties = %v, want %v", props, want)
			}
			if got := sortedCopy(obj.Required); !reflect.DeepEqual(got, want) {
				t.Errorf("schema required = %v, want %v", got, want)
			}
		})
	}

	prompt := buildUserPrompt()
	for _, key := range want {
		if c := strings.Count(prompt, `"`+key+`"`); c != 2 {
			t.Errorf("user prompt mentions %q %d times, want 2 (azure and azureGovernment)", key, c)
		}
	}
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

// fakeOpenAI serves Azure OpenAI chat completions. reply gets the decoded
// request and returns the HTTP status and the assistant message content.
type fakeOpenAI struct {
	srv      *httptest.Server
	calls    atomic.Int32
	lastPath atomic.Value
	lastKey  atomic.Value
}

func newFakeOpenAI(t *testing.T, reply func(req azureOpenAIRequest) (int, string)) *fakeOpenAI {
	t.Helper()
	f := &fakeOpenAI{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls.Add(1)
		f.lastPath.Store(r.URL.RequestURI())
		f.lastKey.Store(r.Header.Get("api-key"))
		var req azureOpenAIRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request body", http.StatusBadRequest)
			return
		}
		status, content := reply(req)
		w.WriteHeader(status)
		if status != http.StatusOK {
			io.WriteString(w, content)
			return
		}
		resp := azureOpenAIResponse{}
		resp.Choices = append(resp.Choices, struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		}{})
		resp.Choices[0].Message.Content = content
		json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func TestCallAzureOpenAI(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		want    string
		wantErr string
	}{
		{
			name: "first choice content",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{"choices":[{"message":{"content":"first"}},{"message":{"content":"second"}}]}`)
			},
			want: "first",
		},
		{
			name: "no choices",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{"choices":[]}`)
			},
			wantErr: "no choices",
		},
		{
			name: "malformed body",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `not json`)
			},
			wantErr: "failed to parse response",
		},
		{
			name: "non-retryable status",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusUnauthorized)
				io.WriteString(w, "denied")
			},
			wantErr: "status 401: denied",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				tt.handler(w, r)
			}))
			defer srv.Close()

			got, err := callAzureOpenAI(srv.URL, "key", "dep", nil, nil)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("content = %q, want %q", got, tt.want)
			}
			// None of these cases may be retried: retries sleep for tens of seconds.
			if n := calls.Load(); n != 1 {
				t.Errorf("server called %d times, want 1", n)
			}
		})
	}
}

func TestCallAzureOpenAIRequestShape(t *testing.T) {
	f := newFakeOpenAI(t, func(req azureOpenAIRequest) (int, string) {
		if len(req.Messages) != 1 || req.Messages[0].Role != "user" || req.Messages[0].Content != "hi" {
			return http.StatusBadRequest, "unexpected messages"
		}
		if req.ResponseFormat == nil || req.ResponseFormat.Type != "json_schema" {
			return http.StatusBadRequest, "unexpected response_format"
		}
		return http.StatusOK, "ok"
	})

	// A trailing slash on the endpoint must not produce a double slash.
	got, err := callAzureOpenAI(f.srv.URL+"/", "secret-key", "gpt-dep",
		[]chatMessage{{Role: "user", Content: "hi"}},
		&responseFormat{Type: "json_schema", JSONSchema: json.RawMessage(`{"name":"x"}`)})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "ok" {
		t.Errorf("content = %q, want ok", got)
	}
	wantPath := "/openai/deployments/gpt-dep/chat/completions?api-version=2025-04-01-preview"
	if p := f.lastPath.Load(); p != wantPath {
		t.Errorf("path = %v, want %s", p, wantPath)
	}
	if k := f.lastKey.Load(); k != "secret-key" {
		t.Errorf("api-key header = %v, want secret-key", k)
	}
}

func TestGetServiceNames(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
		wantErr string
	}{
		{
			name:    "keeps document order",
			content: `{"serviceNames":["Azure Monitor","API Management","Azure Bot Service"]}`,
			want:    []string{"Azure Monitor", "API Management", "Azure Bot Service"},
		},
		{
			name:    "dedupes case-insensitively and trims, keeping the first spelling",
			content: `{"serviceNames":["Azure Monitor"," azure monitor ","AZURE MONITOR","Key Vault","Key Vault "]}`,
			want:    []string{"Azure Monitor", "Key Vault"},
		},
		{
			name:    "drops empty names",
			content: `{"serviceNames":["","Key Vault"]}`,
			want:    []string{"Key Vault"},
		},
		{
			name:    "empty list",
			content: `{"serviceNames":[]}`,
			want:    nil,
		},
		{
			name:    "not json",
			content: `Here are the services: Key Vault`,
			wantErr: "failed to parse service names",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeOpenAI(t, func(req azureOpenAIRequest) (int, string) {
				if len(req.Messages) != 2 || !strings.Contains(req.Messages[1].Content, "PDF TEXT") {
					return http.StatusBadRequest, "pdf text not sent"
				}
				return http.StatusOK, tt.content
			})
			got, err := getServiceNames(f.srv.URL, "k", "d", "PDF TEXT")
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGetComplianceEntries(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []report.ServiceEntry
		wantErr string
	}{
		{
			name: "maps every framework flag per cloud",
			content: `{"sourceDocument":"doc","verifiedDate":"2026-11-02","entries":[
				{"serviceName":"Key Vault",
				 "azure":{"csaStarCertification":true,"iso27001_27018":true,"soc1_2_3":true,"hipaaBaa":true,"pciDss":true,"spainEnsHigh":true},
				 "azureGovernment":{"hitrust":true,"germanyC5":true}}]}`,
			want: []report.ServiceEntry{{
				ServiceName: "Key Vault",
				Azure: report.ComplianceFrameworks{
					CsaStarCertification: true, Iso27001_27018: true, Soc1_2_3: true,
					HipaaBaa: true, PciDss: true, SpainEnsHigh: true,
				},
				AzureGovernment: report.ComplianceFrameworks{Hitrust: true, GermanyC5: true},
			}},
		},
		{
			name:    "service missing from Azure Government defaults to false",
			content: `{"entries":[{"serviceName":"Azure Bot Service","azure":{"kIsms":true}}]}`,
			want: []report.ServiceEntry{{
				ServiceName: "Azure Bot Service",
				Azure:       report.ComplianceFrameworks{KIsms: true},
			}},
		},
		{
			name:    "no entries",
			content: `{"entries":[]}`,
			want:    []report.ServiceEntry{},
		},
		{
			name:    "truncated json",
			content: `{"entries":[{"serviceName":"Key Va`,
			wantErr: "failed to parse compliance entries",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeOpenAI(t, func(req azureOpenAIRequest) (int, string) {
				if len(req.Messages) != 2 {
					return http.StatusBadRequest, "want system and user messages"
				}
				user := req.Messages[1].Content
				if !strings.Contains(user, "PDF TEXT") || !strings.Contains(user, "1. Key Vault\n2. Azure Bot Service\n") {
					return http.StatusBadRequest, "user prompt lacks pdf text or numbered service list"
				}
				return http.StatusOK, tt.content
			})
			got, err := getComplianceEntries(f.srv.URL, "k", "d", "PDF TEXT", []string{"Key Vault", "Azure Bot Service"})
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want it to contain %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParsePDFRejectsInvalidPDF(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
	}{
		{name: "empty", in: nil},
		{name: "html error page", in: []byte("<html><body>Access denied</body></html>")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFakeOpenAI(t, func(req azureOpenAIRequest) (int, string) {
				return http.StatusOK, `{"serviceNames":[]}`
			})
			_, err := ParsePDF(tt.in, f.srv.URL, "k", "d")
			if err == nil || !strings.Contains(err.Error(), "failed to extract PDF text") {
				t.Fatalf("err = %v, want a PDF extraction error", err)
			}
			if n := f.calls.Load(); n != 0 {
				t.Errorf("Azure OpenAI called %d times for an invalid PDF, want 0", n)
			}
		})
	}
}
