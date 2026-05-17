package resources

import (
	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
)

type resourceVersionCandidate struct {
	groupVersion string
	resource     string
	handler      resourceHandler
}

type versionedResourceHandler struct {
	candidates []resourceVersionCandidate
}

func newVersionedResourceHandler(candidates ...resourceVersionCandidate) *versionedResourceHandler {
	return &versionedResourceHandler{candidates: candidates}
}

func newResourceVersionCandidate(groupVersion, resource string, handler resourceHandler) resourceVersionCandidate {
	return resourceVersionCandidate{
		groupVersion: groupVersion,
		resource:     resource,
		handler:      handler,
	}
}

func (h *versionedResourceHandler) resolve(c *gin.Context) resourceHandler {
	if len(h.candidates) == 1 {
		return h.candidates[0].handler
	}

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	for _, candidate := range h.candidates {
		list, err := cs.K8sClient.ClientSet.Discovery().ServerResourcesForGroupVersion(candidate.groupVersion)
		if list == nil {
			if err != nil {
				continue
			}
			continue
		}
		for _, resource := range list.APIResources {
			if resource.Name == candidate.resource {
				return candidate.handler
			}
		}
	}

	return h.candidates[0].handler
}

func (h *versionedResourceHandler) List(c *gin.Context) {
	h.resolve(c).List(c)
}

func (h *versionedResourceHandler) Get(c *gin.Context) {
	h.resolve(c).Get(c)
}

func (h *versionedResourceHandler) Create(c *gin.Context) {
	h.resolve(c).Create(c)
}

func (h *versionedResourceHandler) Update(c *gin.Context) {
	h.resolve(c).Update(c)
}

func (h *versionedResourceHandler) Delete(c *gin.Context) {
	h.resolve(c).Delete(c)
}

func (h *versionedResourceHandler) Patch(c *gin.Context) {
	h.resolve(c).Patch(c)
}

func (h *versionedResourceHandler) IsClusterScoped() bool {
	return h.candidates[0].handler.IsClusterScoped()
}

func (h *versionedResourceHandler) Searchable() bool {
	return h.candidates[0].handler.Searchable()
}

func (h *versionedResourceHandler) Search(c *gin.Context, query string, limit int64) ([]common.SearchResult, error) {
	return h.resolve(c).Search(c, query, limit)
}

func (h *versionedResourceHandler) GetResource(c *gin.Context, namespace, name string) (interface{}, error) {
	return h.resolve(c).GetResource(c, namespace, name)
}

func (h *versionedResourceHandler) registerCustomRoutes(group *gin.RouterGroup) {
}

func (h *versionedResourceHandler) ListHistory(c *gin.Context) {
	h.resolve(c).ListHistory(c)
}

func (h *versionedResourceHandler) Describe(c *gin.Context) {
	h.resolve(c).Describe(c)
}
