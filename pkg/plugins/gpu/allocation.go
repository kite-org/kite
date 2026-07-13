package gpu

import (
	"context"
	"sort"

	"github.com/zxh326/kite/pkg/kube"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// buildOverview assembles the basic (scheduler view) overview from the
// Kubernetes API: node allocatable vs. GPU requests of active pods.
func buildOverview(ctx context.Context, k8sClient *kube.K8sClient, keys []GPUResourceKey) (*Overview, error) {
	gpuNodes, err := listGPUNodes(ctx, k8sClient, keys)
	if err != nil {
		return nil, err
	}

	overview := &Overview{
		Level: levelBasic,
		Nodes: make([]NodeGPU, 0, len(gpuNodes)),
	}
	for _, k := range keys {
		overview.ResourceKeys = append(overview.ResourceKeys, string(k.Key))
	}

	podsByNode := listPodsByNode(ctx, k8sClient, gpuNodes)
	for i := range gpuNodes {
		node := &gpuNodes[i]
		nodeGPU := NodeGPU{
			Name:      node.Name,
			Ready:     isNodeReady(node),
			Resources: []NodeResource{},
		}
		for _, k := range keys {
			allocatable, ok := node.Status.Allocatable[k.Key]
			if !ok || allocatable.IsZero() {
				continue
			}
			if nodeGPU.GPUModel == "" && k.ProductLabel != "" {
				nodeGPU.GPUModel = node.Labels[k.ProductLabel]
			}
			allocated, pods := podAllocations(podsByNode[node.Name], k.Key)
			nodeGPU.Resources = append(nodeGPU.Resources, NodeResource{
				Key:         string(k.Key),
				Allocatable: allocatable.Value(),
				Allocated:   allocated,
				Pods:        pods,
			})
			overview.Summary.TotalGPUs += allocatable.Value()
			overview.Summary.AllocatedGPUs += allocated
		}
		overview.Nodes = append(overview.Nodes, nodeGPU)
	}
	sort.Slice(overview.Nodes, func(i, j int) bool {
		return overview.Nodes[i].Name < overview.Nodes[j].Name
	})
	overview.Summary.FreeGPUs = overview.Summary.TotalGPUs - overview.Summary.AllocatedGPUs
	if overview.Summary.FreeGPUs < 0 {
		overview.Summary.FreeGPUs = 0
	}
	return overview, nil
}

func listGPUNodes(ctx context.Context, k8sClient *kube.K8sClient, keys []GPUResourceKey) ([]corev1.Node, error) {
	var nodes corev1.NodeList
	if err := k8sClient.List(ctx, &nodes); err != nil {
		return nil, err
	}
	var gpuNodes []corev1.Node
	for i := range nodes.Items {
		if nodeGPUCount(&nodes.Items[i], keys) > 0 {
			gpuNodes = append(gpuNodes, nodes.Items[i])
		}
	}
	return gpuNodes, nil
}

func nodeGPUCount(node *corev1.Node, keys []GPUResourceKey) int64 {
	var total int64
	for _, k := range keys {
		if q, ok := node.Status.Allocatable[k.Key]; ok {
			total += q.Value()
		}
	}
	return total
}

// listPodsByNode mirrors listNodeResourceRequests in pkg/resources: with the
// informer cache it lists per node via the spec.nodeName field index,
// otherwise it lists all pods once and groups them.
func listPodsByNode(ctx context.Context, k8sClient *kube.K8sClient, nodes []corev1.Node) map[string][]corev1.Pod {
	podsByNode := make(map[string][]corev1.Pod, len(nodes))
	if !k8sClient.CacheEnabled {
		var allPods corev1.PodList
		if err := k8sClient.List(ctx, &allPods); err != nil {
			klog.Warningf("gpu plugin: failed to list pods: %v", err)
			return podsByNode
		}
		for _, pod := range allPods.Items {
			if pod.Spec.NodeName != "" {
				podsByNode[pod.Spec.NodeName] = append(podsByNode[pod.Spec.NodeName], pod)
			}
		}
		return podsByNode
	}

	for i := range nodes {
		var nodePods corev1.PodList
		if err := k8sClient.List(ctx, &nodePods, client.MatchingFields{"spec.nodeName": nodes[i].Name}); err != nil {
			klog.Warningf("gpu plugin: failed to list pods for node %s: %v", nodes[i].Name, err)
			continue
		}
		podsByNode[nodes[i].Name] = nodePods.Items
	}
	return podsByNode
}

// podAllocations sums the GPU requests of active pods for one resource key.
// Only Running and Pending pods count: Succeeded/Failed pods no longer hold
// devices. GPUs are extended resources where requests must equal limits, so
// Limits is authoritative.
func podAllocations(pods []corev1.Pod, key corev1.ResourceName) (int64, []PodAllocation) {
	var total int64
	allocations := []PodAllocation{}
	for i := range pods {
		pod := &pods[i]
		if pod.Status.Phase != corev1.PodRunning && pod.Status.Phase != corev1.PodPending {
			continue
		}
		var containers []ContainerAllocation
		var podCount int64
		for _, container := range pod.Spec.Containers {
			q, ok := container.Resources.Limits[key]
			if !ok || q.IsZero() {
				continue
			}
			containers = append(containers, ContainerAllocation{Name: container.Name, Count: q.Value()})
			podCount += q.Value()
		}
		if podCount == 0 {
			continue
		}
		total += podCount
		allocations = append(allocations, PodAllocation{
			Namespace:  pod.Namespace,
			Name:       pod.Name,
			Count:      podCount,
			Containers: containers,
		})
	}
	sort.Slice(allocations, func(i, j int) bool {
		if allocations[i].Namespace != allocations[j].Namespace {
			return allocations[i].Namespace < allocations[j].Namespace
		}
		return allocations[i].Name < allocations[j].Name
	})
	return total, allocations
}

func isNodeReady(node *corev1.Node) bool {
	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			return cond.Status == corev1.ConditionTrue
		}
	}
	return false
}
