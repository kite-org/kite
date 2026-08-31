package resources

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type DaemonSetHandler struct {
	*GenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList]
}

func NewDaemonSetHandler() *DaemonSetHandler {
	return &DaemonSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList](common.DaemonSets),
	}
}

func (h *DaemonSetHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	ds, err := cs.K8sClient.ClientSet.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	revisions, err := listControllerRevisions(ctx, cs, namespace, ds.Spec.Selector, ds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": controllerRevisionItems(revisions, 0)})
}
