package version

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestParseSemver(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "with v prefix", input: "v1.2.3", want: "1.2.3"},
		{name: "without v prefix", input: "1.2.3", want: "1.2.3"},
		{name: "invalid", input: "not-a-version", wantErr: true},
		{name: "empty", input: "   ", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseSemver(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.String() != tt.want {
				t.Fatalf("unexpected version: want %q, got %q", tt.want, got.String())
			}
		})
	}
}

func TestGetVersionWithoutVersionCheck(t *testing.T) {
	gin.SetMode(gin.TestMode)

	origVersion := Version
	origBuildDate := BuildDate
	origCommitID := CommitID
	origEnableVersionCheck := common.EnableVersionCheck
	t.Cleanup(func() {
		Version = origVersion
		BuildDate = origBuildDate
		CommitID = origCommitID
		common.EnableVersionCheck = origEnableVersionCheck
	})

	Version = "1.2.3"
	BuildDate = "2026-03-27"
	CommitID = "abc123"
	common.EnableVersionCheck = false

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/version", nil)

	GetVersion(c)

	if recorder.Code != 200 {
		t.Fatalf("unexpected status code: %d", recorder.Code)
	}

	var got VersionInfo
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if got.Version != "1.2.3" || got.BuildDate != "2026-03-27" || got.CommitID != "abc123" {
		t.Fatalf("unexpected version info: %#v", got)
	}
	if got.HasNew || got.Release != "" {
		t.Fatalf("unexpected update fields: %#v", got)
	}
}

func TestGetVersionWithCachedUpdateResult(t *testing.T) {
	gin.SetMode(gin.TestMode)

	origVersion := Version
	origBuildDate := BuildDate
	origCommitID := CommitID
	origEnableVersionCheck := common.EnableVersionCheck
	origCachedUpdateResult := cachedUpdateResult
	origLastUpdateFetch := lastUpdateFetch
	t.Cleanup(func() {
		Version = origVersion
		BuildDate = origBuildDate
		CommitID = origCommitID
		common.EnableVersionCheck = origEnableVersionCheck
		cachedUpdateResult = origCachedUpdateResult
		lastUpdateFetch = origLastUpdateFetch
	})

	Version = "1.2.3"
	BuildDate = "2026-03-27"
	CommitID = "abc123"
	common.EnableVersionCheck = true
	cachedUpdateResult = updateCheckResult{
		hasNew:     true,
		releaseURL: "https://example.com/releases/v1.2.4",
	}
	lastUpdateFetch = time.Now()

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/version", nil)

	GetVersion(c)

	if recorder.Code != 200 {
		t.Fatalf("unexpected status code: %d", recorder.Code)
	}

	var got VersionInfo
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if !got.HasNew || got.Release != "https://example.com/releases/v1.2.4" {
		t.Fatalf("unexpected update fields: %#v", got)
	}
}

func TestCheckForUpdateShortCircuitsWithoutNetwork(t *testing.T) {
	origCachedUpdateResult := cachedUpdateResult
	origLastUpdateFetch := lastUpdateFetch
	t.Cleanup(func() {
		cachedUpdateResult = origCachedUpdateResult
		lastUpdateFetch = origLastUpdateFetch
	})

	cachedUpdateResult = updateCheckResult{
		hasNew:     true,
		releaseURL: "https://example.com/releases/v1.2.4",
	}
	lastUpdateFetch = time.Now()

	got := checkForUpdate(context.Background(), "1.2.3")
	if !got.hasNew || got.releaseURL != "https://example.com/releases/v1.2.4" {
		t.Fatalf("unexpected cached result: %#v", got)
	}
}

func TestCheckForUpdateSkipsBlankAndDevVersions(t *testing.T) {
	if got := checkForUpdate(context.Background(), "   "); got != (updateCheckResult{}) {
		t.Fatalf("blank version result = %#v, want zero value", got)
	}
	if got := checkForUpdate(context.Background(), "dev"); got != (updateCheckResult{}) {
		t.Fatalf("dev version result = %#v, want zero value", got)
	}
}

func TestCheckForUpdateFromGitHub(t *testing.T) {
	origClient := http.DefaultClient
	origCachedUpdateResult := cachedUpdateResult
	origLastUpdateFetch := lastUpdateFetch
	t.Cleanup(func() {
		http.DefaultClient = origClient
		cachedUpdateResult = origCachedUpdateResult
		lastUpdateFetch = origLastUpdateFetch
	})

	tests := []struct {
		name           string
		currentVersion string
		statusCode     int
		body           string
		requestErr     error
		want           updateCheckResult
		wantCached     bool
	}{
		{
			name:           "new release",
			currentVersion: "1.2.3",
			statusCode:     http.StatusOK,
			body:           `{"tag_name":"v1.3.0","html_url":"https://example.com/releases/v1.3.0"}`,
			want: updateCheckResult{
				hasNew:     true,
				releaseURL: "https://example.com/releases/v1.3.0",
			},
			wantCached: true,
		},
		{
			name:           "current release",
			currentVersion: "1.3.0",
			statusCode:     http.StatusOK,
			body:           `{"tag_name":"v1.3.0","html_url":"https://example.com/releases/v1.3.0"}`,
			wantCached:     true,
		},
		{
			name:           "unexpected status",
			currentVersion: "1.2.3",
			statusCode:     http.StatusServiceUnavailable,
		},
		{
			name:           "malformed response",
			currentVersion: "1.2.3",
			statusCode:     http.StatusOK,
			body:           `{`,
		},
		{
			name:           "invalid latest version",
			currentVersion: "1.2.3",
			statusCode:     http.StatusOK,
			body:           `{"tag_name":"latest"}`,
		},
		{
			name:           "invalid current version",
			currentVersion: "stable",
			statusCode:     http.StatusOK,
			body:           `{"tag_name":"v1.3.0"}`,
		},
		{
			name:           "request failure",
			currentVersion: "1.2.3",
			requestErr:     errors.New("network unavailable"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cachedUpdateResult = updateCheckResult{}
			lastUpdateFetch = time.Time{}

			http.DefaultClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if tt.requestErr != nil {
					return nil, tt.requestErr
				}
				if req.Method != http.MethodGet || req.URL.String() != githubLatestReleaseAPI {
					t.Fatalf("unexpected request: %s %s", req.Method, req.URL)
				}
				if got := req.Header.Get("User-Agent"); got != "kite-version-checker/"+tt.currentVersion {
					t.Fatalf("unexpected user agent: %q", got)
				}
				return &http.Response{
					StatusCode: tt.statusCode,
					Status:     http.StatusText(tt.statusCode),
					Body:       io.NopCloser(strings.NewReader(tt.body)),
					Header:     make(http.Header),
					Request:    req,
				}, nil
			})}

			got := checkForUpdate(context.Background(), tt.currentVersion)
			if got != tt.want {
				t.Fatalf("checkForUpdate() = %#v, want %#v", got, tt.want)
			}
			if tt.wantCached != !lastUpdateFetch.IsZero() {
				t.Fatalf("cache state = %v, want cached %v", !lastUpdateFetch.IsZero(), tt.wantCached)
			}
		})
	}
}
