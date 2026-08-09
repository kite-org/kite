package resources

import (
	"context"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type StatefulSetHandler struct {
	*GenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList]
}

func NewStatefulSetHandler() *StatefulSetHandler {
	return &StatefulSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](common.StatefulSets),
	}
}

func (h *StatefulSetHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	sts, err := cs.K8sClient.ClientSet.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	revisions, err := listControllerRevisions(ctx, cs, namespace, sts.Spec.Selector, sts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	currentIndex := statefulSetCurrentRevisionIndex(sts, revisions)

	c.JSON(http.StatusOK, gin.H{"items": controllerRevisionItems(revisions, currentIndex)})
}

func listControllerRevisions(ctx context.Context, cs *cluster.ClientSet, namespace string, selector *metav1.LabelSelector, owner metav1.Object) ([]*appsv1.ControllerRevision, error) {
	labelSelector, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return nil, err
	}

	list, err := cs.K8sClient.ClientSet.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelSelector.String()})
	if err != nil {
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

func statefulSetCurrentRevisionIndex(sts *appsv1.StatefulSet, revisions []*appsv1.ControllerRevision) int {
	for _, revisionName := range []string{sts.Status.UpdateRevision, sts.Status.CurrentRevision} {
		for i, rev := range revisions {
			if rev.Name == revisionName {
				return i
			}
		}
	}
	if len(revisions) > 0 {
		return 0
	}
	return -1
}
