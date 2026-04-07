package resources

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type EventHandler struct {
	GenericResourceHandler[*corev1.Event, *corev1.EventList]
}

func NewEventHandler() *EventHandler {
	return &EventHandler{
		GenericResourceHandler: *NewGenericResourceHandler[*corev1.Event, *corev1.EventList](common.Events),
	}
}

func (h *EventHandler) ListResourceEvents(c *gin.Context) {
	name := c.Query("name")
	namespace := c.Query("namespace")
	resource := c.Query("resource")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	target, err := GetResource(c, resource, namespace, name)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Failed to get resource: " + err.Error()})
		return
	}

	objType, err := meta.TypeAccessor(target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access object type info: " + err.Error()})
		return
	}
	obj := target.(metav1.Object)
	events, err := cs.K8sClient.ClientSet.CoreV1().Events(obj.GetNamespace()).List(c.Request.Context(), metav1.ListOptions{
		FieldSelector: "involvedObject.kind=" + objType.GetKind() +
			",involvedObject.name=" + name,
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list events: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, events)
}

func (h *EventHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.GET("/resources", h.ListResourceEvents)
}
