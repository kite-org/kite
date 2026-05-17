package search

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/resources"
)

func TestNormalizeSearchQuery(t *testing.T) {
	got := normalizeSearchQuery("  pod   target\t\n")
	want := "pod target"
	if got != want {
		t.Fatalf("normalizeSearchQuery() = %q, want %q", got, want)
	}
}

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

func TestGetSearchClusterNamePrecedence(t *testing.T) {
	t.Run("context beats header query and cookie", func(t *testing.T) {
		ctx := newSearchContextWithRequest(t)
		ctx.Set(middleware.ClusterNameKey, "context-cluster")
		ctx.Request.Header.Set(middleware.ClusterNameHeader, "header-cluster")
		ctx.Request.URL.RawQuery = middleware.ClusterNameHeader + "=query-cluster"

		if got := getSearchClusterName(ctx); got != "context-cluster" {
			t.Fatalf("getSearchClusterName() = %q, want %q", got, "context-cluster")
		}
	})

	t.Run("header beats query and cookie", func(t *testing.T) {
		ctx := newSearchContextWithRequest(t)
		ctx.Request.Header.Set(middleware.ClusterNameHeader, "header-cluster")
		ctx.Request.URL.RawQuery = middleware.ClusterNameHeader + "=query-cluster"

		if got := getSearchClusterName(ctx); got != "header-cluster" {
			t.Fatalf("getSearchClusterName() = %q, want %q", got, "header-cluster")
		}
	})

	t.Run("query beats cookie", func(t *testing.T) {
		ctx := newSearchContextWithRequest(t)
		ctx.Request.URL.RawQuery = middleware.ClusterNameHeader + "=query-cluster"

		if got := getSearchClusterName(ctx); got != "query-cluster" {
			t.Fatalf("getSearchClusterName() = %q, want %q", got, "query-cluster")
		}
	})

	t.Run("cookie fallback", func(t *testing.T) {
		ctx := newSearchContextWithRequest(t)

		if got := getSearchClusterName(ctx); got != "cookie-cluster" {
			t.Fatalf("getSearchClusterName() = %q, want %q", got, "cookie-cluster")
		}
	})
}

func TestGlobalSearchNegativeLimitDoesNotPanic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/search?q=po&limit=-1", nil)
	ctx.Set("user", model.AnonymousUser)

	handler := NewSearchHandler(map[string]resources.SearchFunc{})

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
	searchFuncs := map[string]resources.SearchFunc{
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

	handler := NewSearchHandler(searchFuncs)

	ctx := newSearchContext(t, "cluster-a")
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

func newSearchContext(t *testing.T, clusterName string) *gin.Context {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/search", nil)
	if clusterName != "" {
		ctx.Set(middleware.ClusterNameKey, clusterName)
	}
	ctx.Set("user", model.AnonymousUser)
	return ctx
}

func newSearchContextWithRequest(t *testing.T) *gin.Context {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodGet, "/search", nil)
	req.AddCookie(&http.Cookie{Name: middleware.ClusterNameHeader, Value: "cookie-cluster"})
	ctx.Request = req
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
	ctx.Set("user", model.AnonymousUser)

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

// TestSearchParallelExecution verifies that multiple resource searches run concurrently.
func TestSearchParallelExecution(t *testing.T) {
	// Track concurrent execution: each func sleeps and records max concurrency.
	var running atomic.Int32
	var maxConcurrent atomic.Int32

	slowSearch := func(results []common.SearchResult) resources.SearchFunc {
		return func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			cur := running.Add(1)
			// Update max concurrency seen
			for {
				old := maxConcurrent.Load()
				if cur <= old || maxConcurrent.CompareAndSwap(old, cur) {
					break
				}
			}
			time.Sleep(50 * time.Millisecond)
			running.Add(-1)
			return results, nil
		}
	}

	searchFuncs := map[string]resources.SearchFunc{
		"pods":        slowSearch([]common.SearchResult{{Name: "nginx", ResourceType: "pods"}}),
		"services":    slowSearch([]common.SearchResult{{Name: "nginx-svc", ResourceType: "services"}}),
		"deployments": slowSearch([]common.SearchResult{{Name: "nginx-deploy", ResourceType: "deployments"}}),
	}

	handler := NewSearchHandler(searchFuncs)
	ctx := newSearchContext(t, "test-cluster")

	start := time.Now()
	results, err := handler.Search(ctx, "nginx", 50)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	// With 3 funcs sleeping 50ms each, sequential would take >= 150ms.
	// Parallel should complete in ~50-80ms. Allow generous margin.
	if elapsed >= 140*time.Millisecond {
		t.Errorf("Search took %v, expected < 140ms for parallel execution", elapsed)
	}

	if maxConcurrent.Load() < 2 {
		t.Errorf("maxConcurrent = %d, want >= 2 (proves parallelism)", maxConcurrent.Load())
	}

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
}

// TestSearchPartialFailure ensures that one failing resource type doesn't break others
// and that partial results due to errors are NOT cached.
func TestSearchPartialFailure(t *testing.T) {
	var callCount atomic.Int32
	searchFuncs := map[string]resources.SearchFunc{
		"pods": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			callCount.Add(1)
			return []common.SearchResult{{Name: "ok-pod", ResourceType: "pods"}}, nil
		},
		"services": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			callCount.Add(1)
			return nil, fmt.Errorf("simulated API server error")
		},
		"deployments": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			callCount.Add(1)
			return []common.SearchResult{{Name: "ok-deploy", ResourceType: "deployments"}}, nil
		},
	}

	handler := NewSearchHandler(searchFuncs)
	ctx := newSearchContext(t, "test-cluster")

	results, err := handler.Search(ctx, "ok", 50)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}

	// Should have results from pods + deployments (services failed gracefully)
	if len(results) != 2 {
		t.Fatalf("expected 2 results (failed resource skipped), got %d: %+v", len(results), results)
	}

	callsBefore := callCount.Load()

	// Second call: should NOT be served from cache because one resource errored.
	ctx2 := newSearchContext(t, "test-cluster")
	results2, err := handler.Search(ctx2, "ok", 50)
	if err != nil {
		t.Fatalf("second Search returned error: %v", err)
	}
	if len(results2) != 2 {
		t.Fatalf("expected 2 results on retry, got %d", len(results2))
	}

	callsAfter := callCount.Load()
	if callsAfter == callsBefore {
		t.Fatal("second call was served from cache — error results should NOT be cached")
	}
}

// TestGlobalSearchCacheDoesNotTriggerBackgroundRefresh validates Solution E:
// a cache hit should NOT invoke Search again (no background goroutine).
func TestGlobalSearchCacheDoesNotTriggerBackgroundRefresh(t *testing.T) {
	var searchCallCount atomic.Int32

	searchFuncs := map[string]resources.SearchFunc{
		"pods": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			searchCallCount.Add(1)
			return []common.SearchResult{{Name: "nginx", ResourceType: "pods"}}, nil
		},
	}

	handler := NewSearchHandler(searchFuncs)

	// First call: populates the cache
	resp := performGlobalSearch(t, handler, "test-cluster", "/search?q=nginx&limit=50")
	if resp.Total != 1 {
		t.Fatalf("first call: expected 1 result, got %d", resp.Total)
	}

	callsAfterFirst := searchCallCount.Load()

	// Second call: should serve from cache WITHOUT launching background search
	resp = performGlobalSearch(t, handler, "test-cluster", "/search?q=nginx&limit=50")
	if resp.Total != 1 {
		t.Fatalf("second call: expected 1 result, got %d", resp.Total)
	}

	// Give any hypothetical background goroutine time to execute
	time.Sleep(100 * time.Millisecond)

	callsAfterSecond := searchCallCount.Load()
	if callsAfterSecond != callsAfterFirst {
		t.Fatalf("cache hit triggered %d extra Search calls (background refresh not removed)",
			callsAfterSecond-callsAfterFirst)
	}
}

// TestSearchPanicDoesNotCacheResults verifies that when a search function panics,
// partial results are still returned but NOT cached (avoids serving stale incomplete data).
func TestSearchPanicDoesNotCacheResults(t *testing.T) {
	var callCount atomic.Int32

	searchFuncs := map[string]resources.SearchFunc{
		"pods": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			callCount.Add(1)
			return []common.SearchResult{{Name: "ok-pod", ResourceType: "pods"}}, nil
		},
		"services": func(_ *gin.Context, _ string, _ int64) ([]common.SearchResult, error) {
			callCount.Add(1)
			panic("simulated nil-pointer in service search")
		},
	}

	handler := NewSearchHandler(searchFuncs)

	// First call: one func panics → partial results returned, cache NOT written
	ctx1 := newSearchContext(t, "test-cluster")
	results, err := handler.Search(ctx1, "ok", 50)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) != 1 || results[0].Name != "ok-pod" {
		t.Fatalf("expected partial result [ok-pod], got %+v", results)
	}

	callsBefore := callCount.Load()

	// Second call: should NOT be served from cache (cache was skipped due to panic).
	// Both search funcs must be invoked again.
	ctx2 := newSearchContext(t, "test-cluster")
	results2, err := handler.Search(ctx2, "ok", 50)
	if err != nil {
		t.Fatalf("second Search returned error: %v", err)
	}
	if len(results2) != 1 {
		t.Fatalf("expected 1 result on retry, got %d", len(results2))
	}

	callsAfter := callCount.Load()
	if callsAfter == callsBefore {
		t.Fatal("second call was served from cache — panic results should NOT be cached")
	}
}

// TestSearchEmptyResourceFuncs verifies Search handles zero searchable types gracefully.
func TestSearchEmptyResourceFuncs(t *testing.T) {
	handler := NewSearchHandler(map[string]resources.SearchFunc{})
	ctx := newSearchContext(t, "test-cluster")

	results, err := handler.Search(ctx, "anything", 50)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results with no search funcs, got %d", len(results))
	}
}
