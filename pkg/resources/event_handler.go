package resources

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
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
	user := c.MustGet("user").(model.User)
	authorizationNamespace := namespace
	if authorizationNamespace == "" {
		authorizationNamespace = common.AllNamespaces
	}
	resourceMeta := common.LookupResource(resource)
	if resourceMeta != nil && resourceMeta.ClusterScoped {
		authorizationNamespace = common.AllNamespaces
	}
	if resourceMeta == nil {
		if !rbac.HasResourcePermission(user, resource, string(common.VerbGet), cs.Name) {
			c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(common.VerbGet), resource, authorizationNamespace, cs.Name)})
			return
		}
		var crd apiextensionsv1.CustomResourceDefinition
		if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Name: resource}, &crd); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Failed to get resource: " + err.Error()})
			return
		}
		if crd.Spec.Scope == apiextensionsv1.ClusterScoped {
			authorizationNamespace = common.AllNamespaces
		}
	}
	if !rbac.CanAccess(user, string(common.Events), string(common.VerbGet), cs.Name, authorizationNamespace) {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(common.VerbGet), string(common.Events), authorizationNamespace, cs.Name)})
		return
	}
	canAccessTarget := rbac.CanAccess(user, resource, string(common.VerbGet), cs.Name, authorizationNamespace)
	if resource == string(common.Namespaces) {
		canAccessTarget = rbac.CanAccessNamespace(user, cs.Name, name)
	}
	if !canAccessTarget {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(common.VerbGet), resource, authorizationNamespace, cs.Name)})
		return
	}
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
			",involvedObject.name=" + name +
			",involvedObject.uid=" + string(obj.GetUID()),
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
