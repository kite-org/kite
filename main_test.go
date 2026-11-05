package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/version"
)

func TestRegisterBaseRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldVersion := version.Version
	oldBuildDate := version.BuildDate
	oldCommitID := version.CommitID
	oldEnableVersionCheck := common.EnableVersionCheck
	defer func() {
		version.Version = oldVersion
		version.BuildDate = oldBuildDate
		version.CommitID = oldCommitID
		common.EnableVersionCheck = oldEnableVersionCheck
	}()

	version.Version = "v1.2.3"
	version.BuildDate = "2026-03-27"
	version.CommitID = "abc123"
	common.EnableVersionCheck = false

	r := gin.New()
	registerBaseRoutes(&r.RouterGroup)

	t.Run("healthz", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if got := strings.TrimSpace(rec.Body.String()); got != `{"status":"ok"}` {
			t.Fatalf("body = %q, want %q", got, `{"status":"ok"}`)
		}
	})

	t.Run("version", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		var got map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("json.Unmarshal() error = %v", err)
		}
		if got["version"] != "v1.2.3" || got["buildDate"] != "2026-03-27" || got["commitId"] != "abc123" {
			t.Fatalf("unexpected version payload: %#v", got)
		}
	})
}

func TestConfigureTrustedProxiesIgnoresForwardedForFromUntrustedPeerByDefault(t *testing.T) {
	if got := clientIPForForwardedRequest(t, nil, "198.51.100.10:12345", "127.0.0.1"); got == "127.0.0.1" {
		t.Fatalf("ClientIP() trusted X-Forwarded-For from untrusted peer: got %q", got)
	}
}

func TestConfigureTrustedProxiesUsesForwardedForFromDefaultPrivateProxy(t *testing.T) {
	if got := clientIPForForwardedRequest(t, nil, "192.168.1.10:12345", "203.0.113.9"); got != "203.0.113.9" {
		t.Fatalf("ClientIP() = %q, want forwarded client IP from default private proxy", got)
	}
}

func TestConfigureTrustedProxiesUsesForwardedForFromTrustedProxy(t *testing.T) {
	if got := clientIPForForwardedRequest(t, []string{"192.0.2.0/24"}, "192.0.2.10:12345", "203.0.113.9"); got != "203.0.113.9" {
		t.Fatalf("ClientIP() = %q, want forwarded client IP", got)
	}
}

func clientIPForForwardedRequest(t *testing.T, trustedProxies []string, remoteAddr, forwardedFor string) string {
	t.Helper()

	gin.SetMode(gin.TestMode)

	oldTrustedProxies := common.TrustedProxies
	t.Cleanup(func() {
		common.TrustedProxies = oldTrustedProxies
	})
	if trustedProxies != nil {
		common.TrustedProxies = trustedProxies
	}

	r := gin.New()
	configureTrustedProxies(r)
	r.GET("/client-ip", func(c *gin.Context) {
		c.String(http.StatusOK, c.ClientIP())
	})

	req := httptest.NewRequest(http.MethodGet, "/client-ip", nil)
	req.RemoteAddr = remoteAddr
	req.Header.Set("X-Forwarded-For", forwardedFor)
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	return strings.TrimSpace(rec.Body.String())
}

func TestSetupStatic(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldBase := common.Base
	oldEnableAnalytics := common.EnableAnalytics
	defer func() {
		common.Base = oldBase
		common.EnableAnalytics = oldEnableAnalytics
	}()

	common.Base = "/kite"
	common.EnableAnalytics = true

	r := gin.New()
	setupStatic(r)

	t.Run("redirects root to base", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusFound {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
		}
		if location := rec.Header().Get("Location"); location != "/kite/" {
			t.Fatalf("Location = %q, want %q", location, "/kite/")
		}
	})

	t.Run("serves index for ui routes with base injected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/kite/overview", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `window.__dynamic_base__="/kite"`) {
			t.Fatalf("body missing dynamic base injection")
		}
	})

	t.Run("returns api 404 for missing api route", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/kite/api/missing", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
		}
		if got := strings.TrimSpace(rec.Body.String()); got != `{"error":"API endpoint not found"}` {
			t.Fatalf("body = %q, want %q", got, `{"error":"API endpoint not found"}`)
		}
	})
}
