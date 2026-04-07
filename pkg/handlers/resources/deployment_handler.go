package resources

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/types"
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
