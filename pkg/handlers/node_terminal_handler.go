package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
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
		if !rbac.CanAccess(user, "nodes", "exec", cs.Name, "") {
			h.sendErrorMessage(conn, rbac.NoAccess(user.Key(), string(common.VerbExec), "nodes", "", cs.Name))
			return
		}
		node, err := cs.K8sClient.ClientSet.CoreV1().Nodes().Get(context.TODO(), nodeName, metav1.GetOptions{})
		if err != nil {
			log.Printf("Failed to get node %s: %v", nodeName, err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to get node %s: %v", nodeName, err))
			return
		}
		if node == nil {
			log.Printf("Node %s not found", nodeName)
			h.sendErrorMessage(conn, fmt.Sprintf("Node %s not found", nodeName))
			return
		}
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()

		nodeAgentName, err := h.createNodeAgent(ctx, cs, nodeName)
		if err != nil {
			log.Printf("Failed to create node agent pod: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to create node agent pod: %v", err))
			return
		}

		// Ensure cleanup of the node agent pod
		defer func() {
			klog.Infof("Cleaning up node agent pod %s", nodeAgentName)
			if err := h.cleanupNodeAgentPod(cs, nodeAgentName); err != nil {
				log.Printf("Failed to cleanup node agent pod %s: %v", nodeAgentName, err)
			}
		}()

		if err := h.waitForPodReady(ctx, cs, conn, nodeAgentName); err != nil {
			log.Printf("Failed to wait for pod ready: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to wait for pod ready: %v", err))
			return
		}

		session := kube.NewTerminalSession(cs.K8sClient, conn, common.AgentPodNamespace, nodeAgentName, common.NodeTerminalPodName)
		if err := session.Start(ctx, "attach"); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}

func (h *NodeTerminalHandler) createNodeAgent(ctx context.Context, cs *cluster.ClientSet, nodeName string) (string, error) {
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
					Name:      common.NodeTerminalPodName,
					Image:     common.NodeTerminalImage,
					Stdin:     true,
					StdinOnce: true,
					TTY:       true,
					Command:   []string{"/bin/sh", "-c", "chroot /host || (exec /bin/zsh || exec /bin/bash || exec /bin/sh)"},
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

// waitForPodReady waits for the kite node agent pod to be ready
func (h *NodeTerminalHandler) waitForPodReady(ctx context.Context, cs *cluster.ClientSet, conn *websocket.Conn, podName string) error {
	timeout := time.After(60 * time.Second)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	h.sendMessage(conn, "info", fmt.Sprintf("waiting for pod %s to be ready", podName))

	var pod *corev1.Pod
	var err error
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timeout:
			h.sendMessage(conn, "info", "")
			h.sendErrorMessage(conn, utils.GetPodErrorMessage(pod))
			return fmt.Errorf("timeout waiting for pod %s to be ready", podName)
		case <-ticker.C:
			pod, err = cs.K8sClient.ClientSet.CoreV1().Pods(common.AgentPodNamespace).Get(
				context.TODO(),
				podName,
				metav1.GetOptions{},
			)
			if err != nil {
				continue
			}
			h.sendMessage(conn, "stdout", ".")
			if utils.IsPodReady(pod) {
				h.sendMessage(conn, "info", "ready!")
				return nil
			}
		}
	}
}

func (h *NodeTerminalHandler) cleanupNodeAgentPod(cs *cluster.ClientSet, podName string) error {
	return cs.K8sClient.ClientSet.CoreV1().Pods(common.AgentPodNamespace).Delete(
		context.TODO(),
		podName,
		metav1.DeleteOptions{},
	)
}

// sendErrorMessage sends an error message through WebSocket
func (h *NodeTerminalHandler) sendErrorMessage(conn *websocket.Conn, message string) {
	msg := map[string]interface{}{
		"type": "error",
		"data": message,
	}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send error message: %v", err)
	}
}

// sendErrorMessage sends an error message through WebSocket
func (h *NodeTerminalHandler) sendMessage(conn *websocket.Conn, msgType, message string) {
	msg := map[string]interface{}{
		"type": msgType,
		"data": message,
	}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send message: %v", err)
	}
}
