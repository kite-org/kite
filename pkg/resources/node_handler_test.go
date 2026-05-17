package resources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

// buildTestScheme creates a runtime.Scheme with all types the handler needs.
func buildTestScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(s))
	require.NoError(t, metricsv1.AddToScheme(s))
	return s
}

// podNodeIndexer is the same indexer function registered in pkg/kube/client.go.
func podNodeIndexer(obj client.Object) []string {
	pod := obj.(*corev1.Pod)
	if pod.Spec.NodeName == "" {
		return nil
	}
	return []string{pod.Spec.NodeName}
}

// newFakeClientSet creates a cluster.ClientSet backed by a fake controller-runtime
// client that supports the spec.nodeName field indexer. Objects are pre-loaded
// into the fake client so the informer-like index is already populated.
// CacheEnabled is set to true to exercise the indexed query path.
func newFakeClientSet(t *testing.T, objs ...client.Object) *cluster.ClientSet {
	t.Helper()
	scheme := buildTestScheme(t)
	cb := fake.NewClientBuilder().
		WithScheme(scheme).
		WithIndex(&corev1.Pod{}, "spec.nodeName", podNodeIndexer)

	for _, o := range objs {
		cb = cb.WithObjects(o)
	}

	fakeClient := cb.Build()

	return &cluster.ClientSet{
		K8sClient: &kube.K8sClient{
			Client:       fakeClient,
			CacheEnabled: true,
		},
	}
}

// newFakeClientSetUncached creates a cluster.ClientSet with CacheEnabled=false
// to exercise the single cluster-wide list fallback path.
func newFakeClientSetUncached(t *testing.T, objs ...client.Object) *cluster.ClientSet {
	t.Helper()
	scheme := buildTestScheme(t)
	cb := fake.NewClientBuilder().
		WithScheme(scheme)

	for _, o := range objs {
		cb = cb.WithObjects(o)
	}

	fakeClient := cb.Build()

	return &cluster.ClientSet{
		K8sClient: &kube.K8sClient{
			Client:       fakeClient,
			CacheEnabled: false,
		},
	}
}

// newTestGinContext creates a gin.Context for testing with the given ClientSet
// injected at the "cluster" key (same as production middleware).
func newTestGinContext(t *testing.T, cs *cluster.ClientSet) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	ctx.Set("cluster", cs)
	return ctx, rec
}

// makePod is a helper to create a corev1.Pod with resource requests on a given node.
func makePod(name, namespace, nodeName string, cpuMillis int64, memoryBytes int64) *corev1.Pod {
	p := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: corev1.PodSpec{
			NodeName: nodeName,
			Containers: []corev1.Container{
				{
					Name:  "main",
					Image: "busybox",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    *resource.NewMilliQuantity(cpuMillis, resource.DecimalSI),
							corev1.ResourceMemory: *resource.NewQuantity(memoryBytes, resource.BinarySI),
						},
					},
				},
			},
		},
	}
	return p
}

// makeNode creates a corev1.Node with the given allocatable resources.
func makeNode(name string, cpuMillis int64, memoryBytes int64, maxPods int64) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: name,
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewMilliQuantity(cpuMillis, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(memoryBytes, resource.BinarySI),
				corev1.ResourcePods:   *resource.NewQuantity(maxPods, resource.DecimalSI),
			},
		},
	}
}

// makeNodeMetrics creates a metricsv1.NodeMetrics with the given usage values.
func makeNodeMetrics(name string, cpuMillis int64, memoryBytes int64) *metricsv1.NodeMetrics {
	return &metricsv1.NodeMetrics{
		ObjectMeta: metav1.ObjectMeta{
			Name: name,
		},
		Usage: corev1.ResourceList{
			corev1.ResourceCPU:    *resource.NewMilliQuantity(cpuMillis, resource.DecimalSI),
			corev1.ResourceMemory: *resource.NewQuantity(memoryBytes, resource.BinarySI),
		},
	}
}

// decodeNodeListResponse parses the JSON body from the recorder into a NodeListWithMetrics.
func decodeNodeListResponse(t *testing.T, rec *httptest.ResponseRecorder) *common.NodeListWithMetrics {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, "unexpected status code; body=%s", rec.Body.String())
	var result common.NodeListWithMetrics
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
	return &result
}

// ---------- Tests ----------

// TestNodeHandlerList_PodAssignmentByFieldIndex verifies that the List method
// correctly uses the spec.nodeName field indexer to count pods per node and
// aggregate resource requests — NOT a cluster-wide list followed by grouping.
func TestNodeHandlerList_PodAssignmentByFieldIndex(t *testing.T) {
	// Two nodes with known allocatable resources.
	nodeA := makeNode("node-a", 4000, 8*1024*1024*1024, 110)
	nodeB := makeNode("node-b", 8000, 16*1024*1024*1024, 110)

	// Pods assigned to node-a: 2 pods, 500m+200m CPU, 128Mi+256Mi Memory.
	podA1 := makePod("pod-a1", "default", "node-a", 500, 128*1024*1024)
	podA2 := makePod("pod-a2", "kube-system", "node-a", 200, 256*1024*1024)

	// Pod assigned to node-b: 1 pod, 1000m CPU, 512Mi Memory.
	podB1 := makePod("pod-b1", "default", "node-b", 1000, 512*1024*1024)

	// Unscheduled pod (no nodeName) — must NOT appear in any node's count.
	unscheduled := makePod("unscheduled-pod", "default", "", 100, 64*1024*1024)

	// NodeMetrics for both nodes.
	metricsA := makeNodeMetrics("node-a", 1200, 2*1024*1024*1024)
	metricsB := makeNodeMetrics("node-b", 3500, 6*1024*1024*1024)

	cs := newFakeClientSet(t,
		nodeA, nodeB,
		podA1, podA2, podB1, unscheduled,
		metricsA, metricsB,
	)

	ctx, rec := newTestGinContext(t, cs)
	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)

	// Nodes should be sorted alphabetically.
	require.Len(t, result.Items, 2)
	assert.Equal(t, "node-a", result.Items[0].Name)
	assert.Equal(t, "node-b", result.Items[1].Name)

	// --- node-a assertions ---
	mA := result.Items[0].Metrics
	require.NotNil(t, mA, "node-a metrics should not be nil")

	// Pod count: exactly 2 (pod-a1 + pod-a2), NOT 4 (all pods including node-b/unscheduled).
	assert.Equal(t, int64(2), mA.Pods, "node-a should have exactly 2 pods")

	// CPU request: 500 + 200 = 700m
	assert.Equal(t, int64(700), mA.CPURequest, "node-a CPU request should be 700m")

	// Memory request: 128Mi + 256Mi = 384Mi
	assert.Equal(t, int64((128+256)*1024*1024), mA.MemoryRequest, "node-a memory request should be 384Mi")

	// Allocatable limits
	assert.Equal(t, int64(4000), mA.CPULimit, "node-a CPU limit should be 4000m")
	assert.Equal(t, int64(8*1024*1024*1024), mA.MemoryLimit, "node-a memory limit should be 8Gi")
	assert.Equal(t, int64(110), mA.PodsLimit, "node-a pods limit should be 110")

	// Metrics usage from NodeMetrics
	assert.Equal(t, int64(1200), mA.CPUUsage, "node-a CPU usage from metrics")
	assert.Equal(t, int64(2*1024*1024*1024), mA.MemoryUsage, "node-a memory usage from metrics")

	// --- node-b assertions ---
	mB := result.Items[1].Metrics
	require.NotNil(t, mB, "node-b metrics should not be nil")

	assert.Equal(t, int64(1), mB.Pods, "node-b should have exactly 1 pod")
	assert.Equal(t, int64(1000), mB.CPURequest, "node-b CPU request should be 1000m")
	assert.Equal(t, int64(512*1024*1024), mB.MemoryRequest, "node-b memory request should be 512Mi")
	assert.Equal(t, int64(8000), mB.CPULimit, "node-b CPU limit should be 8000m")
	assert.Equal(t, int64(16*1024*1024*1024), mB.MemoryLimit, "node-b memory limit should be 16Gi")
	assert.Equal(t, int64(3500), mB.CPUUsage, "node-b CPU usage from metrics")
	assert.Equal(t, int64(6*1024*1024*1024), mB.MemoryUsage, "node-b memory usage from metrics")
}

// TestNodeHandlerList_EmptyCluster verifies List returns an empty items array
// when there are no nodes at all.
func TestNodeHandlerList_EmptyCluster(t *testing.T) {
	cs := newFakeClientSet(t)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	assert.Empty(t, result.Items, "empty cluster should return no nodes")
}

// TestNodeHandlerList_NodesWithoutPods verifies that nodes with no scheduled
// pods have zeroed resource requests and pod counts.
func TestNodeHandlerList_NodesWithoutPods(t *testing.T) {
	node := makeNode("lonely-node", 4000, 8*1024*1024*1024, 110)
	cs := newFakeClientSet(t, node)

	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "lonely-node", result.Items[0].Name)

	m := result.Items[0].Metrics
	require.NotNil(t, m)
	assert.Equal(t, int64(0), m.Pods, "no pods on this node")
	assert.Equal(t, int64(0), m.CPURequest, "no CPU requests")
	assert.Equal(t, int64(0), m.MemoryRequest, "no memory requests")
	// Allocatable should still be populated.
	assert.Equal(t, int64(4000), m.CPULimit)
	assert.Equal(t, int64(8*1024*1024*1024), m.MemoryLimit)
	assert.Equal(t, int64(110), m.PodsLimit)
}

// TestNodeHandlerList_MultipleContainersPerPod verifies that resource requests
// from ALL containers in a pod are summed together.
func TestNodeHandlerList_MultipleContainersPerPod(t *testing.T) {
	node := makeNode("multi-container-node", 8000, 16*1024*1024*1024, 110)

	// Pod with 2 containers: one requesting 200m/128Mi, another 300m/256Mi.
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "multi-container-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName: "multi-container-node",
			Containers: []corev1.Container{
				{
					Name:  "sidecar",
					Image: "envoy",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    *resource.NewMilliQuantity(200, resource.DecimalSI),
							corev1.ResourceMemory: *resource.NewQuantity(128*1024*1024, resource.BinarySI),
						},
					},
				},
				{
					Name:  "app",
					Image: "myapp",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    *resource.NewMilliQuantity(300, resource.DecimalSI),
							corev1.ResourceMemory: *resource.NewQuantity(256*1024*1024, resource.BinarySI),
						},
					},
				},
			},
		},
	}

	cs := newFakeClientSet(t, node, pod)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 1)

	m := result.Items[0].Metrics
	require.NotNil(t, m)
	assert.Equal(t, int64(1), m.Pods, "1 pod total")
	assert.Equal(t, int64(500), m.CPURequest, "200m + 300m = 500m across containers")
	assert.Equal(t, int64((128+256)*1024*1024), m.MemoryRequest, "128Mi + 256Mi = 384Mi across containers")
}

// TestNodeHandlerList_SortOrder verifies that nodes are returned sorted
// alphabetically by name.
func TestNodeHandlerList_SortOrder(t *testing.T) {
	// Insert in reverse order to ensure the handler sorts them.
	nodeZ := makeNode("z-node", 1000, 1*1024*1024*1024, 10)
	nodeA := makeNode("a-node", 1000, 1*1024*1024*1024, 10)
	nodeM := makeNode("m-node", 1000, 1*1024*1024*1024, 10)

	cs := newFakeClientSet(t, nodeZ, nodeA, nodeM)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 3)
	assert.Equal(t, "a-node", result.Items[0].Name)
	assert.Equal(t, "m-node", result.Items[1].Name)
	assert.Equal(t, "z-node", result.Items[2].Name)
}

// TestNodeHandlerList_CrossNamespacePods verifies that pods from different
// namespaces on the same node are aggregated together.
func TestNodeHandlerList_CrossNamespacePods(t *testing.T) {
	node := makeNode("shared-node", 4000, 8*1024*1024*1024, 110)

	pod1 := makePod("pod-ns1", "namespace-a", "shared-node", 100, 64*1024*1024)
	pod2 := makePod("pod-ns2", "namespace-b", "shared-node", 200, 128*1024*1024)
	pod3 := makePod("pod-ns3", "namespace-c", "shared-node", 300, 256*1024*1024)

	cs := newFakeClientSet(t, node, pod1, pod2, pod3)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 1)

	m := result.Items[0].Metrics
	require.NotNil(t, m)
	assert.Equal(t, int64(3), m.Pods, "3 pods across 3 namespaces")
	assert.Equal(t, int64(600), m.CPURequest, "100+200+300 = 600m")
	assert.Equal(t, int64((64+128+256)*1024*1024), m.MemoryRequest, "64+128+256 = 448Mi")
}

// ===================================================================
// Uncached path tests — exercise the single cluster-wide list fallback
// ===================================================================

// TestNodeHandlerList_Uncached_PodAssignment verifies that the uncached fallback
// (single cluster-wide pod list + group in Go) produces correct per-node metrics.
func TestNodeHandlerList_Uncached_PodAssignment(t *testing.T) {
	nodeA := makeNode("node-a", 4000, 8*1024*1024*1024, 110)
	nodeB := makeNode("node-b", 8000, 16*1024*1024*1024, 110)

	podA1 := makePod("pod-a1", "default", "node-a", 500, 128*1024*1024)
	podA2 := makePod("pod-a2", "kube-system", "node-a", 200, 256*1024*1024)
	podB1 := makePod("pod-b1", "default", "node-b", 1000, 512*1024*1024)
	unscheduled := makePod("unscheduled-pod", "default", "", 100, 64*1024*1024)

	metricsA := makeNodeMetrics("node-a", 1200, 2*1024*1024*1024)
	metricsB := makeNodeMetrics("node-b", 3500, 6*1024*1024*1024)

	cs := newFakeClientSetUncached(t,
		nodeA, nodeB,
		podA1, podA2, podB1, unscheduled,
		metricsA, metricsB,
	)

	ctx, rec := newTestGinContext(t, cs)
	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)

	require.Len(t, result.Items, 2)
	assert.Equal(t, "node-a", result.Items[0].Name)
	assert.Equal(t, "node-b", result.Items[1].Name)

	// node-a: 2 pods, 700m CPU, 384Mi memory
	mA := result.Items[0].Metrics
	require.NotNil(t, mA)
	assert.Equal(t, int64(2), mA.Pods, "node-a should have 2 pods (uncached)")
	assert.Equal(t, int64(700), mA.CPURequest, "node-a CPU request (uncached)")
	assert.Equal(t, int64((128+256)*1024*1024), mA.MemoryRequest, "node-a memory request (uncached)")
	assert.Equal(t, int64(1200), mA.CPUUsage)
	assert.Equal(t, int64(2*1024*1024*1024), mA.MemoryUsage)

	// node-b: 1 pod, 1000m CPU, 512Mi memory
	mB := result.Items[1].Metrics
	require.NotNil(t, mB)
	assert.Equal(t, int64(1), mB.Pods, "node-b should have 1 pod (uncached)")
	assert.Equal(t, int64(1000), mB.CPURequest, "node-b CPU request (uncached)")
	assert.Equal(t, int64(512*1024*1024), mB.MemoryRequest, "node-b memory request (uncached)")
}

// TestNodeHandlerList_Uncached_EmptyCluster verifies uncached path with no nodes.
func TestNodeHandlerList_Uncached_EmptyCluster(t *testing.T) {
	cs := newFakeClientSetUncached(t)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	assert.Empty(t, result.Items)
}

// TestNodeHandlerList_Uncached_NodesWithoutPods verifies uncached path with
// nodes that have no pods scheduled.
func TestNodeHandlerList_Uncached_NodesWithoutPods(t *testing.T) {
	node := makeNode("lonely-node", 4000, 8*1024*1024*1024, 110)
	cs := newFakeClientSetUncached(t, node)

	ctx, rec := newTestGinContext(t, cs)
	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 1)

	m := result.Items[0].Metrics
	require.NotNil(t, m)
	assert.Equal(t, int64(0), m.Pods, "no pods (uncached)")
	assert.Equal(t, int64(0), m.CPURequest)
	assert.Equal(t, int64(0), m.MemoryRequest)
	assert.Equal(t, int64(4000), m.CPULimit)
	assert.Equal(t, int64(110), m.PodsLimit)
}

// TestNodeHandlerList_Uncached_MultipleContainersPerPod verifies the fallback
// path sums requests from all containers in a pod.
func TestNodeHandlerList_Uncached_MultipleContainersPerPod(t *testing.T) {
	node := makeNode("multi-node", 8000, 16*1024*1024*1024, 110)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "multi-pod", Namespace: "default"},
		Spec: corev1.PodSpec{
			NodeName: "multi-node",
			Containers: []corev1.Container{
				{
					Name: "sidecar", Image: "envoy",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    *resource.NewMilliQuantity(200, resource.DecimalSI),
							corev1.ResourceMemory: *resource.NewQuantity(128*1024*1024, resource.BinarySI),
						},
					},
				},
				{
					Name: "app", Image: "myapp",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    *resource.NewMilliQuantity(300, resource.DecimalSI),
							corev1.ResourceMemory: *resource.NewQuantity(256*1024*1024, resource.BinarySI),
						},
					},
				},
			},
		},
	}

	cs := newFakeClientSetUncached(t, node, pod)
	ctx, rec := newTestGinContext(t, cs)

	handler := NewNodeHandler()
	handler.List(ctx)

	result := decodeNodeListResponse(t, rec)
	require.Len(t, result.Items, 1)

	m := result.Items[0].Metrics
	require.NotNil(t, m)
	assert.Equal(t, int64(1), m.Pods)
	assert.Equal(t, int64(500), m.CPURequest, "200+300=500m (uncached)")
	assert.Equal(t, int64((128+256)*1024*1024), m.MemoryRequest, "128+256=384Mi (uncached)")
}
