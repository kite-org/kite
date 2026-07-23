package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestGetOverviewAggregatesClusterResources(t *testing.T) {
	gin.SetMode(gin.TestMode)
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("adding core scheme: %v", err)
	}

	nodeOneCPU := resource.MustParse("2")
	nodeOneMemory := resource.MustParse("8Gi")
	nodeTwoCPU := resource.MustParse("4")
	nodeTwoMemory := resource.MustParse("16Gi")
	requestCPU := resource.MustParse("100m")
	requestMemory := resource.MustParse("64Mi")
	limitCPU := resource.MustParse("250m")
	limitMemory := resource.MustParse("128Mi")
	pendingCPU := resource.MustParse("50m")
	pendingMemory := resource.MustParse("32Mi")
	terminalCPU := resource.MustParse("1")
	terminalMemory := resource.MustParse("1Gi")

	client := fake.NewClientBuilder().WithScheme(scheme).WithObjects(
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-ready"},
			Status: corev1.NodeStatus{
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    nodeOneCPU,
					corev1.ResourceMemory: nodeOneMemory,
				},
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			},
		},
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-not-ready"},
			Status: corev1.NodeStatus{
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    nodeTwoCPU,
					corev1.ResourceMemory: nodeTwoMemory,
				},
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionFalse}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "running", Namespace: "default"},
			Spec: corev1.PodSpec{Containers: []corev1.Container{{
				Name: "app",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: requestCPU, corev1.ResourceMemory: requestMemory},
					Limits:   corev1.ResourceList{corev1.ResourceCPU: limitCPU, corev1.ResourceMemory: limitMemory},
				},
			}}},
			Status: corev1.PodStatus{
				Phase:      corev1.PodRunning,
				Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pending", Namespace: "default"},
			Spec: corev1.PodSpec{Containers: []corev1.Container{{
				Name: "app",
				Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
					corev1.ResourceCPU: pendingCPU, corev1.ResourceMemory: pendingMemory,
				}},
			}}},
			Status: corev1.PodStatus{Phase: corev1.PodPending},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "succeeded", Namespace: "jobs"},
			Spec: corev1.PodSpec{Containers: []corev1.Container{{
				Name: "job",
				Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
					corev1.ResourceCPU: terminalCPU, corev1.ResourceMemory: terminalMemory,
				}},
			}}},
			Status: corev1.PodStatus{Phase: corev1.PodSucceeded},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "failed", Namespace: "jobs"},
			Spec: corev1.PodSpec{Containers: []corev1.Container{{
				Name: "job",
				Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{
					corev1.ResourceCPU: terminalCPU, corev1.ResourceMemory: terminalMemory,
				}},
			}}},
			Status: corev1.PodStatus{Phase: corev1.PodFailed},
		},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "jobs"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: "jobs"}},
	).Build()

	clientSet := &cluster.ClientSet{
		Name:      "prod",
		K8sClient: &kube.K8sClient{Client: client},
	}
	user := model.User{Username: "alice", Roles: []common.Role{{
		Name:     "prod-viewer",
		Clusters: []string{"prod"},
	}}}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/overview", nil)
	ctx.Set("cluster", clientSet)
	ctx.Set("user", user)

	GetOverview(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var result OverviewData
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if result.TotalNodes != 2 || result.ReadyNodes != 1 {
		t.Fatalf("node counts = %d/%d, want 2/1", result.TotalNodes, result.ReadyNodes)
	}
	if result.TotalPods != 4 || result.RunningPods != 2 {
		t.Fatalf("pod counts = %d/%d, want 4/2", result.TotalPods, result.RunningPods)
	}
	if result.TotalNamespaces != 2 || result.TotalServices != 2 {
		t.Fatalf("namespace/service counts = %d/%d, want 2/2", result.TotalNamespaces, result.TotalServices)
	}
	if result.Resource.CPU.Allocatable != nodeOneCPU.MilliValue()+nodeTwoCPU.MilliValue() {
		t.Fatalf("CPU allocatable = %d", result.Resource.CPU.Allocatable)
	}
	if result.Resource.CPU.Requested != requestCPU.MilliValue()+pendingCPU.MilliValue() {
		t.Fatalf("CPU requested = %d", result.Resource.CPU.Requested)
	}
	if result.Resource.CPU.Limited != limitCPU.MilliValue() {
		t.Fatalf("CPU limited = %d", result.Resource.CPU.Limited)
	}
	if result.Resource.Mem.Allocatable != nodeOneMemory.MilliValue()+nodeTwoMemory.MilliValue() {
		t.Fatalf("memory allocatable = %d", result.Resource.Mem.Allocatable)
	}
	if result.Resource.Mem.Requested != requestMemory.MilliValue()+pendingMemory.MilliValue() {
		t.Fatalf("memory requested = %d", result.Resource.Mem.Requested)
	}
	if result.Resource.Mem.Limited != limitMemory.MilliValue() {
		t.Fatalf("memory limited = %d", result.Resource.Mem.Limited)
	}
}

func TestGetOverviewRejectsUnauthorizedCluster(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/overview", nil)
	ctx.Set("cluster", &cluster.ClientSet{Name: "prod"})
	ctx.Set("user", model.User{Username: "alice"})

	GetOverview(ctx)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
