package handlers

import (
	"context"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers/wsutil"
	"github.com/zxh326/kite/pkg/utils"
	"golang.org/x/net/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	agentPodWaitTimeout   = 60 * time.Second
	agentPodCheckInterval = 2 * time.Second
)

// waitForAgentPodReady polls until the named pod in AgentPodNamespace reaches Ready status,
// sending progress dots over the WebSocket.
func waitForAgentPodReady(ctx context.Context, cs *cluster.ClientSet, conn *websocket.Conn, podName, readyMsg string) error {
	timeout := time.After(agentPodWaitTimeout)
	ticker := time.NewTicker(agentPodCheckInterval)
	defer ticker.Stop()
	_ = wsutil.SendMessage(conn, "info", fmt.Sprintf("waiting for pod %s to be ready", podName))

	var pod *corev1.Pod
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-timeout:
			_ = wsutil.SendMessage(conn, "info", "")
			wsutil.SendErrorMessage(conn, utils.GetPodErrorMessage(pod))
			return fmt.Errorf("timeout waiting for pod %s to be ready", podName)
		case <-ticker.C:
			var err error
			pod, err = cs.K8sClient.ClientSet.CoreV1().Pods(common.AgentPodNamespace).Get(ctx, podName, metav1.GetOptions{})
			if err != nil {
				continue
			}
			_ = wsutil.SendMessage(conn, "stdout", ".")
			if utils.IsPodReady(pod) {
				_ = wsutil.SendMessage(conn, "info", readyMsg)
				return nil
			}
		}
	}
}
