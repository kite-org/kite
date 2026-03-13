package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers/resources"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/utils"
)

type SearchHandler struct {
	cache *expirable.LRU[string, []common.SearchResult]
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
	"deployments":  1,
	"pods":         2,
	"daemonsets":   3,
	"statefulsets": 4,
	"configmaps":   5,
	"services":     6,
	"secrets":      7,
	"ingresses":    8,
	"namespaces":   9,
}

func NewSearchHandler() *SearchHandler {
	return &SearchHandler{
		cache: expirable.NewLRU[string, []common.SearchResult](100, nil, time.Minute*10),
	}
}

func (h *SearchHandler) createCacheKey(clusterName, query string, limit int) string {
	return fmt.Sprintf("search:%s:%d:%s", clusterName, limit, normalizeSearchQuery(query))
}

func (h *SearchHandler) Search(c *gin.Context, query string, limit int) ([]common.SearchResult, error) {
	query = normalizeSearchQuery(query)
	limit = normalizeSearchLimit(limit)
	var allResults []common.SearchResult

	// Search in different resource types
	searchFuncs := resources.SearchFuncs
	guessSearchResources, q := utils.GuessSearchResources(query)
	for name, searchFunc := range searchFuncs {
		if guessSearchResources == "all" || name == guessSearchResources {
			results, err := searchFunc(c, q, int64(limit))
			if err != nil {
				continue
			}
			allResults = append(allResults, results...)
		}
	}

	queryLower := strings.ToLower(q)
	sortResults(allResults, queryLower)

	// Limit total results
	if len(allResults) > limit {
		allResults = allResults[:limit]
	}

	h.cache.Add(h.createCacheKey(getSearchClusterName(c), query, limit), allResults)
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

	cacheKey := h.createCacheKey(getSearchClusterName(c), query, limit)

	if cachedResults, found := h.cache.Get(cacheKey); found {
		response := SearchResponse{
			Results: cachedResults,
			Total:   len(cachedResults),
		}
		copiedCtx := c.Copy()
		go func() {
			// Perform search in the background to update cache
			_, _ = h.Search(copiedCtx, query, limit)
		}()
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
