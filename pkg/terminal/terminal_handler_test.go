package terminal

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/wsutil"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestTerminalWebSocketsRejectUnauthorizedUsersBeforeClusterAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	clientSet := &cluster.ClientSet{Name: "prod", K8sClient: &kube.K8sClient{}}
	user := model.User{Username: "alice"}
	router := gin.New()
	router.GET("/terminal/:namespace/:podName", func(c *gin.Context) {
		c.Set("cluster", clientSet)
		c.Set("user", user)
		(&TerminalHandler{}).HandleTerminalWebSocket(c)
	})
	router.GET("/node/:nodeName", func(c *gin.Context) {
		c.Set("cluster", clientSet)
		c.Set("user", user)
		(&NodeTerminalHandler{}).HandleNodeTerminalWebSocket(c)
	})
	router.GET("/kubectl", func(c *gin.Context) {
		c.Set("cluster", clientSet)
		c.Set("user", user)
		(&KubectlTerminalHandler{}).HandleKubectlTerminalWebSocket(c)
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	tests := []struct {
		path        string
		wantMessage string
	}{
		{"/terminal/default/web", "does not have permission to exec pods"},
		{"/node/worker-1", "does not have permission to exec nodes"},
		{"/kubectl", "only available to admin users"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			url := "ws" + strings.TrimPrefix(server.URL, "http") + tt.path
			conn, response, err := websocket.DefaultDialer.Dial(url, nil)
			if response != nil {
				defer func() {
					_ = response.Body.Close()
				}()
			}
			if err != nil {
				if response != nil {
					t.Fatalf("dialing WebSocket: %v, status=%d", err, response.StatusCode)
				}
				t.Fatalf("dialing WebSocket: %v", err)
			}
			defer func() {
				_ = conn.Close()
			}()
			var message wsutil.Message
			if err := conn.ReadJSON(&message); err != nil {
				t.Fatalf("reading rejection: %v", err)
			}
			if message.Type != "error" || !strings.Contains(message.Data, tt.wantMessage) {
				t.Fatalf("rejection message = %#v", message)
			}
		})
	}
}

func TestTerminalAgentsUseExpectedSecurityConfigurationAndCleanupScope(t *testing.T) { //nolint:gocyclo // security configuration test covers both terminal agent types
	originalNamespace := common.AgentPodNamespace
	common.AgentPodNamespace = "kite-system"
	t.Cleanup(func() {
		common.AgentPodNamespace = originalNamespace
	})

	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("adding core scheme: %v", err)
	}
	if err := rbacv1.AddToScheme(scheme); err != nil {
		t.Fatalf("adding RBAC scheme: %v", err)
	}
	client := fake.NewClientBuilder().WithScheme(scheme).Build()
	clientSet := &cluster.ClientSet{
		Name:      "prod",
		K8sClient: &kube.K8sClient{Client: client},
	}
	ctx := context.Background()

	nodeHandler := &NodeTerminalHandler{}
	nodePodName, err := nodeHandler.createNodeAgent(ctx, clientSet, "worker-1", "debug-shell:v1")
	if err != nil {
		t.Fatalf("createNodeAgent() error = %v", err)
	}
	var nodePod corev1.Pod
	if err := client.Get(ctx, types.NamespacedName{Namespace: common.AgentPodNamespace, Name: nodePodName}, &nodePod); err != nil {
		t.Fatalf("loading node agent: %v", err)
	}
	if nodePod.Spec.NodeName != "worker-1" || !nodePod.Spec.HostPID || !nodePod.Spec.HostNetwork || !nodePod.Spec.HostIPC {
		t.Fatalf("node agent host configuration = %#v", nodePod.Spec)
	}
	if len(nodePod.Spec.Containers) != 1 || nodePod.Spec.Containers[0].Image != "debug-shell:v1" {
		t.Fatalf("node agent containers = %#v", nodePod.Spec.Containers)
	}
	container := nodePod.Spec.Containers[0]
	if container.SecurityContext == nil || container.SecurityContext.Privileged == nil || !*container.SecurityContext.Privileged {
		t.Fatalf("node agent is not privileged: %#v", container.SecurityContext)
	}
	if len(container.VolumeMounts) != 1 || container.VolumeMounts[0].MountPath != "/host" {
		t.Fatalf("node agent host mount = %#v", container.VolumeMounts)
	}

	kubectlHandler := &KubectlTerminalHandler{}
	if err := kubectlHandler.ensureAdminServiceAccount(ctx, clientSet); err != nil {
		t.Fatalf("ensureAdminServiceAccount() error = %v", err)
	}
	if err := kubectlHandler.ensureAdminServiceAccount(ctx, clientSet); err != nil {
		t.Fatalf("ensureAdminServiceAccount() was not idempotent: %v", err)
	}
	var serviceAccount corev1.ServiceAccount
	if err := client.Get(ctx, types.NamespacedName{Namespace: common.AgentPodNamespace, Name: kubectlAdminSA}, &serviceAccount); err != nil {
		t.Fatalf("loading ServiceAccount: %v", err)
	}
	var binding rbacv1.ClusterRoleBinding
	if err := client.Get(ctx, types.NamespacedName{Name: kubectlAdminSA}, &binding); err != nil {
		t.Fatalf("loading ClusterRoleBinding: %v", err)
	}
	if binding.RoleRef.Name != "cluster-admin" || len(binding.Subjects) != 1 || binding.Subjects[0].Name != kubectlAdminSA {
		t.Fatalf("kubectl ClusterRoleBinding = %#v", binding)
	}

	kubectlPodName, err := kubectlHandler.createKubectlAgent(ctx, clientSet, "session-a", "kubectl:v1")
	if err != nil {
		t.Fatalf("createKubectlAgent() error = %v", err)
	}
	var kubectlPod corev1.Pod
	if err := client.Get(ctx, types.NamespacedName{Namespace: common.AgentPodNamespace, Name: kubectlPodName}, &kubectlPod); err != nil {
		t.Fatalf("loading kubectl agent: %v", err)
	}
	if kubectlPod.Spec.ServiceAccountName != kubectlAdminSA || kubectlPod.Spec.AutomountServiceAccountToken == nil || !*kubectlPod.Spec.AutomountServiceAccountToken {
		t.Fatalf("kubectl agent service account configuration = %#v", kubectlPod.Spec)
	}
	if len(kubectlPod.Spec.Containers) != 1 || kubectlPod.Spec.Containers[0].Image != "kubectl:v1" {
		t.Fatalf("kubectl agent containers = %#v", kubectlPod.Spec.Containers)
	}

	unrelated := &corev1.Pod{}
	unrelated.Name = "unrelated"
	unrelated.Namespace = common.AgentPodNamespace
	unrelated.Labels = map[string]string{"kite.io/kubectl-session": "session-b"}
	if err := client.Create(ctx, unrelated); err != nil {
		t.Fatalf("creating unrelated pod: %v", err)
	}
	if err := kubectlHandler.cleanupPod(clientSet, "session-a"); err != nil {
		t.Fatalf("cleanupPod() error = %v", err)
	}
	if err := client.Get(ctx, types.NamespacedName{Namespace: common.AgentPodNamespace, Name: kubectlPodName}, &corev1.Pod{}); !apierrors.IsNotFound(err) {
		t.Fatalf("session pod still exists or unexpected error: %v", err)
	}
	if err := client.Get(ctx, types.NamespacedName{Namespace: common.AgentPodNamespace, Name: unrelated.Name}, &corev1.Pod{}); err != nil {
		t.Fatalf("cleanup removed unrelated pod: %v", err)
	}
}
