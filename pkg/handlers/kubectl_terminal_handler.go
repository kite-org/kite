package handlers

import (
	"context"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/handlers/wsutil"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/zxh326/kite/pkg/common"
)

const (
	kubectlAdminSA = "kite-kubectl-admin"
)

type KubectlTerminalHandler struct {
}

func NewKubectlTerminalHandler() *KubectlTerminalHandler {
	return &KubectlTerminalHandler{}
}

func (h *KubectlTerminalHandler) HandleKubectlTerminalWebSocket(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	websocket.Handler(func(conn *websocket.Conn) {
		defer func() {
			_ = conn.Close()
		}()

		// Only admin users can use the kubectl terminal
		if !rbac.UserHasRole(user, model.DefaultAdminRole.Name) {
			wsutil.SendErrorMessage(conn, "kubectl terminal is only available to admin users")
			return
		}

		setting, err := model.GetGeneralSetting()
		if err != nil {
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to load settings: %v", err))
			return
		}
		if !setting.KubectlEnabled {
			wsutil.SendErrorMessage(conn, "kubectl terminal is disabled")
			return
		}
		kubectlImage := strings.TrimSpace(setting.KubectlImage)
		if kubectlImage == "" {
			kubectlImage = common.KubectlTerminalImage
		}

		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()

		// Ensure the shared admin ServiceAccount + ClusterRoleBinding exist
		if err := h.ensureAdminServiceAccount(ctx, cs); err != nil {
			klog.Errorf("Failed to ensure kubectl admin SA: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to setup kubectl terminal: %v", err))
			return
		}

		instanceID := utils.GenerateKubectlAgentName(user.Key())

		podName, err := h.createKubectlAgent(ctx, cs, instanceID, kubectlImage)
		if err != nil {
			klog.Errorf("Failed to create kubectl agent pod: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to create kubectl agent pod: %v", err))
			_ = h.cleanupPod(cs, instanceID)
			return
		}

		defer func() {
			klog.Infof("Cleaning up kubectl pod %s", instanceID)
			if err := h.cleanupPod(cs, instanceID); err != nil {
				klog.Errorf("Failed to cleanup kubectl pod %s: %v", instanceID, err)
			}
		}()

		if err := waitForAgentPodReady(ctx, cs, conn, podName, "kubectl agent ready!"); err != nil {
			klog.Errorf("Failed to wait for kubectl agent pod ready: %v", err)
			wsutil.SendErrorMessage(conn, fmt.Sprintf("Failed to wait for kubectl agent pod ready: %v", err))
			return
		}

		session := kube.NewTerminalSession(cs.K8sClient, conn, common.AgentPodNamespace, podName, common.KubectlTerminalPodName)
		if err := session.Start(ctx, "attach"); err != nil {
			klog.Errorf("Kubectl terminal session error: %v", err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}

// ensureAdminServiceAccount creates a cluster-admin ServiceAccount once if it doesn't exist.
func (h *KubectlTerminalHandler) ensureAdminServiceAccount(ctx context.Context, cs *cluster.ClientSet) error {
	labels := map[string]string{
		"app.kubernetes.io/managed-by": "kite",
		"kite.io/component":            "kubectl-terminal",
	}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      kubectlAdminSA,
			Namespace: common.AgentPodNamespace,
			Labels:    labels,
		},
	}
	if err := cs.K8sClient.Create(ctx, sa); client.IgnoreAlreadyExists(err) != nil {
		return fmt.Errorf("failed to create ServiceAccount: %w", err)
	}

	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   kubectlAdminSA,
			Labels: labels,
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      kubectlAdminSA,
				Namespace: common.AgentPodNamespace,
			},
		},
		RoleRef: rbacv1.RoleRef{
			Kind:     "ClusterRole",
			Name:     "cluster-admin",
			APIGroup: "rbac.authorization.k8s.io",
		},
	}
	if err := cs.K8sClient.Create(ctx, crb); client.IgnoreAlreadyExists(err) != nil {
		return fmt.Errorf("failed to create ClusterRoleBinding: %w", err)
	}

	return nil
}

func (h *KubectlTerminalHandler) createKubectlAgent(ctx context.Context, cs *cluster.ClientSet, instanceID, image string) (string, error) {
	podName := instanceID

	gracePeriod := int64(0)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: common.AgentPodNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "kite",
				"kite.io/component":            "kubectl-terminal",
				"kite.io/kubectl-session":      instanceID,
			},
		},
		Spec: corev1.PodSpec{
			RestartPolicy:                 corev1.RestartPolicyNever,
			ServiceAccountName:            kubectlAdminSA,
			AutomountServiceAccountToken:  &[]bool{true}[0],
			Hostname:                      "kubectl",
			TerminationGracePeriodSeconds: &gracePeriod,
			Containers: []corev1.Container{
				{
					Name:            common.KubectlTerminalPodName,
					Image:           image,
					ImagePullPolicy: corev1.PullIfNotPresent,
					Stdin:           true,
					StdinOnce:       true,
					TTY:             true,
					Command:         []string{"bash", "-c", `exec bash`},
				},
			},
		},
	}

	if err := cs.K8sClient.Create(ctx, pod); err != nil {
		return "", fmt.Errorf("failed to create kubectl agent pod: %w", err)
	}

	return podName, nil
}

// cleanupPod deletes only the per-session pod (the admin SA/CRB are permanent).
func (h *KubectlTerminalHandler) cleanupPod(cs *cluster.ClientSet, instanceID string) error {
	ctx := context.TODO()
	opts := []client.DeleteAllOfOption{
		client.InNamespace(common.AgentPodNamespace),
		client.MatchingLabels{"kite.io/kubectl-session": instanceID},
		client.PropagationPolicy(metav1.DeletePropagationBackground),
	}
	return cs.K8sClient.DeleteAllOf(ctx, &corev1.Pod{}, opts...)
}
