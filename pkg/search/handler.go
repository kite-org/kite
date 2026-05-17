package search

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/resources"
	"github.com/zxh326/kite/pkg/utils"
	"golang.org/x/sync/errgroup"
	"k8s.io/klog/v2"
)

type SearchHandler struct {
	cache       *expirable.LRU[string, []common.SearchResult]
	searchFuncs map[string]resources.SearchFunc
}
type SearchResponse struct {
	Results []common.SearchResult `json:"results"`
	Total   int                   `json:"total"`
}

const (
	defaultSearchLimit = 50
	maxSearchLimit     = 100
)

var searchResourceOrder = map[string]int{
	string(common.Deployments):          1,
	string(common.Pods):                 2,
	string(common.DaemonSets):           3,
	string(common.StatefulSets):         4,
	string(common.ConfigMaps):           5,
	string(common.Services):             6,
	string(common.Secrets):              7,
	string(common.Ingresses):            8,
	string(common.Namespaces):           9,
	string(common.PodDisruptionBudgets): 10,
}

func NewSearchHandler(searchFuncs map[string]resources.SearchFunc) *SearchHandler {
	return &SearchHandler{
		cache:       expirable.NewLRU[string, []common.SearchResult](100, nil, time.Minute*10),
		searchFuncs: searchFuncs,
	}
}

func (h *SearchHandler) createCacheKey(clusterName, userKey, query string, limit int) string {
	return fmt.Sprintf("search:%s:%s:%d:%s", clusterName, userKey, limit, normalizeSearchQuery(query))
}

func (h *SearchHandler) Search(c *gin.Context, query string, limit int) ([]common.SearchResult, error) {
	query = normalizeSearchQuery(query)
	limit = normalizeSearchLimit(limit)

	// Determine which resource types to search
	guessSearchResources, q := utils.GuessSearchResources(query)

	// Collect the search functions to execute
	type searchEntry struct {
		name string
		fn   resources.SearchFunc
	}
	var entries []searchEntry
	for name, searchFunc := range h.searchFuncs {
		if guessSearchResources == "all" || name == guessSearchResources {
			entries = append(entries, searchEntry{name: name, fn: searchFunc})
		}
	}

	// Execute searches in parallel using errgroup
	resultSlices := make([][]common.SearchResult, len(entries))
	var hadFailure atomic.Bool // set on panic OR error — prevents caching incomplete results
	g, _ := errgroup.WithContext(context.Background())

	for i, entry := range entries {
		searchContext := c.Copy()
		g.Go(func() (err error) {
			defer func() {
				if r := recover(); r != nil {
					klog.Errorf("search: resource %q panicked: %v", entry.name, r)
					hadFailure.Store(true)
				}
			}()
			results, searchErr := entry.fn(searchContext, q, int64(limit))
			if searchErr != nil {
				klog.Errorf("search: resource %q failed: %v", entry.name, searchErr)
				hadFailure.Store(true)
				return nil
			}
			resultSlices[i] = results
			return nil
		})
	}

	_ = g.Wait() // all goroutines return nil, error is always nil

	// Merge results from all resource types
	var allResults []common.SearchResult
	for _, slice := range resultSlices {
		allResults = append(allResults, slice...)
	}

	queryLower := strings.ToLower(q)
	sortResults(allResults, queryLower)

	// Limit total results
	if len(allResults) > limit {
		allResults = allResults[:limit]
	}

	// Only cache results when no failure (panic or error) occurred — avoids
	// caching incomplete results that would be served as valid 200 OK for the TTL.
	if !hadFailure.Load() {
		user := c.MustGet("user").(model.User)
		h.cache.Add(h.createCacheKey(getSearchClusterName(c), user.Key(), query, limit), allResults)
	}
	return allResults, nil
}

// GlobalSearch handles global search across multiple resource types
func (h *SearchHandler) GlobalSearch(c *gin.Context) {
	query := normalizeSearchQuery(c.Query("q"))
	if len(query) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query must be at least 2 characters long"})
		return
	}

	// Parse limit parameter
	limitStr := c.DefaultQuery("limit", strconv.Itoa(defaultSearchLimit))
	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = defaultSearchLimit
	}
	limit = normalizeSearchLimit(limit)

	user := c.MustGet("user").(model.User)
	cacheKey := h.createCacheKey(getSearchClusterName(c), user.Key(), query, limit)

	if cachedResults, found := h.cache.Get(cacheKey); found {
		response := SearchResponse{
			Results: cachedResults,
			Total:   len(cachedResults),
		}
		c.JSON(http.StatusOK, response)
		return
	}

	allResults, err := h.Search(c, query, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to perform search"})
		return
	}

	response := SearchResponse{
		Results: allResults,
		Total:   len(allResults),
	}

	c.JSON(http.StatusOK, response)
}

func getResourceOrder(resourceType string) int {
	if order, exists := searchResourceOrder[resourceType]; exists {
		return order
	}
	return len(searchResourceOrder) // Default to the end if not found
}

// sortResults sorts the search results with exact matches first, then by resource type
func sortResults(results []common.SearchResult, query string) {
	var exactMatches, partialMatches []common.SearchResult

	for _, result := range results {
		if strings.ToLower(result.Name) == query {
			exactMatches = append(exactMatches, result)
		} else {
			partialMatches = append(partialMatches, result)
		}
	}

	// sort by resources
	sortByResources := func(a, b common.SearchResult) bool {
		return getResourceOrder(a.ResourceType) < getResourceOrder(b.ResourceType)
	}

	sort.SliceStable(exactMatches, func(i, j int) bool {
		return sortByResources(exactMatches[i], exactMatches[j])
	})
	sort.SliceStable(partialMatches, func(i, j int) bool {
		return sortByResources(partialMatches[i], partialMatches[j])
	})

	// Combine results
	copy(results, append(exactMatches, partialMatches...))
}

func normalizeSearchLimit(limit int) int {
	if limit < 1 || limit > maxSearchLimit {
		return defaultSearchLimit
	}
	return limit
}

func normalizeSearchQuery(query string) string {
	return strings.Join(strings.Fields(query), " ")
}

func getSearchClusterName(c *gin.Context) string {
	if clusterName := c.GetString(middleware.ClusterNameKey); clusterName != "" {
		return clusterName
	}
	if clusterName := c.GetHeader(middleware.ClusterNameHeader); clusterName != "" {
		return clusterName
	}
	if clusterName, ok := c.GetQuery(middleware.ClusterNameHeader); ok {
		return clusterName
	}
	clusterName, _ := c.Cookie(middleware.ClusterNameHeader)
	return clusterName
}
