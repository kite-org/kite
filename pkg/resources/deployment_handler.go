package resources

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	deploymentRevisionAnnotation    = "deployment.kubernetes.io/revision"
	deploymentChangeCauseAnnotation = "kubernetes.io/change-cause"
)

type DeploymentHandler struct {
	*GenericResourceHandler[*appsv1.Deployment, *appsv1.DeploymentList]
}

func NewDeploymentHandler() *DeploymentHandler {
	return &DeploymentHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.Deployment, *appsv1.DeploymentList](common.Deployments),
	}
}

func (h *DeploymentHandler) Restart(c *gin.Context, namespace, name string) error {
	var deployment appsv1.Deployment
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		return err
	}
	if deployment.Spec.Template.Annotations == nil {
		deployment.Spec.Template.Annotations = make(map[string]string)
	}
	deployment.Spec.Template.Annotations["kite.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)
	return cs.K8sClient.Update(c.Request.Context(), &deployment)
}

func (h *DeploymentHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.GET("/:namespace/:name/revisions", h.Revisions)
	group.PUT("/:namespace/:name/rollback", h.Rollback)
}

func (h *DeploymentHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var deployment appsv1.Deployment
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	replicaSets, err := listDeploymentReplicaSets(ctx, cs, &deployment)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	currentIndex := deploymentCurrentRevisionIndex(&deployment, replicaSets)

	items := make([]WorkloadRevisionItem, 0, len(replicaSets))
	for i, rs := range replicaSets {
		images := make([]string, 0, len(rs.Spec.Template.Spec.Containers))
		for _, container := range rs.Spec.Template.Spec.Containers {
			images = append(images, container.Image)
		}
		replicas := rs.Status.Replicas

		items = append(items, WorkloadRevisionItem{
			Revision:       deploymentRevisionOf(rs),
			RevisionObject: rs.Name,
			ChangeCause:    rs.Annotations[deploymentChangeCauseAnnotation],
			Images:         images,
			Replicas:       &replicas,
			CreatedAt:      rs.CreationTimestamp,
			Current:        i == currentIndex,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *DeploymentHandler) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var req workloadRollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var deployment appsv1.Deployment
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	oldDeployment := deployment.DeepCopy()

	replicaSets, err := listDeploymentReplicaSets(ctx, cs, &deployment)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(replicaSets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no revision history found for this deployment"})
		return
	}

	targetRevision := req.Revision
	if targetRevision == 0 {
		currentIndex := deploymentCurrentRevisionIndex(&deployment, replicaSets)
		if currentIndex < 0 || currentIndex+1 >= len(replicaSets) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no previous revision found"})
			return
		}
		targetRevision = deploymentRevisionOf(replicaSets[currentIndex+1])
	}

	var target *appsv1.ReplicaSet
	for _, rs := range replicaSets {
		if deploymentRevisionOf(rs) == targetRevision {
			target = rs
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
		h.recordHistory(c, "rollback", oldDeployment, &deployment, success, errMsg)
	}()

	template := target.Spec.Template.DeepCopy()
	delete(template.Labels, appsv1.DefaultDeploymentUniqueLabelKey)
	deployment.Spec.Template = *template

	if deployment.Annotations == nil {
		deployment.Annotations = make(map[string]string)
	}
	changeCause := strings.TrimSpace(req.ChangeCause)
	if changeCause == "" {
		changeCause = fmt.Sprintf("Rolled back to revision %d via Kite", targetRevision)
	}
	deployment.Annotations[deploymentChangeCauseAnnotation] = changeCause

	if err := cs.K8sClient.Update(ctx, &deployment); err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	success = true
	c.JSON(http.StatusOK, gin.H{"message": "deployment rolled back", "revision": targetRevision})
}

func listDeploymentReplicaSets(ctx context.Context, cs *cluster.ClientSet, deployment *appsv1.Deployment) ([]*appsv1.ReplicaSet, error) {
	selector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, err
	}

	var rsList appsv1.ReplicaSetList
	if err := cs.K8sClient.List(ctx, &rsList, client.InNamespace(deployment.Namespace), client.MatchingLabelsSelector{Selector: selector}); err != nil {
		return nil, err
	}

	owned := make([]*appsv1.ReplicaSet, 0, len(rsList.Items))
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		owner := metav1.GetControllerOf(rs)
		if owner == nil || owner.UID != deployment.UID {
			continue
		}
		revStr, ok := rs.Annotations[deploymentRevisionAnnotation]
		if !ok {
			continue
		}
		if _, err := strconv.ParseInt(revStr, 10, 64); err != nil {
			continue
		}
		owned = append(owned, rs)
	}
	sort.Slice(owned, func(i, j int) bool {
		return deploymentRevisionOf(owned[i]) > deploymentRevisionOf(owned[j])
	})
	return owned, nil
}

func deploymentRevisionOf(rs *appsv1.ReplicaSet) int64 {
	if rs.Annotations == nil {
		return 0
	}
	v, err := strconv.ParseInt(rs.Annotations[deploymentRevisionAnnotation], 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// deploymentCurrentRevisionIndex resolves which entry in replicaSets (sorted
// by descending revision) is the Deployment's current revision, using the
// Deployment's own deployment.kubernetes.io/revision annotation as the
// source of truth. It falls back to the highest revision (index 0) when the
// annotation is missing or doesn't match any ReplicaSet in the list.
func deploymentCurrentRevisionIndex(deployment *appsv1.Deployment, replicaSets []*appsv1.ReplicaSet) int {
	if deployment.Annotations != nil {
		if v, err := strconv.ParseInt(deployment.Annotations[deploymentRevisionAnnotation], 10, 64); err == nil {
			for i, rs := range replicaSets {
				if deploymentRevisionOf(rs) == v {
					return i
				}
			}
		}
	}
	if len(replicaSets) > 0 {
		return 0
	}
	return -1
}
