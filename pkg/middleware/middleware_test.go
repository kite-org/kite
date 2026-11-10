package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	dto "github.com/prometheus/client_model/go"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
)

func TestMethod2Verb(t *testing.T) {
	tests := []struct {
		name   string
		method string
		want   string
	}{
		{name: "post", method: http.MethodPost, want: "create"},
		{name: "put", method: http.MethodPut, want: "update"},
		{name: "patch", method: http.MethodPatch, want: "update"},
		{name: "delete", method: http.MethodDelete, want: "delete"},
		{name: "get", method: http.MethodGet, want: "get"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := method2verb(tt.method); got != tt.want {
				t.Fatalf("method2verb(%q) = %q, want %q", tt.method, got, tt.want)
			}
		})
	}
}

func TestStaticCache(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rec := httptest.NewRecorder()
	r := gin.New()
	r.Use(StaticCache())
	r.GET("/assets/app.js", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	r.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q, want %q", got, "public, max-age=31536000, immutable")
	}
}

func TestDevCORS(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("allowed origin sets headers", func(t *testing.T) {
		rec := httptest.NewRecorder()
		r := gin.New()
		r.Use(DevCORS([]string{"http://localhost:5173/"}))
		r.OPTIONS("/api/v1/pods", func(c *gin.Context) {
			c.Status(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodOptions, "/api/v1/pods", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
			t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, "http://localhost:5173")
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Fatalf("Access-Control-Allow-Credentials = %q, want %q", got, "true")
		}
	})

	t.Run("disallowed origin passes through", func(t *testing.T) {
		rec := httptest.NewRecorder()
		r := gin.New()
		called := false
		r.Use(DevCORS([]string{"http://localhost:5173"}))
		r.GET("/api/v1/pods", func(c *gin.Context) {
			called = true
			c.Status(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
		req.Header.Set("Origin", "https://example.com")
		r.ServeHTTP(rec, req)

		if !called {
			t.Fatal("handler was not called")
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("Access-Control-Allow-Origin = %q, want empty", got)
		}
	})
}

func TestLogger(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldWriter := gin.DefaultWriter
	defer func() { gin.DefaultWriter = oldWriter }()

	t.Run("skips unlogged paths", func(t *testing.T) {
		var buf bytes.Buffer
		gin.DefaultWriter = &buf

		r := gin.New()
		r.Use(Logger())
		r.GET("/healthz", func(c *gin.Context) {
			c.Status(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.RemoteAddr = "203.0.113.9:1234"
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if buf.Len() != 0 {
			t.Fatalf("expected no log output, got %q", buf.String())
		}
	})

	t.Run("includes cluster and user keys", func(t *testing.T) {
		var buf bytes.Buffer
		gin.DefaultWriter = &buf

		r := gin.New()
		r.Use(Logger())
		r.GET("/api/v1/pods", func(c *gin.Context) {
			c.Set("user", model.User{Username: "alice"})
			c.Set(ClusterNameKey, "cluster-a")
			c.Status(http.StatusCreated)
		})

		req := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
		req.RemoteAddr = "203.0.113.9:1234"
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		got := buf.String()
		if !strings.Contains(got, "203.0.113.9") || !strings.Contains(got, "\"GET /api/v1/pods\" 201") || !strings.Contains(got, "cluster-a") || !strings.Contains(got, "alice") {
			t.Fatalf("unexpected log output: %q", got)
		}
	})
}

func TestMetrics(t *testing.T) {
	gin.SetMode(gin.TestMode)

	counterValue := func(counter interface{ Write(*dto.Metric) error }) float64 {
		metric := &dto.Metric{}
		if err := counter.Write(metric); err != nil {
			t.Fatalf("counter.Write() error = %v", err)
		}
		return metric.GetCounter().GetValue()
	}

	t.Run("records matched route", func(t *testing.T) {
		method := "GET"
		route := "/api/v1/pods/:name"
		status := "201"
		counter := httpRequestsTotal.WithLabelValues(method, route, status)
		before := counterValue(counter)

		r := gin.New()
		r.Use(Metrics())
		r.GET("/api/v1/pods/:name", func(c *gin.Context) {
			c.Status(http.StatusCreated)
		})

		req := httptest.NewRequest(http.MethodGet, "/api/v1/pods/nginx", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if got := counterValue(counter); got != before+1 {
			t.Fatalf("counter = %v, want %v", got, before+1)
		}
	})

	t.Run("skips options and healthz", func(t *testing.T) {
		optionsCounter := httpRequestsTotal.WithLabelValues("OPTIONS", "/api/v1/pods", "204")
		healthCounter := httpRequestsTotal.WithLabelValues("GET", "/healthz", "200")
		beforeOptions := counterValue(optionsCounter)
		beforeHealth := counterValue(healthCounter)

		r := gin.New()
		r.Use(Metrics())
		r.OPTIONS("/api/v1/pods", func(c *gin.Context) {
			c.Status(http.StatusNoContent)
		})
		r.GET("/healthz", func(c *gin.Context) {
			c.Status(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodOptions, "/api/v1/pods", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		req = httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec = httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if got := counterValue(optionsCounter); got != beforeOptions {
			t.Fatalf("OPTIONS counter = %v, want %v", got, beforeOptions)
		}
		if got := counterValue(healthCounter); got != beforeHealth {
			t.Fatalf("healthz counter = %v, want %v", got, beforeHealth)
		}
	})

	t.Run("normalizes unmatched route to unknown", func(t *testing.T) {
		unknownCounter := httpRequestsTotal.WithLabelValues("GET", "unknown", "404")
		beforeUnknown := counterValue(unknownCounter)

		r := gin.New()
		r.Use(Metrics())

		req := httptest.NewRequest(http.MethodGet, "/random/unmatched/path/12345", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if got := counterValue(unknownCounter); got != beforeUnknown+1 {
			t.Fatalf("unknown counter = %v, want %v", got, beforeUnknown+1)
		}
	})
}

func TestClusterMiddlewareNoClusters(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rec := httptest.NewRecorder()
	r := gin.New()
	r.Use(ClusterMiddleware(&cluster.ClusterManager{}))
	r.GET("/api/v1/pods", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "no clusters available") {
		t.Fatalf("response body = %q, want error message", rec.Body.String())
	}
}
