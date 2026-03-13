package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers/resources"
	"github.com/zxh326/kite/pkg/middleware"
)

func TestNormalizeSearchLimit(t *testing.T) {
	tests := []struct {
		name  string
		input int
		want  int
	}{
		{name: "valid lower bound", input: 1, want: 1},
		{name: "valid upper bound", input: 100, want: 100},
		{name: "zero defaults", input: 0, want: defaultSearchLimit},
		{name: "negative defaults", input: -1, want: defaultSearchLimit},
		{name: "too large defaults", input: 101, want: defaultSearchLimit},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeSearchLimit(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeSearchLimit(%d) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestSortResults(t *testing.T) {
	results := []common.SearchResult{
		{Name: "pod-1", ResourceType: "pods"},
		{Name: "target", ResourceType: "namespaces"},
		{Name: "target", ResourceType: "deployments"},
		{Name: "target-x", ResourceType: "services"},
	}

	sortResults(results, "target")

	if results[0].Name != "target" || results[0].ResourceType != "deployments" {
		t.Fatalf("first result mismatch: got %s/%s", results[0].Name, results[0].ResourceType)
	}
	if results[1].Name != "target" || results[1].ResourceType != "namespaces" {
		t.Fatalf("second result mismatch: got %s/%s", results[1].Name, results[1].ResourceType)
	}
}

func TestGlobalSearchNegativeLimitDoesNotPanic(t *testing.T) {
	oldSearchFuncs := resources.SearchFuncs
	resources.SearchFuncs = map[string]func(*gin.Context, string, int64) ([]common.SearchResult, error){}
	t.Cleanup(func() {
		resources.SearchFuncs = oldSearchFuncs
	})

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/search?q=po&limit=-1", nil)

	handler := NewSearchHandler()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("GlobalSearch panicked with negative limit: %v", r)
		}
	}()

	handler.GlobalSearch(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: got %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestGlobalSearchCacheKeyIncludesClusterAndLimit(t *testing.T) {
	oldSearchFuncs := resources.SearchFuncs
	resources.SearchFuncs = map[string]func(*gin.Context, string, int64) ([]common.SearchResult, error){
		"pods": func(c *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			clusterName := c.GetString(middleware.ClusterNameKey)
			switch clusterName {
			case "cluster-a":
				return []common.SearchResult{
					{Name: "target-a-1", ResourceType: "pods"},
					{Name: "target-a-2", ResourceType: "pods"},
					{Name: "target-a-3", ResourceType: "pods"},
				}, nil
			case "cluster-b":
				return []common.SearchResult{
					{Name: "target-b-1", ResourceType: "pods"},
					{Name: "target-b-2", ResourceType: "pods"},
				}, nil
			default:
				return nil, fmt.Errorf("unexpected cluster: %s", clusterName)
			}
		},
	}
	t.Cleanup(func() {
		resources.SearchFuncs = oldSearchFuncs
	})

	handler := NewSearchHandler()

	ctx := newSearchContext(t, "cluster-a", "/search")
	if _, err := handler.Search(ctx, "po target", 1); err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	resp := performGlobalSearch(t, handler, "cluster-a", "/search?q=po+target&limit=3")
	if resp.Total != 3 {
		t.Fatalf("cluster/limit cache miss returned %d results, want 3", resp.Total)
	}

	resp = performGlobalSearch(t, handler, "cluster-b", "/search?q=po+target&limit=3")
	if resp.Total != 2 {
		t.Fatalf("cluster-specific cache miss returned %d results, want 2", resp.Total)
	}
	if len(resp.Results) == 0 || resp.Results[0].Name != "target-b-1" {
		t.Fatalf("unexpected cluster-b results: %#v", resp.Results)
	}
}

func newSearchContext(t *testing.T, clusterName, target string) *gin.Context {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, target, nil)
	if clusterName != "" {
		ctx.Set(middleware.ClusterNameKey, clusterName)
	}
	return ctx
}

func performGlobalSearch(t *testing.T, handler *SearchHandler, clusterName, target string) SearchResponse {
	t.Helper()

	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, target, nil)
	if clusterName != "" {
		ctx.Set(middleware.ClusterNameKey, clusterName)
	}

	handler.GlobalSearch(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: got %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp SearchResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp
}
