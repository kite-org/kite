package resources

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type DaemonSetHandler struct {
	*GenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList]
}

func NewDaemonSetHandler() *DaemonSetHandler {
	return &DaemonSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList](common.DaemonSets),
	}
}

func (h *DaemonSetHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.GET("/:namespace/:name/revisions", h.Revisions)
	group.PUT("/:namespace/:name/rollback", h.Rollback)
}

func (h *DaemonSetHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var ds appsv1.DaemonSet
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &ds); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	revisions, err := listControllerRevisions(ctx, cs, namespace, ds.Spec.Selector, &ds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// DaemonSet has no authoritative "current revision" status field (unlike
	// StatefulSet's status.currentRevision), so the highest revision number
	// is the only signal available - same fallback Deployment uses.
	currentIndex := -1
	if len(revisions) > 0 {
		currentIndex = 0
	}

	items := make([]WorkloadRevisionItem, 0, len(revisions))
	for i, rev := range revisions {
		items = append(items, WorkloadRevisionItem{
			Revision:       rev.Revision,
			RevisionObject: rev.Name,
			ChangeCause:    rev.Annotations[deploymentChangeCauseAnnotation],
			Images:         controllerRevisionImages(rev.Data.Raw),
			CreatedAt:      rev.CreationTimestamp,
			Current:        i == currentIndex,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *DaemonSetHandler) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var req workloadRollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var ds appsv1.DaemonSet
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &ds); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	oldDs := ds.DeepCopy()

	revisions, err := listControllerRevisions(ctx, cs, namespace, ds.Spec.Selector, &ds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(revisions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no revision history found for this daemonset"})
		return
	}

	targetRevision := req.Revision
	if targetRevision == 0 {
		if len(revisions) < 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no previous revision found"})
			return
		}
		targetRevision = revisions[1].Revision
	}

	var target *appsv1.ControllerRevision
	for _, rev := range revisions {
		if rev.Revision == targetRevision {
			target = rev
			break
		}
	}
	if target == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("revision %d not found", targetRevision)})
		return
	}

	var success bool
	var errMsg string
	defer func() {
		h.recordHistory(c, "rollback", oldDs, &ds, success, errMsg)
	}()

	changeCause := strings.TrimSpace(req.ChangeCause)
	if changeCause == "" {
		changeCause = fmt.Sprintf("Rolled back to revision %d via Kite", targetRevision)
	}
	patch, err := withChangeCauseAnnotation(target.Data.Raw, changeCause)
	if err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := cs.K8sClient.Patch(ctx, &ds, client.RawPatch(types.StrategicMergePatchType, patch)); err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusOK, gin.H{"message": "daemonset rolled back", "revision": targetRevision})
}
