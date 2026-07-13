package gpu

import (
	"context"
	"testing"

	prommodel "github.com/prometheus/common/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zxh326/kite/pkg/kube"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const nvidiaGPU = corev1.ResourceName("nvidia.com/gpu")

func podNodeIndexer(obj client.Object) []string {
	pod := obj.(*corev1.Pod)
	if pod.Spec.NodeName == "" {
		return nil
	}
	return []string{pod.Spec.NodeName}
}

func newFakeK8sClient(t *testing.T, cached bool, objs ...client.Object) *kube.K8sClient {
	t.Helper()
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	cb := fake.NewClientBuilder().WithScheme(scheme)
	if cached {
		cb = cb.WithIndex(&corev1.Pod{}, "spec.nodeName", podNodeIndexer)
	}
	for _, o := range objs {
		cb = cb.WithObjects(o)
	}
	return &kube.K8sClient{Client: cb.Build(), CacheEnabled: cached}
}

func gpuNode(name string, gpus int64) *corev1.Node {
	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:   name,
			Labels: map[string]string{"nvidia.com/gpu.product": "NVIDIA-A100-SXM4-80GB"},
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				nvidiaGPU: *resource.NewQuantity(gpus, resource.DecimalSI),
			},
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}
}

func gpuPod(ns, name, node string, phase corev1.PodPhase, gpus int64) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
		Spec: corev1.PodSpec{
			NodeName: node,
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							nvidiaGPU: *resource.NewQuantity(gpus, resource.DecimalSI),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{Phase: phase},
	}
}

func TestBuildOverviewBasic(t *testing.T) {
	for _, cached := range []bool{true, false} {
		k8sClient := newFakeK8sClient(t, cached,
			gpuNode("gpu-node-1", 4),
			&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "cpu-node"}},
			gpuPod("ml", "train", "gpu-node-1", corev1.PodRunning, 2),
			gpuPod("ml", "pending", "gpu-node-1", corev1.PodPending, 1),
			gpuPod("ml", "done", "gpu-node-1", corev1.PodSucceeded, 1),
			gpuPod("ml", "failed", "gpu-node-1", corev1.PodFailed, 1),
		)

		overview, err := buildOverview(context.Background(), k8sClient, defaultKeys)
		require.NoError(t, err, "cached=%v", cached)

		assert.Equal(t, levelBasic, overview.Level)
		assert.Equal(t, int64(4), overview.Summary.TotalGPUs)
		// Succeeded/Failed pods must not count as occupied.
		assert.Equal(t, int64(3), overview.Summary.AllocatedGPUs)
		assert.Equal(t, int64(1), overview.Summary.FreeGPUs)

		require.Len(t, overview.Nodes, 1, "non-GPU nodes must be excluded")
		node := overview.Nodes[0]
		assert.Equal(t, "gpu-node-1", node.Name)
		assert.True(t, node.Ready)
		assert.Equal(t, "NVIDIA-A100-SXM4-80GB", node.GPUModel)
		require.Len(t, node.Resources, 1)
		assert.Equal(t, int64(4), node.Resources[0].Allocatable)
		assert.Equal(t, int64(3), node.Resources[0].Allocated)
		require.Len(t, node.Resources[0].Pods, 2)
		assert.Equal(t, "pending", node.Resources[0].Pods[0].Name)
		assert.Equal(t, "train", node.Resources[0].Pods[1].Name)
		assert.Equal(t, int64(2), node.Resources[0].Pods[1].Count)
	}
}

func TestBuildOverviewFreeClamp(t *testing.T) {
	// Over-committed (e.g. device plugin restarted and allocatable dropped):
	// free must clamp to 0, not go negative.
	k8sClient := newFakeK8sClient(t, true,
		gpuNode("gpu-node-1", 1),
		gpuPod("ml", "a", "gpu-node-1", corev1.PodRunning, 2),
	)
	overview, err := buildOverview(context.Background(), k8sClient, defaultKeys)
	require.NoError(t, err)
	assert.Equal(t, int64(0), overview.Summary.FreeGPUs)
}

func TestResourceKeysEnvOverride(t *testing.T) {
	t.Setenv("GPU_RESOURCE_KEYS", "nvidia.com/gpu, amd.com/gpu, example.com/npu")
	keys := ResourceKeys()
	require.Len(t, keys, 3)
	assert.Equal(t, "nvidia", keys[0].Vendor)
	assert.NotNil(t, keys[0].Exporter)
	assert.Equal(t, "amd", keys[1].Vendor)
	assert.Nil(t, keys[1].Exporter)
	assert.Equal(t, "example", keys[2].Vendor)

	t.Setenv("GPU_RESOURCE_KEYS", "")
	assert.Equal(t, defaultKeys, ResourceKeys())
}

func TestOccupantOf(t *testing.T) {
	// honor_labels=false: exported_* carries the workload, pod is the exporter itself.
	m := prommodel.Metric{
		"exported_namespace": "ml",
		"exported_pod":       "train-abc",
		"exported_container": "trainer",
		"namespace":          "gpu-operator",
		"pod":                "dcgm-exporter-xyz",
	}
	occ := occupantOf(m, true)
	require.NotNil(t, occ)
	assert.Equal(t, "ml", occ.Namespace)
	assert.Equal(t, "train-abc", occ.Pod)
	assert.Equal(t, "trainer", occ.Container)

	// Idle card in honor_labels=false mode: exported_pod absent, the plain pod
	// label (exporter's own pod) must NOT be mistaken for an occupant.
	idle := prommodel.Metric{
		"namespace": "gpu-operator",
		"pod":       "dcgm-exporter-xyz",
	}
	assert.Nil(t, occupantOf(idle, true))

	// honor_labels=true: plain labels carry the workload.
	direct := prommodel.Metric{
		"namespace": "ml",
		"pod":       "train-abc",
		"container": "trainer",
	}
	occ = occupantOf(direct, false)
	require.NotNil(t, occ)
	assert.Equal(t, "train-abc", occ.Pod)

	// dcgm-exporter without Kubernetes pod mapping: pod/namespace are the
	// scrape target's own metadata and must not become an occupant.
	self := prommodel.Metric{
		"namespace": "gpu-operator",
		"pod":       "nvidia-dcgm-exporter-l6wjn",
		"container": "nvidia-dcgm-exporter",
		"job":       "nvidia-dcgm-exporter",
		"service":   "nvidia-dcgm-exporter",
	}
	assert.Nil(t, occupantOf(self, false))

	assert.Nil(t, occupantOf(prommodel.Metric{}, false))
}

func TestCardID(t *testing.T) {
	assert.Equal(t, "GPU-abc", cardID(prommodel.Metric{"UUID": "GPU-abc"}))
	assert.Equal(t, "GPU-abc/mig-3", cardID(prommodel.Metric{"UUID": "GPU-abc", "GPU_I_ID": "3"}))
	// No UUID: fall back to node + index.
	assert.Equal(t, "node-1/gpu-0", cardID(prommodel.Metric{"Hostname": "node-1", "gpu": "0"}))
}

func devicePluginPod(name, node string, labels map[string]string, ownedByDS bool) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "gpu-operator", Name: name, Labels: labels},
		Spec:       corev1.PodSpec{NodeName: node},
	}
	if ownedByDS {
		pod.OwnerReferences = []metav1.OwnerReference{{Kind: "DaemonSet", Name: "nvidia-device-plugin-daemonset", APIVersion: "apps/v1"}}
	}
	return pod
}

func TestFindDevicePluginPods(t *testing.T) {
	for _, cached := range []bool{true, false} {
		k8sClient := newFakeK8sClient(t, cached,
			// gpu-operator style on the target node
			devicePluginPod("nvidia-device-plugin-daemonset-5k4fg", "gpu-node-1",
				map[string]string{"app": "nvidia-device-plugin-daemonset"}, true),
			// same daemonset but on another node — must not match
			devicePluginPod("nvidia-device-plugin-daemonset-other", "gpu-node-2",
				map[string]string{"app": "nvidia-device-plugin-daemonset"}, true),
			// dcgm-exporter on the target node — must not match
			devicePluginPod("nvidia-dcgm-exporter-7zrqx", "gpu-node-1",
				map[string]string{"app": "nvidia-dcgm-exporter"}, true),
			// name matches but not DaemonSet-owned — must not match
			devicePluginPod("nvidia-device-plugin-standalone", "gpu-node-1",
				map[string]string{}, false),
		)

		pods, err := findDevicePluginPods(context.Background(), k8sClient, "gpu-node-1")
		require.NoError(t, err, "cached=%v", cached)
		require.Len(t, pods, 1, "cached=%v", cached)
		assert.Equal(t, "nvidia-device-plugin-daemonset-5k4fg", pods[0].Name)
	}
}

func TestIsDevicePluginPod(t *testing.T) {
	// static manifests style
	assert.True(t, isDevicePluginPod(devicePluginPod("nvidia-device-plugin-ds-abc", "n1",
		map[string]string{"name": "nvidia-device-plugin-ds"}, true)))
	// nvdp helm chart style
	assert.True(t, isDevicePluginPod(devicePluginPod("nvdp-xyz", "n1",
		map[string]string{"app.kubernetes.io/name": "nvidia-device-plugin"}, true)))
	// name-prefix fallback
	assert.True(t, isDevicePluginPod(devicePluginPod("nvidia-device-plugin-abc", "n1", nil, true)))
	assert.False(t, isDevicePluginPod(devicePluginPod("some-workload", "n1", nil, true)))
}

func TestSortCards(t *testing.T) {
	cards := []Card{{Index: "10"}, {Index: "2"}, {Index: "0"}}
	sortCards(cards)
	assert.Equal(t, []string{"0", "2", "10"}, []string{cards[0].Index, cards[1].Index, cards[2].Index})
}
