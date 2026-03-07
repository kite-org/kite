package handlers

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

func TestGetOverviewCountsSucceededPodsAsRunning(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to add corev1 scheme: %v", err)
	}

	objects := []runtime.Object{
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
			Status: corev1.NodeStatus{
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("4"),
					corev1.ResourceMemory: resource.MustParse("8Gi"),
				},
				Conditions: []corev1.NodeCondition{
					{
						Type:   corev1.NodeReady,
						Status: corev1.ConditionTrue,
					},
				},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pod-running", Namespace: "default"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name:  "app",
						Image: "busybox",
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("100m"),
								corev1.ResourceMemory: resource.MustParse("64Mi"),
							},
						},
					},
				},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				Conditions: []corev1.PodCondition{
					{
						Type:   corev1.PodReady,
						Status: corev1.ConditionTrue,
					},
				},
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pod-completed", Namespace: "default"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name:  "job",
						Image: "busybox",
					},
				},
			},
			Status: corev1.PodStatus{
				Phase:  corev1.PodSucceeded,
				Reason: "Completed",
			},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pod-pending", Namespace: "default"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name:  "init",
						Image: "busybox",
					},
				},
			},
			Status: corev1.PodStatus{
				Phase: corev1.PodPending,
			},
		},
		&corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: "default"},
		},
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{Name: "svc", Namespace: "default"},
			Spec: corev1.ServiceSpec{
				Selector: map[string]string{"app": "demo"},
				Ports: []corev1.ServicePort{
					{Port: 80},
				},
			},
		},
	}

	fakeClient := fake.NewClientBuilder().WithScheme(scheme).WithRuntimeObjects(objects...).Build()
	cs := &cluster.ClientSet{
		Name:      "test",
		K8sClient: &kube.K8sClient{Client: fakeClient},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set("cluster", cs)
	c.Set("user", model.User{
		Username: "tester",
		Roles:    []common.Role{{Name: "viewer"}},
	})

	GetOverview(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d, body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var overview OverviewData
	if err := json.Unmarshal(w.Body.Bytes(), &overview); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}

	if overview.TotalPods != 3 {
		t.Fatalf("expected totalPods=3, got %d", overview.TotalPods)
	}
	if overview.RunningPods != 2 {
		t.Fatalf("expected runningPods=2 (Running+Completed), got %d", overview.RunningPods)
	}
}
