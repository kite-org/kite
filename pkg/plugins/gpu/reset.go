package gpu

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type ResetPodRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// ResetDevicePlugin deletes the NVIDIA device-plugin pod(s) on a node so the
// owning DaemonSet recreates them and re-registers the node's GPUs.
// ?dryRun=true only reports which pods would be deleted — the UI uses it to
// preview the target before the user confirms.
func (p *Plugin) ResetDevicePlugin(c *gin.Context) {
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccessCluster(user, cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	nodeName := c.Param("node")
	dryRun := c.Query("dryRun") == "true"

	pods, err := findDevicePluginPods(ctx, cs.K8sClient, nodeName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list pods: " + err.Error()})
		return
	}
	if len(pods) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no device plugin pod found on node " + nodeName})
		return
	}

	refs := make([]ResetPodRef, 0, len(pods))
	for i := range pods {
		if !rbac.CanAccess(user, "pods", "delete", cs.Name, pods[i].Namespace) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": rbac.NoAccess(user.Key(), "delete", "pods", pods[i].Namespace, cs.Name),
			})
			return
		}
		refs = append(refs, ResetPodRef{Namespace: pods[i].Namespace, Name: pods[i].Name})
	}

	if !dryRun {
		for i := range pods {
			if err := cs.K8sClient.Delete(ctx, &pods[i]); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Failed to delete pod " + pods[i].Namespace + "/" + pods[i].Name + ": " + err.Error(),
				})
				return
			}
			klog.Infof("gpu plugin: user %s deleted device plugin pod %s/%s on node %s (cluster %s)",
				user.Key(), pods[i].Namespace, pods[i].Name, nodeName, cs.Name)
		}
	}

	c.JSON(http.StatusOK, gin.H{"dryRun": dryRun, "pods": refs})
}

// findDevicePluginPods returns DaemonSet-owned NVIDIA device-plugin pods on
// the node, covering the common deployment styles: gpu-operator
// (app=nvidia-device-plugin-daemonset), static manifests
// (name=nvidia-device-plugin-ds) and the nvdp helm chart
// (app.kubernetes.io/name=nvidia-device-plugin).
func findDevicePluginPods(ctx context.Context, k8sClient *kube.K8sClient, nodeName string) ([]corev1.Pod, error) {
	var pods corev1.PodList
	if k8sClient.CacheEnabled {
		if err := k8sClient.List(ctx, &pods, client.MatchingFields{"spec.nodeName": nodeName}); err != nil {
			return nil, err
		}
	} else {
		if err := k8sClient.List(ctx, &pods); err != nil {
			return nil, err
		}
	}

	var matched []corev1.Pod
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.Spec.NodeName != nodeName {
			continue
		}
		if isDevicePluginPod(pod) {
			matched = append(matched, *pod)
		}
	}
	return matched, nil
}

func isDevicePluginPod(pod *corev1.Pod) bool {
	ownedByDaemonSet := false
	for _, o := range pod.OwnerReferences {
		if o.Kind == "DaemonSet" {
			ownedByDaemonSet = true
			break
		}
	}
	if !ownedByDaemonSet {
		return false
	}
	return pod.Labels["app"] == "nvidia-device-plugin-daemonset" ||
		pod.Labels["name"] == "nvidia-device-plugin-ds" ||
		pod.Labels["app.kubernetes.io/name"] == "nvidia-device-plugin" ||
		strings.HasPrefix(pod.Name, "nvidia-device-plugin")
}
