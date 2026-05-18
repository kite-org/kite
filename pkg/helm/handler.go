package helm

import (
	"sync"

	"github.com/gin-gonic/gin"
)

type HelmChartHandler struct {
	indexCacheMu   sync.Mutex
	indexCache     map[string]cachedRepositoryIndex
	contentCacheMu sync.Mutex
	contentCache   map[string]cachedChartContent
}

func NewHelmChartHandler() *HelmChartHandler {
	return &HelmChartHandler{
		indexCache:   map[string]cachedRepositoryIndex{},
		contentCache: map[string]cachedChartContent{},
	}
}

func (h *HelmChartHandler) RegisterRoutes(group *gin.RouterGroup) {
	g := group.Group("/charts")
	g.GET("/repositories", h.ListRepositories)
	g.GET("/artifacthub", h.ListArtifactHubCharts)
	g.GET("", h.ListCharts)
	g.GET("/artifacthub/:repository/:name/content/:content", h.GetArtifactHubChartContent)
	g.GET("/artifacthub/:repository/:name", h.GetArtifactHubChart)
	g.GET("/:repository/:name/content/:content", h.GetChartContent)
	g.GET("/:repository/:name", h.GetChart)
}

func (h *HelmChartHandler) RegisterAdminRoutes(group *gin.RouterGroup) {
	g := group.Group("/charts")
	g.POST("/repositories", h.CreateRepository)
	g.DELETE("/repositories/:id", h.DeleteRepository)
}
