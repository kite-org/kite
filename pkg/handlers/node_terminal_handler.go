package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers/wsutil"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
)

type NodeTerminalHandler struct {
}

func NewNodeTerminalHandler() *NodeTerminalHandler {
	return &NodeTerminalHandler{}
}

// HandleNodeTerminalWebSocket handles WebSocket connections for node terminal access
func (h *NodeTerminalHandler) HandleNodeTerminalWebSocket(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	nodeName := c.Param("nodeName")
	if nodeName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Node name is required"})
		return
	}

	user := c.MustGet("user").(model.User)

	websocket.Handler(func(conn *websocket.Conn) {
		defer func() {
			_ = conn.Close()
		}()
		if !rbac.CanAccess(user, string(common.Nodes), "exec", cs.Name, "") {
			wsutil.SendErrorMessage(conn, rbac.NoAccess(user.Key(), string(common.VerbExec), string(common.Nodes), "", cs.Name))
			return
		}
		node, err := cs.K8sClient.ClientSet.CoreV1().Nodes().Get(context.TODO(), nodeName, metav1.GetOptions{})
		if err != nil {
			klog.Errorf("Failed to get node %s: %v", nodeName, err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to get node %s: %v", nodeName, err))
			return
		}
		if node == nil {
			klog.Errorf("Node %s not found", nodeName)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Node %s not found", nodeName))
			return
		}
		setting, err := model.GetGeneralSetting()
		if err != nil {
			klog.Errorf("Failed to load general setting: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to load settings: %v", err))
			return
		}
		nodeTerminalImage := strings.TrimSpace(setting.NodeTerminalImage)
		if nodeTerminalImage == "" {
			nodeTerminalImage = common.NodeTerminalImage
		}
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()

		nodeAgentName, err := h.createNodeAgent(ctx, cs, nodeName, nodeTerminalImage)
		if err != nil {
			klog.Errorf("Failed to create node agent pod: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to create node agent pod: %v", err))
			return
		}

		// Ensure cleanup of the node agent pod
		defer func() {
			klog.Infof("Cleaning up node agent pod %s", nodeAgentName)
			if err := h.cleanupNodeAgentPod(cs, nodeAgentName); err != nil {
				klog.Errorf("Failed to cleanup node agent pod %s: %v", nodeAgentName, err)
			}
		}()

		if err := waitForAgentPodReady(ctx, cs, conn, nodeAgentName, "ready!"); err != nil {
			klog.Errorf("Failed to wait for pod ready: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to wait for pod ready: %v", err))
			return
		}

		session := kube.NewTerminalSession(cs.K8sClient, conn, common.AgentPodNamespace, nodeAgentName, common.NodeTerminalPodName)
		if err := session.Start(ctx, "attach"); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}

func (h *NodeTerminalHandler) createNodeAgent(ctx context.Context, cs *cluster.ClientSet, nodeName, image string) (string, error) {
	podName := utils.GenerateNodeAgentName(nodeName)
	// Define the kite node agent pod spec
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: common.AgentPodNamespace,
			Labels: map[string]string{
				"app": podName,
			},
		},
		Spec: corev1.PodSpec{
			NodeName:      nodeName,
			HostNetwork:   true,
			HostPID:       true,
			HostIPC:       true,
			RestartPolicy: corev1.RestartPolicyNever,
			Tolerations: []corev1.Toleration{
				{
					Operator: corev1.TolerationOpExists,
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "host",
					VolumeSource: corev1.VolumeSource{
						HostPath: &corev1.HostPathVolumeSource{
							Path: "/",
						},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name:            common.NodeTerminalPodName,
					Image:           image,
					ImagePullPolicy: corev1.PullIfNotPresent,
					Stdin:           true,
					StdinOnce:       true,
					TTY:             true,
					Command:         []string{"/bin/sh", "-c", "chroot /host || (exec /bin/zsh || exec /bin/bash || exec /bin/sh)"},
					SecurityContext: &corev1.SecurityContext{
						Privileged: &[]bool{true}[0],
					},
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "host",
							MountPath: "/host",
						},
					},
				},
			},
		},
	}

	object := &corev1.Pod{}
	namespacedName := types.NamespacedName{Name: podName, Namespace: common.AgentPodNamespace}
	if err := cs.K8sClient.Get(ctx, namespacedName, object); err == nil {
		if utils.IsPodErrorOrSuccess(object) {
			if err := cs.K8sClient.Delete(ctx, object); err != nil {
				return "", fmt.Errorf("failed to delete existing kite node agent pod: %w", err)
			}
		} else {
			return podName, nil
		}
	}

	// Create the pod
	err := cs.K8sClient.Create(ctx, pod)
	if err != nil {
		return "", fmt.Errorf("failed to create kite node agent pod: %w", err)
	}

	return podName, nil
}

func (h *NodeTerminalHandler) cleanupNodeAgentPod(cs *cluster.ClientSet, podName string) error {
	return cs.K8sClient.ClientSet.CoreV1().Pods(common.AgentPodNamespace).Delete(
		context.TODO(),
		podName,
		metav1.DeleteOptions{},
	)
}
