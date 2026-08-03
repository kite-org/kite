package resources

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type StatefulSetHandler struct {
	*GenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList]
}

func NewStatefulSetHandler() *StatefulSetHandler {
	return &StatefulSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](common.StatefulSets),
	}
}

func (h *StatefulSetHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.GET("/:namespace/:name/revisions", h.Revisions)
	group.PUT("/:namespace/:name/rollback", h.Rollback)
}

func (h *StatefulSetHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var sts appsv1.StatefulSet
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &sts); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	revisions, err := listControllerRevisions(ctx, cs, namespace, sts.Spec.Selector, &sts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	currentIndex := statefulSetCurrentRevisionIndex(&sts, revisions)

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

func (h *StatefulSetHandler) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var req workloadRollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var sts appsv1.StatefulSet
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &sts); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	oldSts := sts.DeepCopy()

	revisions, err := listControllerRevisions(ctx, cs, namespace, sts.Spec.Selector, &sts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(revisions) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no revision history found for this statefulset"})
		return
	}

	targetRevision := req.Revision
	if targetRevision == 0 {
		currentIndex := statefulSetCurrentRevisionIndex(&sts, revisions)
		if currentIndex < 0 || currentIndex+1 >= len(revisions) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no previous revision found"})
			return
		}
		targetRevision = revisions[currentIndex+1].Revision
	}

	found := false
	for _, rev := range revisions {
		if rev.Revision == targetRevision {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("revision %d not found", targetRevision)})
		return
	}

	var success bool
	var errMsg string
	defer func() {
		h.recordHistory(c, "rollback", oldSts, &sts, success, errMsg)
	}()

	if err := rollbackWorkload(cs, statefulSetGroupKind, &sts, targetRevision); err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Re-fetch and annotate through the same typed clientset kubectl's
	// Rollbacker just wrote through (rather than controller-runtime's
	// client), so this read is guaranteed to see the rollback it just
	// applied.
	updated, err := cs.K8sClient.ClientSet.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if updated.Annotations == nil {
		updated.Annotations = make(map[string]string)
	}
	changeCause := strings.TrimSpace(req.ChangeCause)
	if changeCause == "" {
		changeCause = fmt.Sprintf("Rolled back to revision %d via Kite", targetRevision)
	}
	updated.Annotations[deploymentChangeCauseAnnotation] = changeCause
	updated, err = cs.K8sClient.ClientSet.AppsV1().StatefulSets(namespace).Update(ctx, updated, metav1.UpdateOptions{})
	if err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	sts = *updated

	success = true
	c.JSON(http.StatusOK, gin.H{"message": "statefulset rolled back", "revision": targetRevision})
}

// listControllerRevisions lists the ControllerRevisions in namespace matching
// selector that are controlled by owner, sorted by descending revision. It's
// shared by StatefulSet and DaemonSet, which both use ControllerRevision to
// track rollout history (unlike Deployment, which uses ReplicaSet).
func listControllerRevisions(ctx context.Context, cs *cluster.ClientSet, namespace string, selector *metav1.LabelSelector, owner metav1.Object) ([]*appsv1.ControllerRevision, error) {
	labelSelector, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return nil, err
	}

	var list appsv1.ControllerRevisionList
	if err := cs.K8sClient.List(ctx, &list, client.InNamespace(namespace), client.MatchingLabelsSelector{Selector: labelSelector}); err != nil {
		return nil, err
	}

	owned := make([]*appsv1.ControllerRevision, 0, len(list.Items))
	for i := range list.Items {
		rev := &list.Items[i]
		if !metav1.IsControlledBy(rev, owner) {
			continue
		}
		owned = append(owned, rev)
	}
	sort.Slice(owned, func(i, j int) bool {
		return owned[i].Revision > owned[j].Revision
	})
	return owned, nil
}

// statefulSetCurrentRevisionIndex resolves which entry in revisions (sorted
// by descending revision) is the StatefulSet's current revision, using the
// authoritative status.currentRevision name. It falls back to the highest
// revision (index 0) when status.currentRevision is empty or doesn't match
// any ControllerRevision in the list.
func statefulSetCurrentRevisionIndex(sts *appsv1.StatefulSet, revisions []*appsv1.ControllerRevision) int {
	if sts.Status.CurrentRevision != "" {
		for i, rev := range revisions {
			if rev.Name == sts.Status.CurrentRevision {
				return i
			}
		}
	}
	if len(revisions) > 0 {
		return 0
	}
	return -1
}
