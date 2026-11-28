package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type staticClusterProvider struct {
	cs *cluster.ClientSet
}

func (p *staticClusterProvider) GetClientSet(string) (*cluster.ClientSet, error) {
	return p.cs, nil
}

func TestClusterMiddlewareImpersonatesUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("DISABLE_CACHE", "true")

	var mu sync.Mutex
	var impersonatedUser string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_, _ = w.Write([]byte(`{"major":"1","minor":"34","gitVersion":"v1.34.0"}`))
		case "/api/v1/namespaces/monitoring/services":
			_, _ = w.Write([]byte(`{"kind":"ServiceList","apiVersion":"v1","items":[]}`))
		default:
			mu.Lock()
			impersonatedUser = r.Header.Get("Impersonate-User")
			mu.Unlock()
			_, _ = w.Write([]byte(`{"kind":"PodList","apiVersion":"v1","items":[]}`))
		}
	}))
	defer server.Close()

	base, err := cluster.NewClientSet("test", &rest.Config{Host: server.URL}, "", true)
	if err != nil {
		t.Fatalf("NewClientSet() error = %v", err)
	}
	provider := &staticClusterProvider{cs: base}

	var injected *cluster.ClientSet
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user", model.User{Username: "alice@example.com", OIDCGroups: model.SliceString{"dev"}})
		c.Next()
	})
	r.Use(ClusterMiddleware(provider))
	r.GET("/api/v1/pods", func(c *gin.Context) {
		injected = c.MustGet("cluster").(*cluster.ClientSet)
		c.Status(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if injected == base || !injected.ImpersonationEnabled() {
		t.Fatal("middleware did not inject a per-user impersonating client set")
	}
	if _, err := injected.K8sClient.ClientSet.CoreV1().Pods("default").List(context.Background(), metav1.ListOptions{}); err != nil {
		t.Fatalf("List() error = %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if impersonatedUser != "alice@example.com" {
		t.Fatalf("Impersonate-User = %q, want %q", impersonatedUser, "alice@example.com")
	}
}

func TestClusterMiddlewareRequiresUserForImpersonation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("DISABLE_CACHE", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"ServiceList","apiVersion":"v1","items":[]}`))
	}))
	defer server.Close()

	base, err := cluster.NewClientSet("test", &rest.Config{Host: server.URL}, "", true)
	if err != nil {
		t.Fatalf("NewClientSet() error = %v", err)
	}

	r := gin.New()
	r.Use(ClusterMiddleware(&staticClusterProvider{cs: base}))
	r.GET("/api/v1/pods", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
