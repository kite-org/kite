package resources

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/types"
)

type StatefulSetHandler struct {
	*GenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList]
}

func NewStatefulSetHandler() *StatefulSetHandler {
	return &StatefulSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](
			"statefulsets",
			false, // StatefulSets are namespaced resources
			true,
		),
	}
}

func (h *StatefulSetHandler) Restart(c *gin.Context, namespace, name string) error {
	var statefulset appsv1.StatefulSet
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &statefulset); err != nil {
		return err
	}
	if statefulset.Spec.Template.Annotations == nil {
		statefulset.Spec.Template.Annotations = make(map[string]string)
	}
	statefulset.Spec.Template.Annotations["kite.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
	return cs.K8sClient.Update(c.Request.Context(), &statefulset)
}

func (h *StatefulSetHandler) registerCustomRoutes(group *gin.RouterGroup) {
	// Register restart route for cluster-scoped resources
	group.POST("/_all/:name/restart", func(c *gin.Context) {
		name := c.Param("name")
		if err := h.Restart(c, "", name); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "StatefulSet restarted successfully"})
	})

	// Register restart route for namespace-scoped resources
	group.POST("/:namespace/:name/restart", func(c *gin.Context) {
		namespace := c.Param("namespace")
		name := c.Param("name")
		if err := h.Restart(c, namespace, name); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "StatefulSet restarted successfully"})
	})
}
