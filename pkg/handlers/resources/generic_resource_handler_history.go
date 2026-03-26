package resources

import (
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/kubectl/pkg/describe"
)

func (h *GenericResourceHandler[T, V]) registerCustomRoutes(group *gin.RouterGroup) {}

func (h *GenericResourceHandler[T, V]) ListHistory(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	namespace := c.Param("namespace")
	resourceName := c.Param("name")
	pageSize, err := strconv.Atoi(c.DefaultQuery("pageSize", "10"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pageSize parameter"})
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid page parameter"})
		return
	}

	var total int64
	if err := model.DB.Model(&model.ResourceHistory{}).Where("cluster_name = ? AND resource_type = ? AND resource_name = ? AND namespace = ?", cs.Name, h.name, resourceName, namespace).Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	history := []model.ResourceHistory{}
	if err := model.DB.Preload("Operator").Where("cluster_name = ? AND resource_type = ? AND resource_name = ? AND namespace = ?", cs.Name, h.name, resourceName, namespace).Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&history).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))
	hasNextPage := page < totalPages
	hasPrevPage := page > 1

	response := gin.H{
		"data": history,
		"pagination": gin.H{
			"page":        page,
			"pageSize":    pageSize,
			"total":       total,
			"totalPages":  totalPages,
			"hasNextPage": hasNextPage,
			"hasPrevPage": hasPrevPage,
		},
	}

	c.JSON(http.StatusOK, response)
}

func (h *GenericResourceHandler[T, V]) Describe(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	gk := h.getGroupKind()
	describer, ok := describe.DescriberFor(gk, cs.K8sClient.Configuration)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no describer found for this resource"})
		return
	}
	namespace := c.Param("namespace")
	name := c.Param("name")
	out, err := describer.Describe(namespace, name, describe.DescriberSettings{
		ShowEvents: true,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": out})
}
