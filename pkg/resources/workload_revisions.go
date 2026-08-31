package resources

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/klog/v2"
	cmdutil "k8s.io/kubectl/pkg/cmd/util"
	"k8s.io/kubectl/pkg/polymorphichelpers"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const changeCauseAnnotation = "kubernetes.io/change-cause"

type WorkloadRevisionItem struct {
	Revision       int64       `json:"revision"`
	RevisionObject string      `json:"revisionObject"`
	ChangeCause    string      `json:"changeCause,omitempty"`
	Images         []string    `json:"images"`
	Replicas       *int32      `json:"replicas,omitempty"`
	CreatedAt      metav1.Time `json:"createdAt"`
	Current        bool        `json:"current"`
}

type workloadRollbackRequest struct {
	Revision int64 `json:"revision"`
}

type controllerRevisionTemplatePatch struct {
	Spec struct {
		Template corev1.PodTemplateSpec `json:"template"`
	} `json:"spec"`
}

func controllerRevisionImages(data []byte) []string {
	var patch controllerRevisionTemplatePatch
	if err := json.Unmarshal(data, &patch); err != nil {
		return []string{}
	}
	images := make([]string, 0, len(patch.Spec.Template.Spec.Containers))
	for _, container := range patch.Spec.Template.Spec.Containers {
		images = append(images, container.Image)
	}
	return images
}

func controllerRevisionItems(revisions []*appsv1.ControllerRevision, currentIndex int) []WorkloadRevisionItem {
	items := make([]WorkloadRevisionItem, 0, len(revisions))
	for i, revision := range revisions {
		items = append(items, WorkloadRevisionItem{
			Revision:       revision.Revision,
			RevisionObject: revision.Name,
			ChangeCause:    revision.Annotations[changeCauseAnnotation],
			Images:         controllerRevisionImages(revision.Data.Raw),
			CreatedAt:      revision.CreationTimestamp,
			Current:        i == currentIndex,
		})
	}
	return items
}

func (h *GenericResourceHandler[T, V]) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()

	var req workloadRollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	groupKind := h.getGroupKind()
	resource, err := workloadFromClientSet(ctx, cs, groupKind, namespace, name)
	if err != nil {
		if apierrors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	workload := resource.(T)
	previous := workload.DeepCopyObject().(T)
	current := workload
	var success bool
	var errMsg string
	defer func() {
		h.recordHistory(c, "rollback", previous, current, success, errMsg)
	}()

	rollbacker, err := polymorphichelpers.RollbackerFor(groupKind, cs.K8sClient.ClientSet)
	if err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	message, err := rollbacker.Rollback(workload, nil, req.Revision, cmdutil.DryRunNone)
	if err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	success = true

	updated, err := workloadFromClientSet(ctx, cs, groupKind, namespace, name)
	if err == nil {
		current = updated.(T)
	} else {
		klog.Warningf("failed to get %s %s/%s after rollback: %v", groupKind.Kind, namespace, name, err)
	}

	response := gin.H{"message": message}
	if req.Revision > 0 {
		response["revision"] = req.Revision
	}
	c.JSON(http.StatusOK, response)
}

func workloadFromClientSet(ctx context.Context, cs *cluster.ClientSet, groupKind schema.GroupKind, namespace, name string) (client.Object, error) {
	switch groupKind.Kind {
	case "Deployment":
		return cs.K8sClient.ClientSet.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	case "StatefulSet":
		return cs.K8sClient.ClientSet.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	case "DaemonSet":
		return cs.K8sClient.ClientSet.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	default:
		return nil, fmt.Errorf("rollback is not supported for %s", groupKind.String())
	}
}
