package kube

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"k8s.io/client-go/rest"
)

func TestBuildProxyURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		host      string
		kind      string
		namespace string
		resource  string
		path      string
		rawQuery  string
		want      string
		wantErr   bool
	}{
		{
			name:      "encodes and joins proxy url",
			host:      "https://example.com/",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/logs/",
			rawQuery:  "b=2&a=1",
			want:      "https://example.com/api/v1/namespaces/default/pods/nginx/proxy/logs/?a=1&b=2",
		},
		{
			name:      "rejects invalid query",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "",
			rawQuery:  "%",
			wantErr:   true,
		},
		{
			name:      "rejects path traversal to cross-namespace secrets",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/../../../../kube-system/secrets",
			rawQuery:  "",
			wantErr:   true,
		},
		{
			name:      "rejects path traversal to cluster-scoped endpoint",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/../../../../../secrets",
			rawQuery:  "",
			wantErr:   true,
		},
		{
			name:      "allows legitimate nested proxy path",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/api/v1/data/snapshot",
			rawQuery:  "",
			want:      "https://example.com/api/v1/namespaces/default/pods/nginx/proxy/api/v1/data/snapshot",
		},
		{
			name:      "re-encodes an encoded traversal segment",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/%2e%2e/secrets",
			rawQuery:  "",
			want:      "https://example.com/api/v1/namespaces/default/pods/nginx/proxy/%252e%252e/secrets",
		},
		{
			name:      "preserves api server path prefix",
			host:      "https://example.com/k8s/clusters/local",
			kind:      "pods",
			namespace: "default",
			resource:  "nginx",
			path:      "/logs",
			rawQuery:  "",
			want:      "https://example.com/k8s/clusters/local/api/v1/namespaces/default/pods/nginx/proxy/logs",
		},
		{
			name:      "rejects traversal encoded in resource name",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "%2e%2e%2f%2e%2e%2f%2e%2e%2fnamespaces%2fkube-system%2fservices%2fhttp:kube-dns:metrics",
			path:      "/metrics",
			rawQuery:  "",
			wantErr:   true,
		},
		{
			name:      "rejects traversal in resource name",
			host:      "https://example.com",
			kind:      "pods",
			namespace: "default",
			resource:  "../../../namespaces/kube-system/services/http:kube-dns:metrics",
			path:      "/metrics",
			rawQuery:  "",
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := buildProxyURL(tt.host, tt.kind, tt.namespace, tt.resource, tt.path, tt.rawQuery)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got url %q", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("buildProxyURL() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("buildProxyURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCloneHeader(t *testing.T) {
	t.Parallel()

	src := http.Header{}
	src.Add("X-Test", "one")
	src.Add("X-Test", "two")
	src.Add("Authorization", "token")

	got := cloneHeader(src)
	src.Set("X-Test", "changed")

	if !reflect.DeepEqual(got.Values("X-Test"), []string{"one", "two"}) {
		t.Fatalf("cloneHeader() copied values = %v, want %v", got.Values("X-Test"), []string{"one", "two"})
	}
	if got.Get("Authorization") != "token" {
		t.Fatalf("cloneHeader() authorization = %q, want %q", got.Get("Authorization"), "token")
	}
}

func TestCopyHeader(t *testing.T) {
	t.Parallel()

	dst := http.Header{}
	src := http.Header{}
	src.Add("X-Test", "one")
	src.Add("X-Test", "two")

	copyHeader(dst, src)
	src.Set("X-Test", "changed")

	if !reflect.DeepEqual(dst.Values("X-Test"), []string{"one", "two"}) {
		t.Fatalf("copyHeader() copied values = %v, want %v", dst.Values("X-Test"), []string{"one", "two"})
	}
}

func TestSanitizeProxyRequestHeaders(t *testing.T) {
	t.Parallel()

	src := http.Header{
		"Authorization":           {"Bearer secret"},
		"Cookie":                  {"session=abc"},
		"Connection":              {"keep-alive"},
		"Impersonate-User":        {"system:admin"},
		"Impersonate-Group":       {"system:masters"},
		"Impersonate-Uid":         {"0000"},
		"Impersonate-Extra-Scope": {"all"},
		"iMpErSoNaTe-user":        {"root"},
		"Accept":                  {"application/json"},
		"X-Custom":                {"keep"},
	}

	got := sanitizeProxyRequestHeaders(src)

	for _, stripped := range []string{
		"Authorization",
		"Cookie",
		"Connection",
		"Impersonate-User",
		"Impersonate-Group",
		"Impersonate-Uid",
		"Impersonate-Extra-Scope",
		"iMpErSoNaTe-user",
	} {
		if values := got.Values(stripped); len(values) != 0 {
			t.Fatalf("expected header %q to be stripped, got %v", stripped, values)
		}
	}
	if got.Get("Accept") != "application/json" || got.Get("X-Custom") != "keep" {
		t.Fatalf("unexpected preserved headers: %#v", got)
	}
}

func TestHandleProxyStripsImpersonateHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var received http.Header
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	k8sClient := &K8sClient{
		Configuration: &rest.Config{Host: upstream.URL},
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/namespaces/default/services/web/proxy/health", nil)
	req.Header.Set("Impersonate-User", "system:admin")
	req.Header.Add("Impersonate-Group", "system:masters")
	req.Header.Set("Impersonate-Extra-Role", "cluster-admin")
	req.Header.Set("X-Forwarded-Custom", "preserved")
	c.Request = req

	HandleProxy(c, k8sClient, "services", "default", "web", "/health")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	for k := range received {
		if k == "Impersonate-User" || k == "Impersonate-Group" || k == "Impersonate-Extra-Role" {
			t.Fatalf("upstream received forbidden header %q: %v", k, received.Values(k))
		}
	}
	if got := received.Get("X-Forwarded-Custom"); got != "preserved" {
		t.Fatalf("X-Forwarded-Custom = %q, want %q", got, "preserved")
	}
}
