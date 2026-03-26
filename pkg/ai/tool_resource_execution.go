package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/zxh326/kite/pkg/cluster"
	pkgmodel "github.com/zxh326/kite/pkg/model"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

func recordResourceHistory(cs *cluster.ClientSet, user pkgmodel.User, kind, name, namespace, opType, resourceYAML, previousYAML string, success bool, err error) {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	history := pkgmodel.ResourceHistory{
		ClusterName:     cs.Name,
		ResourceType:    kind,
		ResourceName:    name,
		Namespace:       namespace,
		OperationType:   opType,
		OperationSource: "ai",
		ResourceYAML:    resourceYAML,
		PreviousYAML:    previousYAML,
		Success:         success,
		ErrorMessage:    errMsg,
		OperatorID:      user.ID,
	}
	if dbErr := pkgmodel.DB.Create(&history).Error; dbErr != nil {
		klog.Errorf("Failed to create resource history: %v", dbErr)
	}
}

func objectToYAML(obj *unstructured.Unstructured) string {
	if obj == nil {
		return ""
	}
	obj.SetManagedFields(nil)
	yamlBytes, err := yaml.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(yamlBytes)
}

func executeGetResource(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	kind, err := getRequiredString(args, "kind")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, _ := args["namespace"].(string)

	resource := resolveResourceInfo(ctx, cs, kind)
	obj := buildObjectForResource(resource)
	key := k8stypes.NamespacedName{
		Name:      name,
		Namespace: normalizeNamespace(resource, namespace),
	}
	if err := cs.K8sClient.Get(ctx, key, obj); err != nil {
		return fmt.Sprintf("Error getting %s/%s: %v", resource.Kind, name, err), true
	}

	// Clean up managed fields
	obj.SetManagedFields(nil)
	annotations := obj.GetAnnotations()
	if annotations != nil {
		delete(annotations, "kubectl.kubernetes.io/last-applied-configuration")
		obj.SetAnnotations(annotations)
	}
	redactSensitiveResourceData(resource, obj)

	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return fmt.Sprintf("Error marshaling resource: %v", err), true
	}

	return string(yamlBytes), false
}

func redactSensitiveResourceData(resource resourceInfo, obj *unstructured.Unstructured) {
	kind := strings.ToLower(strings.TrimSpace(resource.Kind))
	switch kind {
	case "secret", "configmap":
		redactObjectMapValues(obj.Object, "data")
		redactObjectMapValues(obj.Object, "stringData")
		redactObjectMapValues(obj.Object, "binaryData")
	}
}

func redactObjectMapValues(object map[string]interface{}, key string) {
	raw, ok := object[key]
	if !ok {
		return
	}
	valueMap, ok := raw.(map[string]interface{})
	if !ok {
		return
	}
	if len(valueMap) == 0 {
		return
	}
	for k := range valueMap {
		valueMap[k] = "***"
	}
	object[key] = valueMap
}

func executeListResources(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	kind, err := getRequiredString(args, "kind")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, _ := args["namespace"].(string)
	labelSelector, _ := args["label_selector"].(string)

	resource := resolveResourceInfo(ctx, cs, kind)
	namespace = normalizeNamespace(resource, namespace)
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(resource.ListGVK())

	var listOpts []client.ListOption
	if namespace != "" {
		listOpts = append(listOpts, client.InNamespace(namespace))
	}
	if labelSelector != "" {
		selector, err := labels.Parse(labelSelector)
		if err != nil {
			return fmt.Sprintf("Error parsing label_selector: %v", err), true
		}
		listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: selector})
	}

	if err := cs.K8sClient.List(ctx, list, listOpts...); err != nil {
		return fmt.Sprintf("Error listing %s: %v", resource.Kind, err), true
	}

	// Build a summary
	var sb strings.Builder
	kindLower := strings.ToLower(resource.Kind)
	fmt.Fprintf(&sb, "Found %d %s(s)", len(list.Items), resource.Kind)
	if namespace != "" {
		fmt.Fprintf(&sb, " in namespace %s", namespace)
	}
	if labelSelector != "" {
		fmt.Fprintf(&sb, " (label_selector: %s)", labelSelector)
	}
	sb.WriteString(":\n\n")

	for _, item := range list.Items {
		name := item.GetName()
		ns := item.GetNamespace()
		creationTime := item.GetCreationTimestamp().Format("2006-01-02 15:04:05")

		if ns != "" {
			sb.WriteString(fmt.Sprintf("- %s/%s (created: %s)", ns, name, creationTime))
		} else {
			sb.WriteString(fmt.Sprintf("- %s (created: %s)", name, creationTime))
		}

		for _, detail := range resourceSummaryDetails(kindLower, item) {
			sb.WriteString(fmt.Sprintf(" | %s", detail))
		}
		sb.WriteString("\n")
	}

	return sb.String(), false
}

func resourceSummaryDetails(kindLower string, item unstructured.Unstructured) []string {
	details := make([]string, 0, 8)

	if phase, ok, _ := unstructured.NestedString(item.Object, "status", "phase"); ok && phase != "" {
		details = append(details, "phase="+phase)
	}

	details = append(details, kindSpecificResourceSummaryDetails(kindLower, item)...)

	if len(details) == 0 {
		if labels := item.GetLabels(); len(labels) > 0 {
			labelKeys := make([]string, 0, len(labels))
			for k := range labels {
				labelKeys = append(labelKeys, k)
			}
			sort.Strings(labelKeys)
			labelsSummary := make([]string, 0, 3)
			for i, k := range labelKeys {
				if i == 3 {
					break
				}
				v := labels[k]
				labelsSummary = append(labelsSummary, k+"="+v)
			}
			details = append(details, "labels="+strings.Join(labelsSummary, ","))
		}
	}

	return details
}

func kindSpecificResourceSummaryDetails(kindLower string, item unstructured.Unstructured) []string {
	switch kindLower {
	case "pod", "pods":
		return podSummaryDetails(item)
	case "deployment", "deployments":
		return deploymentSummaryDetails(item)
	case "statefulset", "statefulsets", "replicaset", "replicasets":
		return replicaSummaryDetails(item)
	case "daemonset", "daemonsets":
		return daemonSetSummaryDetails(item)
	case "service", "services", "svc":
		return serviceSummaryDetails(item)
	case "node", "nodes":
		return nodeSummaryDetails(item)
	case "namespace", "namespaces", "ns":
		return namespaceSummaryDetails(item)
	case "job", "jobs":
		return jobSummaryDetails(item)
	case "pvc", "persistentvolumeclaim", "persistentvolumeclaims":
		return pvcSummaryDetails(item)
	default:
		return nil
	}
}

func podSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 4)
	ready := int64(0)
	total := int64(0)
	restarts := int64(0)
	if statuses, found, _ := unstructured.NestedSlice(item.Object, "status", "containerStatuses"); found {
		for _, s := range statuses {
			statusMap, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			total++
			if isReady, ok := statusMap["ready"].(bool); ok && isReady {
				ready++
			}
			if restartValue, ok := asInt64(statusMap["restartCount"]); ok {
				restarts += restartValue
			}
		}
	}
	details = append(details, fmt.Sprintf("ready=%d/%d", ready, total))
	details = append(details, fmt.Sprintf("restarts=%d", restarts))
	if podIP, ok, _ := unstructured.NestedString(item.Object, "status", "podIP"); ok && podIP != "" {
		details = append(details, "podIP="+podIP)
	}
	if nodeName, ok, _ := unstructured.NestedString(item.Object, "spec", "nodeName"); ok && nodeName != "" {
		details = append(details, "node="+nodeName)
	}
	return details
}

func deploymentSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 3)
	ready, _, _ := unstructured.NestedInt64(item.Object, "status", "readyReplicas")
	desired, hasDesired, _ := unstructured.NestedInt64(item.Object, "spec", "replicas")
	if !hasDesired {
		desired = 1
	}
	details = append(details, fmt.Sprintf("ready=%d/%d", ready, desired))
	if updated, ok, _ := unstructured.NestedInt64(item.Object, "status", "updatedReplicas"); ok {
		details = append(details, fmt.Sprintf("updated=%d", updated))
	}
	if available, ok, _ := unstructured.NestedInt64(item.Object, "status", "availableReplicas"); ok {
		details = append(details, fmt.Sprintf("available=%d", available))
	}
	return details
}

func replicaSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 1)
	ready, _, _ := unstructured.NestedInt64(item.Object, "status", "readyReplicas")
	desired, hasDesired, _ := unstructured.NestedInt64(item.Object, "spec", "replicas")
	if !hasDesired {
		desired = 1
	}
	details = append(details, fmt.Sprintf("ready=%d/%d", ready, desired))
	return details
}

func daemonSetSummaryDetails(item unstructured.Unstructured) []string {
	ready, _, _ := unstructured.NestedInt64(item.Object, "status", "numberReady")
	desired, _, _ := unstructured.NestedInt64(item.Object, "status", "desiredNumberScheduled")
	return []string{fmt.Sprintf("ready=%d/%d", ready, desired)}
}

func serviceSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 3)
	if serviceType, ok, _ := unstructured.NestedString(item.Object, "spec", "type"); ok && serviceType != "" {
		details = append(details, "type="+serviceType)
	}
	if clusterIP, ok, _ := unstructured.NestedString(item.Object, "spec", "clusterIP"); ok && clusterIP != "" {
		details = append(details, "clusterIP="+clusterIP)
	}
	if ingress, found, _ := unstructured.NestedSlice(item.Object, "status", "loadBalancer", "ingress"); found && len(ingress) > 0 {
		external := serviceExternalAddresses(ingress)
		if len(external) > 0 {
			details = append(details, "external="+strings.Join(external, ","))
		}
	}
	return details
}

func serviceExternalAddresses(ingress []interface{}) []string {
	external := make([]string, 0, len(ingress))
	for _, entry := range ingress {
		ingressMap, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		if ip, ok := ingressMap["ip"].(string); ok && ip != "" {
			external = append(external, ip)
			continue
		}
		if hostname, ok := ingressMap["hostname"].(string); ok && hostname != "" {
			external = append(external, hostname)
		}
	}
	sort.Strings(external)
	return external
}

func nodeSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 3)
	if ready := nodeReadyStatus(item.Object); ready != "" {
		details = append(details, "ready="+ready)
	}
	if version, ok, _ := unstructured.NestedString(item.Object, "status", "nodeInfo", "kubeletVersion"); ok && version != "" {
		details = append(details, "kubelet="+version)
	}
	roles := nodeRoles(item.GetLabels())
	if len(roles) > 0 {
		details = append(details, "roles="+strings.Join(roles, ","))
	}
	return details
}

func namespaceSummaryDetails(item unstructured.Unstructured) []string {
	if phase, ok, _ := unstructured.NestedString(item.Object, "status", "phase"); ok && phase != "" {
		return []string{"status=" + phase}
	}
	return nil
}

func jobSummaryDetails(item unstructured.Unstructured) []string {
	succeeded, _, _ := unstructured.NestedInt64(item.Object, "status", "succeeded")
	failed, _, _ := unstructured.NestedInt64(item.Object, "status", "failed")
	active, _, _ := unstructured.NestedInt64(item.Object, "status", "active")
	return []string{
		fmt.Sprintf("active=%d", active),
		fmt.Sprintf("succeeded=%d", succeeded),
		fmt.Sprintf("failed=%d", failed),
	}
}

func pvcSummaryDetails(item unstructured.Unstructured) []string {
	details := make([]string, 0, 3)
	if phase, ok, _ := unstructured.NestedString(item.Object, "status", "phase"); ok && phase != "" {
		details = append(details, "status="+phase)
	}
	if storageClass, ok, _ := unstructured.NestedString(item.Object, "spec", "storageClassName"); ok && storageClass != "" {
		details = append(details, "storageClass="+storageClass)
	}
	if capacity, ok, _ := unstructured.NestedString(item.Object, "status", "capacity", "storage"); ok && capacity != "" {
		details = append(details, "capacity="+capacity)
	}
	return details
}

func nodeReadyStatus(obj map[string]interface{}) string {
	conditions, found, _ := unstructured.NestedSlice(obj, "status", "conditions")
	if !found {
		return ""
	}
	for _, c := range conditions {
		conditionMap, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		typeValue, _ := conditionMap["type"].(string)
		if typeValue != "Ready" {
			continue
		}
		if statusValue, ok := conditionMap["status"].(string); ok {
			return statusValue
		}
		return fmt.Sprintf("%v", conditionMap["status"])
	}
	return ""
}

func nodeRoles(labels map[string]string) []string {
	roles := make([]string, 0, 3)
	for key := range labels {
		if strings.HasPrefix(key, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(key, "node-role.kubernetes.io/")
			if role == "" {
				role = "worker"
			}
			roles = append(roles, role)
		}
	}
	sort.Strings(roles)
	return roles
}

func asInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int8:
		return int64(n), true
	case int16:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case uint:
		return int64(n), true
	case uint8:
		return int64(n), true
	case uint16:
		return int64(n), true
	case uint32:
		return int64(n), true
	case uint64:
		if n > ^uint64(0)>>1 {
			return 0, false
		}
		return int64(n), true
	case float64:
		return int64(n), true
	case float32:
		return int64(n), true
	default:
		return 0, false
	}
}

func executeGetPodLogs(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	name, _ := args["name"].(string)
	namespace, _ := args["namespace"].(string)
	container, _ := args["container"].(string)

	tailLines := int64(100)
	if tl, ok := args["tail_lines"].(float64); ok {
		tailLines = int64(tl)
	}
	previous, _ := args["previous"].(bool)

	if name == "" || namespace == "" {
		return "Error: name and namespace are required", true
	}

	logOpts := &corev1.PodLogOptions{
		TailLines: &tailLines,
		Previous:  previous,
	}
	if container != "" {
		logOpts.Container = container
	}

	req := cs.K8sClient.ClientSet.CoreV1().Pods(namespace).GetLogs(name, logOpts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return fmt.Sprintf("Error getting logs for pod %s/%s: %v", namespace, name, err), true
	}
	defer func() {
		if err := stream.Close(); err != nil {
			klog.Warningf("Failed to close pod log stream for %s/%s: %v", namespace, name, err)
		}
	}()

	logBytes, err := io.ReadAll(io.LimitReader(stream, 32*1024)) // 32KB limit
	if err != nil {
		return fmt.Sprintf("Error reading logs: %v", err), true
	}

	if len(logBytes) == 0 {
		return fmt.Sprintf("No logs available for pod %s/%s", namespace, name), false
	}

	return fmt.Sprintf("Logs for pod %s/%s:\n\n```\n%s\n```", namespace, name, string(logBytes)), false
}

func executeGetClusterOverview(ctx context.Context, cs *cluster.ClientSet) (string, bool) {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Cluster: %s\n\n", cs.Name))

	// Nodes
	nodes := &corev1.NodeList{}
	if err := cs.K8sClient.List(ctx, nodes); err != nil {
		sb.WriteString(fmt.Sprintf("Error listing nodes: %v\n", err))
	} else {
		ready := 0
		for _, node := range nodes.Items {
			for _, cond := range node.Status.Conditions {
				if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
					ready++
				}
			}
		}
		sb.WriteString(fmt.Sprintf("Nodes: %d total, %d ready\n", len(nodes.Items), ready))
	}

	// Pods
	pods := &corev1.PodList{}
	if err := cs.K8sClient.List(ctx, pods); err != nil {
		sb.WriteString(fmt.Sprintf("Error listing pods: %v\n", err))
	} else {
		running, pending, failed, succeeded := 0, 0, 0, 0
		for _, pod := range pods.Items {
			switch pod.Status.Phase {
			case corev1.PodRunning:
				running++
			case corev1.PodPending:
				pending++
			case corev1.PodFailed:
				failed++
			case corev1.PodSucceeded:
				succeeded++
			}
		}
		sb.WriteString(fmt.Sprintf("Pods: %d total (%d running, %d pending, %d failed, %d succeeded)\n", len(pods.Items), running, pending, failed, succeeded))
	}

	// Namespaces
	namespaces := &corev1.NamespaceList{}
	if err := cs.K8sClient.List(ctx, namespaces); err == nil {
		sb.WriteString(fmt.Sprintf("Namespaces: %d\n", len(namespaces.Items)))
	}

	// Services
	services := &corev1.ServiceList{}
	if err := cs.K8sClient.List(ctx, services); err == nil {
		sb.WriteString(fmt.Sprintf("Services: %d\n", len(services.Items)))
	}

	return sb.String(), false
}

func executeCreateResource(ctx context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	obj, err := parseResourceYAML(args)
	if err != nil {
		return "Error: " + err.Error(), true
	}

	yamlStr, _ := getRequiredString(args, "yaml")
	resource := resolveResourceInfoForObject(ctx, cs, obj)
	err = cs.K8sClient.Create(ctx, obj)

	recordResourceHistory(cs, user, resource.Resource, obj.GetName(), obj.GetNamespace(), "create", yamlStr, "", err == nil, err)

	if err != nil {
		return fmt.Sprintf("Error creating %s/%s: %v", obj.GetKind(), obj.GetName(), err), true
	}

	klog.V(1).Infof("AI Agent created resource: %s/%s in namespace %s", obj.GetKind(), obj.GetName(), obj.GetNamespace())
	return fmt.Sprintf("Successfully created %s/%s", obj.GetKind(), obj.GetName()), false
}

func executeUpdateResource(ctx context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	obj, err := parseResourceYAML(args)
	if err != nil {
		return "Error: " + err.Error(), true
	}

	yamlStr, _ := getRequiredString(args, "yaml")

	// Get previous state
	resource := resolveResourceInfoForObject(ctx, cs, obj)
	prevObj := buildObjectForResource(resource)
	key := k8stypes.NamespacedName{
		Name:      obj.GetName(),
		Namespace: normalizeNamespace(resource, obj.GetNamespace()),
	}
	var previousYAML string
	if getErr := cs.K8sClient.Get(ctx, key, prevObj); getErr == nil {
		previousYAML = objectToYAML(prevObj)
	}

	err = cs.K8sClient.Update(ctx, obj)

	recordResourceHistory(cs, user, resource.Resource, obj.GetName(), obj.GetNamespace(), "update", yamlStr, previousYAML, err == nil, err)

	if err != nil {
		return fmt.Sprintf("Error updating %s/%s: %v", obj.GetKind(), obj.GetName(), err), true
	}

	klog.V(1).Infof("AI Agent updated resource: %s/%s in namespace %s", obj.GetKind(), obj.GetName(), obj.GetNamespace())
	return fmt.Sprintf("Successfully updated %s/%s", obj.GetKind(), obj.GetName()), false
}

func executePatchResource(ctx context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	kind, err := getRequiredString(args, "kind")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, _ := args["namespace"].(string)
	patchStr, err := getRequiredString(args, "patch")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	if !json.Valid([]byte(patchStr)) {
		return "Error: patch must be valid JSON", true
	}

	resource := resolveResourceInfo(ctx, cs, kind)
	obj := buildObjectForResource(resource)

	key := k8stypes.NamespacedName{
		Name:      name,
		Namespace: normalizeNamespace(resource, namespace),
	}
	if err := cs.K8sClient.Get(ctx, key, obj); err != nil {
		return fmt.Sprintf("Error finding %s/%s: %v", resource.Kind, name, err), true
	}

	// Get previous state
	previousYAML := objectToYAML(obj.DeepCopy())

	patchBytes := []byte(patchStr)
	patch := client.RawPatch(k8stypes.StrategicMergePatchType, patchBytes)
	err = cs.K8sClient.Patch(ctx, obj, patch)

	// Get current state after patch
	currentYAML := ""
	if err == nil {
		currentYAML = objectToYAML(obj)
	}

	recordResourceHistory(cs, user, resource.Resource, name, normalizeNamespace(resource, namespace), "patch", currentYAML, previousYAML, err == nil, err)

	if err != nil {
		return fmt.Sprintf("Error patching %s/%s: %v", resource.Kind, name, err), true
	}

	klog.V(1).Infof("AI Agent patched resource: %s/%s in namespace %s", resource.Kind, name, normalizeNamespace(resource, namespace))
	return fmt.Sprintf("Successfully patched %s/%s", resource.Kind, name), false
}

func executeDeleteResource(ctx context.Context, cs *cluster.ClientSet, user pkgmodel.User, args map[string]interface{}) (string, bool) {
	kind, err := getRequiredString(args, "kind")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	name, err := getRequiredString(args, "name")
	if err != nil {
		return "Error: " + err.Error(), true
	}
	namespace, _ := args["namespace"].(string)

	resource := resolveResourceInfo(ctx, cs, kind)
	obj := buildObjectForResource(resource)

	key := k8stypes.NamespacedName{
		Name:      name,
		Namespace: normalizeNamespace(resource, namespace),
	}

	// Get previous state before deletion
	var previousYAML string
	if getErr := cs.K8sClient.Get(ctx, key, obj); getErr != nil {
		if apierrors.IsNotFound(getErr) {
			return fmt.Sprintf("%s/%s not found, already deleted", resource.Kind, name), false
		}
		return fmt.Sprintf("Error finding %s/%s: %v", resource.Kind, name, getErr), true
	}

	previousYAML = objectToYAML(obj)
	err = cs.K8sClient.Delete(ctx, obj)

	recordResourceHistory(cs, user, resource.Resource, name, normalizeNamespace(resource, namespace), "delete", "", previousYAML, err == nil || apierrors.IsNotFound(err), err)

	if err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Sprintf("%s/%s not found, already deleted", resource.Kind, name), false
		}
		return fmt.Sprintf("Error deleting %s/%s: %v", resource.Kind, name, err), true
	}

	klog.V(1).Infof("AI Agent deleted resource: %s/%s in namespace %s", resource.Kind, name, normalizeNamespace(resource, namespace))
	return fmt.Sprintf("Successfully deleted %s/%s", resource.Kind, name), false
}
