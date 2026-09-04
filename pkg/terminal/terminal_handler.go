package terminal

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/wsutil"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/klog/v2"
)

type TerminalHandler struct {
}

func NewTerminalHandler() *TerminalHandler {
	return &TerminalHandler{}
}

// HandleTerminalWebSocket handles WebSocket connections for terminal sessions
func (h *TerminalHandler) HandleTerminalWebSocket(c *gin.Context) {
	// Get cluster info from context
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// Get path parameters
	namespace := c.Param("namespace")
	podName := c.Param("podName")
	container := c.Query("container")

	if namespace == "" || podName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and podName are required"})
		return
	}

	user := c.MustGet("user").(model.User)

	wsutil.Serve(c.Writer, c.Request, func(ws *wsutil.Session) {
		session := kube.NewTerminalSession(cs.K8sClient, ws.Conn, namespace, podName, container)
		defer session.Close()

		if !rbac.CanAccess(user, string(common.Pods), "exec", cs.Name, namespace) {
			ws.SendErrorMessage(
				rbac.NoAccess(user.Key(), string(common.VerbExec), string(common.Pods), namespace, cs.Name),
			)
			return
		}

		subResource := "exec"
		if c.Query("attach") == "true" {
			var err error
			subResource, err = waitForDebugContainer(ws, cs, namespace, podName, container)
			if err != nil {
				ws.SendErrorMessage(fmt.Sprintf("Unable to connect to debug container %s: %v", container, err))
				return
			}
		}

		if err := session.Start(ws.Context, subResource); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	})
}

type containerLookup struct {
	found       bool
	interactive bool
	statuses    []corev1.ContainerStatus
}

func lookupContainer(pod *corev1.Pod, name string) containerLookup {
	for _, c := range pod.Spec.EphemeralContainers {
		if c.Name == name {
			return containerLookup{true, c.Stdin && c.TTY, pod.Status.EphemeralContainerStatuses}
		}
	}
	for _, c := range pod.Spec.Containers {
		if c.Name == name {
			return containerLookup{true, c.Stdin && c.TTY, pod.Status.ContainerStatuses}
		}
	}
	for _, c := range pod.Spec.InitContainers {
		if c.Name == name {
			return containerLookup{true, c.Stdin && c.TTY, pod.Status.InitContainerStatuses}
		}
	}
	return containerLookup{}
}

// waitForDebugContainer blocks until the container is running and returns the
// subresource to stream through: "attach" when the container keeps stdin/tty open,
// "exec" otherwise.
func waitForDebugContainer(ws *wsutil.Session, cs *cluster.ClientSet, namespace, podName, container string) (string, error) {
	lastMessage := fmt.Sprintf("Waiting for debug container %s to start", container)
	if err := ws.SendMessage("info", lastMessage); err != nil {
		return "", err
	}
	subResource := "exec"
	err := wait.PollUntilContextTimeout(ws.Context, time.Second, 60*time.Second, true, func(ctx context.Context) (bool, error) {
		pod, err := cs.K8sClient.ClientSet.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			return false, err
		}
		if pod.DeletionTimestamp != nil || pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			return false, fmt.Errorf("pod %s is terminating or has completed", podName)
		}
		target := lookupContainer(pod, container)
		if !target.found {
			return false, fmt.Errorf("debug container %s not found", container)
		}
		if target.interactive {
			subResource = "attach"
		}
		for _, status := range target.statuses {
			if status.Name != container {
				continue
			}
			if status.State.Running != nil {
				return true, nil
			}
			if terminated := status.State.Terminated; terminated != nil {
				return false, fmt.Errorf("debug container %s has exited (code %d)", container, terminated.ExitCode)
			}
			if waiting := status.State.Waiting; waiting != nil {
				message := fmt.Sprintf("%s: %s", waiting.Reason, waiting.Message)
				if message != lastMessage {
					lastMessage = message
					if err := ws.SendMessage("info", message); err != nil {
						return false, err
					}
				}
			}
		}
		return false, nil
	})
	if err != nil {
		return "", err
	}
	return subResource, nil
}
