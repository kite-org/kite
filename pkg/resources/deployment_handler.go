package resources

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const deploymentRevisionAnnotation = "deployment.kubernetes.io/revision"

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

func (h *DeploymentHandler) Revisions(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	deployment, err := cs.K8sClient.ClientSet.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	replicaSets, err := listDeploymentReplicaSets(ctx, cs, deployment)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	currentIndex := deploymentCurrentRevisionIndex(deployment, replicaSets)

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
			ChangeCause:    rs.Annotations[changeCauseAnnotation],
			Images:         images,
			Replicas:       &replicas,
			CreatedAt:      rs.CreationTimestamp,
			Current:        i == currentIndex,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func listDeploymentReplicaSets(ctx context.Context, cs *cluster.ClientSet, deployment *appsv1.Deployment) ([]*appsv1.ReplicaSet, error) {
	selector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, err
	}

	rsList, err := cs.K8sClient.ClientSet.AppsV1().ReplicaSets(deployment.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
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
