package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/shared"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	pkgmodel "github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

type agentToolDefinition struct {
	Name        string
	Description string
	Properties  map[string]any
	Required    []string
}

func toolDefinitions() []agentToolDefinition {
	return []agentToolDefinition{
		{
			Name:        "get_resource",
			Description: "Get a specific Kubernetes resource by kind, name, and optionally namespace. Returns the resource details in YAML format.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind, e.g. Pod, Deployment, Service, ConfigMap, Secret, Node, Namespace, StatefulSet, DaemonSet, Job, CronJob, Ingress, PersistentVolumeClaim, etc.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources like Node, Namespace.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "list_resources",
			Description: "List Kubernetes resources of a given kind, optionally filtered by namespace and label selector. Returns a summary of matching resources.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind, e.g. Pod, Deployment, Service, ConfigMap, Node, Namespace, etc.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace to list resources in. Leave empty for all namespaces or cluster-scoped resources.",
				},
				"label_selector": map[string]any{
					"type":        "string",
					"description": "Optional label selector to filter resources, e.g. 'app=nginx' or 'environment=production'.",
				},
			},
			Required: []string{"kind"},
		},
		{
			Name:        "get_pod_logs",
			Description: "Get recent logs from a pod. Useful for debugging issues or analyzing application behavior.",
			Properties: map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the pod.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the pod.",
				},
				"container": map[string]any{
					"type":        "string",
					"description": "The container name. Leave empty for the default container.",
				},
				"tail_lines": map[string]any{
					"type":        "integer",
					"description": "Number of recent log lines to retrieve. Defaults to 100.",
				},
				"previous": map[string]any{
					"type":        "boolean",
					"description": "If true, return logs from the previous terminated container instance.",
				},
			},
			Required: []string{"name", "namespace"},
		},
		{
			Name:        "get_cluster_overview",
			Description: "Get an overview of the cluster status including node count, pod count, namespaces, and resource usage summary.",
			Properties:  map[string]any{},
		},
		{
			Name:        "create_resource",
			Description: "Create a Kubernetes resource from a YAML definition.",
			Properties: map[string]any{
				"yaml": map[string]any{
					"type":        "string",
					"description": "The YAML definition of the resource to create.",
				},
			},
			Required: []string{"yaml"},
		},
		{
			Name:        "update_resource",
			Description: "Update an existing Kubernetes resource with a new YAML definition.",
			Properties: map[string]any{
				"yaml": map[string]any{
					"type":        "string",
					"description": "The updated YAML definition of the resource.",
				},
			},
			Required: []string{"yaml"},
		},
		{
			Name:        "patch_resource",
			Description: "Patch a Kubernetes resource using strategic merge patch. Useful for partial updates like scaling replicas, updating labels/annotations, restarting deployments (by patching pod template annotations), changing image versions, etc.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind (e.g. Deployment, StatefulSet, Service).",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources.",
				},
				"patch": map[string]any{
					"type":        "string",
					"description": "The JSON patch content (strategic merge patch). Example: {\"spec\":{\"replicas\":3}} to scale, or {\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\"2024-01-01T00:00:00Z\"}}}}} to restart.",
				},
			},
			Required: []string{"kind", "name", "patch"},
		},
		{
			Name:        "delete_resource",
			Description: "Delete a Kubernetes resource.",
			Properties: map[string]any{
				"kind": map[string]any{
					"type":        "string",
					"description": "The resource kind.",
				},
				"name": map[string]any{
					"type":        "string",
					"description": "The name of the resource.",
				},
				"namespace": map[string]any{
					"type":        "string",
					"description": "The namespace of the resource. Leave empty for cluster-scoped resources.",
				},
			},
			Required: []string{"kind", "name"},
		},
		{
			Name:        "query_prometheus",
			Description: "Execute a PromQL query against Prometheus to retrieve metrics data. Use this to get monitoring information like CPU usage, memory usage, network traffic, custom application metrics, etc. Returns time series data or instant values. Note: Requires cluster-wide read access as metrics can span multiple namespaces.",
			Properties: map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The PromQL query expression. Examples: 'up', 'rate(container_cpu_usage_seconds_total[5m])', 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100'",
				},
				"query_type": map[string]any{
					"type":        "string",
					"description": "Type of query: 'instant' for current values or 'range' for time series data over a period. Defaults to 'instant'.",
					"enum":        []string{"instant", "range"},
				},
				"duration": map[string]any{
					"type":        "string",
					"description": "Time range for range queries. Examples: '30m', '1h', '24h'. Only used when query_type is 'range'. Defaults to '1h'.",
				},
			},
			Required: []string{"query"},
		},
	}
}

func OpenAIToolDefs() []openai.ChatCompletionToolParam {
	defs := toolDefinitions()
	tools := make([]openai.ChatCompletionToolParam, 0, len(defs))

	for _, def := range defs {
		parameters := shared.FunctionParameters{
			"type":       "object",
			"properties": def.Properties,
		}
		if len(def.Required) > 0 {
			parameters["required"] = def.Required
		}

		tools = append(tools, openai.ChatCompletionToolParam{
			Function: shared.FunctionDefinitionParam{
				Name:        def.Name,
				Description: openai.String(def.Description),
				Parameters:  parameters,
			},
		})
	}

	return tools
}

func AnthropicToolDefs() []anthropic.ToolUnionParam {
	defs := toolDefinitions()
	tools := make([]anthropic.ToolUnionParam, 0, len(defs))

	for _, def := range defs {
		tool := anthropic.ToolParam{
			Name:        def.Name,
			Description: anthropic.String(def.Description),
			InputSchema: anthropic.ToolInputSchemaParam{
				Type:       "object",
				Properties: def.Properties,
				Required:   def.Required,
			},
		}
		tools = append(tools, anthropic.ToolUnionParam{OfTool: &tool})
	}

	return tools
}

type resourceInfo struct {
	Kind          string
	Resource      string
	Group         string
	Version       string
	ClusterScoped bool
}

func resolveStaticResourceInfo(kind string) resourceInfo {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "pod", "pods":
		return resourceInfo{Kind: "Pod", Resource: "pods", Version: "v1"}
	case "service", "services", "svc":
		return resourceInfo{Kind: "Service", Resource: "services", Version: "v1"}
	case "configmap", "configmaps", "cm":
		return resourceInfo{Kind: "ConfigMap", Resource: "configmaps", Version: "v1"}
	case "secret", "secrets":
		return resourceInfo{Kind: "Secret", Resource: "secrets", Version: "v1"}
	case "namespace", "namespaces", "ns":
		return resourceInfo{Kind: "Namespace", Resource: "namespaces", Version: "v1", ClusterScoped: true}
	case "node", "nodes":
		return resourceInfo{Kind: "Node", Resource: "nodes", Version: "v1", ClusterScoped: true}
	case "persistentvolumeclaim", "persistentvolumeclaims", "pvc":
		return resourceInfo{Kind: "PersistentVolumeClaim", Resource: "persistentvolumeclaims", Version: "v1"}
	case "persistentvolume", "persistentvolumes", "pv":
		return resourceInfo{Kind: "PersistentVolume", Resource: "persistentvolumes", Version: "v1", ClusterScoped: true}
	case "serviceaccount", "serviceaccounts", "sa":
		return resourceInfo{Kind: "ServiceAccount", Resource: "serviceaccounts", Version: "v1"}
	case "deployment", "deployments", "deploy":
		return resourceInfo{Kind: "Deployment", Resource: "deployments", Group: "apps", Version: "v1"}
	case "statefulset", "statefulsets", "sts":
		return resourceInfo{Kind: "StatefulSet", Resource: "statefulsets", Group: "apps", Version: "v1"}
	case "daemonset", "daemonsets", "ds":
		return resourceInfo{Kind: "DaemonSet", Resource: "daemonsets", Group: "apps", Version: "v1"}
	case "replicaset", "replicasets", "rs":
		return resourceInfo{Kind: "ReplicaSet", Resource: "replicasets", Group: "apps", Version: "v1"}
	case "job", "jobs":
		return resourceInfo{Kind: "Job", Resource: "jobs", Group: "batch", Version: "v1"}
	case "cronjob", "cronjobs", "cj":
		return resourceInfo{Kind: "CronJob", Resource: "cronjobs", Group: "batch", Version: "v1"}
	case "ingress", "ingresses", "ing":
		return resourceInfo{Kind: "Ingress", Resource: "ingresses", Group: "networking.k8s.io", Version: "v1"}
	case "networkpolicy", "networkpolicies", "netpol":
		return resourceInfo{Kind: "NetworkPolicy", Resource: "networkpolicies", Group: "networking.k8s.io", Version: "v1"}
	case "storageclass", "storageclasses", "sc":
		return resourceInfo{Kind: "StorageClass", Resource: "storageclasses", Group: "storage.k8s.io", Version: "v1", ClusterScoped: true}
	case "customresourcedefinition", "customresourcedefinitions", "crd", "crds":
		return resourceInfo{Kind: "CustomResourceDefinition", Resource: "customresourcedefinitions", Group: "apiextensions.k8s.io", Version: "v1", ClusterScoped: true}
	case "event", "events":
		return resourceInfo{Kind: "Event", Resource: "events", Version: "v1"}
	default:
		kind = strings.TrimSpace(kind)
		if kind == "" {
			return resourceInfo{Kind: "Unknown", Resource: "unknowns", Version: "v1"}
		}

		kindLower := strings.ToLower(kind)
		resource := kindLower
		if !strings.HasSuffix(resource, "s") {
			resource += "s"
		}
		if strings.HasSuffix(kindLower, "s") {
			kind = strings.TrimSuffix(kind, "s")
		}
		return resourceInfo{Kind: kind, Resource: resource, Version: "v1"}
	}
}

func resolveResourceInfo(ctx context.Context, cs *cluster.ClientSet, kind string) resourceInfo {
	if info, ok := resolveResourceInfoFromDiscovery(ctx, cs, kind, ""); ok {
		return info
	}
	return resolveStaticResourceInfo(kind)
}

func resolveResourceInfoForObject(ctx context.Context, cs *cluster.ClientSet, obj *unstructured.Unstructured) resourceInfo {
	if info, ok := resolveResourceInfoFromDiscovery(ctx, cs, obj.GetKind(), obj.GetAPIVersion()); ok {
		return info
	}
	return resolveStaticResourceInfo(obj.GetKind())
}

func resolveResourceInfoFromDiscovery(ctx context.Context, cs *cluster.ClientSet, kind, apiVersion string) (resourceInfo, bool) {
	input := strings.ToLower(strings.TrimSpace(kind))
	if input == "" || cs == nil || cs.K8sClient == nil || cs.K8sClient.ClientSet == nil {
		return resourceInfo{}, false
	}
	if ctx != nil {
		select {
		case <-ctx.Done():
			return resourceInfo{}, false
		default:
		}
	}
	discoveryClient := cs.K8sClient.ClientSet.Discovery()

	if gv, ok := parseGroupVersion(apiVersion); ok {
		resourceList, err := discoveryClient.ServerResourcesForGroupVersion(gv.String())
		if err != nil {
			klog.V(2).Infof("AI tool discovery failed for %s: %v", gv.String(), err)
		} else if info, found := findResourceInfoInList(input, gv, resourceList.APIResources); found {
			return info, true
		}
	}

	resourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && !discovery.IsGroupDiscoveryFailedError(err) {
		klog.V(2).Infof("AI tool preferred discovery failed: %v", err)
		return resourceInfo{}, false
	}

	for _, resourceList := range resourceLists {
		if resourceList == nil {
			continue
		}
		gv, err := schema.ParseGroupVersion(resourceList.GroupVersion)
		if err != nil {
			continue
		}
		if info, found := findResourceInfoInList(input, gv, resourceList.APIResources); found {
			return info, true
		}
	}

	return resourceInfo{}, false
}

func parseGroupVersion(apiVersion string) (schema.GroupVersion, bool) {
	apiVersion = strings.TrimSpace(apiVersion)
	if apiVersion == "" {
		return schema.GroupVersion{}, false
	}
	gv, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return schema.GroupVersion{}, false
	}
	return gv, true
}

func findResourceInfoInList(input string, gv schema.GroupVersion, apiResources []metav1.APIResource) (resourceInfo, bool) {
	group := strings.ToLower(gv.Group)
	for _, apiResource := range apiResources {
		if strings.Contains(apiResource.Name, "/") {
			continue
		}
		if !resourceMatchesInput(input, group, apiResource) {
			continue
		}
		return resourceInfo{
			Kind:          apiResource.Kind,
			Resource:      apiResource.Name,
			Group:         gv.Group,
			Version:       gv.Version,
			ClusterScoped: !apiResource.Namespaced,
		}, true
	}
	return resourceInfo{}, false
}

func resourceMatchesInput(input, group string, apiResource metav1.APIResource) bool {
	candidates := make([]string, 0, 3+len(apiResource.ShortNames))
	if kind := strings.ToLower(strings.TrimSpace(apiResource.Kind)); kind != "" {
		candidates = append(candidates, kind)
	}
	if name := strings.ToLower(strings.TrimSpace(apiResource.Name)); name != "" {
		candidates = append(candidates, name)
	}
	if singular := strings.ToLower(strings.TrimSpace(apiResource.SingularName)); singular != "" {
		candidates = append(candidates, singular)
	}
	for _, shortName := range apiResource.ShortNames {
		if shortName = strings.ToLower(strings.TrimSpace(shortName)); shortName != "" {
			candidates = append(candidates, shortName)
		}
	}

	for _, candidate := range candidates {
		if input == candidate {
			return true
		}
		if !strings.HasSuffix(candidate, "s") && input == candidate+"s" {
			return true
		}
		if group != "" && input == candidate+"."+group {
			return true
		}
		if group != "" && !strings.HasSuffix(candidate, "s") && input == candidate+"s."+group {
			return true
		}
	}
	return false
}

func (r resourceInfo) GVK() schema.GroupVersionKind {
	return schema.GroupVersionKind{Group: r.Group, Version: r.Version, Kind: r.Kind}
}

func (r resourceInfo) ListGVK() schema.GroupVersionKind {
	return schema.GroupVersionKind{Group: r.Group, Version: r.Version, Kind: r.Kind + "List"}
}

func normalizeNamespace(r resourceInfo, namespace string) string {
	if r.ClusterScoped {
		return ""
	}
	return namespace
}

func buildObjectForResource(resource resourceInfo) *unstructured.Unstructured {
	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(resource.GVK())
	return obj
}

func getRequiredString(args map[string]interface{}, key string) (string, error) {
	value, _ := args[key].(string)
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}

func parseResourceYAML(args map[string]interface{}) (*unstructured.Unstructured, error) {
	yamlStr, err := getRequiredString(args, "yaml")
	if err != nil {
		return nil, err
	}

	obj := &unstructured.Unstructured{}
	if err := yaml.Unmarshal([]byte(yamlStr), &obj.Object); err != nil {
		return nil, fmt.Errorf("parsing YAML failed: %w", err)
	}
	if obj.GetKind() == "" || obj.GetName() == "" {
		return nil, fmt.Errorf("yaml must include kind and metadata.name")
	}
	return obj, nil
}

// MutationTools is the set of tools that modify cluster state and require confirmation.
var MutationTools = map[string]bool{
	"create_resource": true,
	"update_resource": true,
	"patch_resource":  true,
	"delete_resource": true,
}

type toolPermission struct {
	Resource  string
	Verb      string
	Namespace string
}

func permissionNamespace(resource resourceInfo, namespace string) string {
	if resource.ClusterScoped {
		return ""
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return "_all"
	}
	return namespace
}

func requiredToolPermissions(ctx context.Context, cs *cluster.ClientSet, toolName string, args map[string]interface{}) ([]toolPermission, error) {
	switch toolName {
	case "get_resource":
		kind, err := getRequiredString(args, "kind")
		if err != nil {
			return nil, err
		}
		namespace, _ := args["namespace"].(string)
		resource := resolveResourceInfo(ctx, cs, kind)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbGet),
			Namespace: permissionNamespace(resource, namespace),
		}}, nil
	case "list_resources":
		kind, err := getRequiredString(args, "kind")
		if err != nil {
			return nil, err
		}
		namespace, _ := args["namespace"].(string)
		resource := resolveResourceInfo(ctx, cs, kind)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbGet),
			Namespace: permissionNamespace(resource, namespace),
		}}, nil
	case "get_pod_logs":
		if _, err := getRequiredString(args, "name"); err != nil {
			return nil, err
		}
		namespace, err := getRequiredString(args, "namespace")
		if err != nil {
			return nil, err
		}
		return []toolPermission{{
			Resource:  "pods",
			Verb:      string(common.VerbLog),
			Namespace: namespace,
		}}, nil
	case "get_cluster_overview":
		return []toolPermission{
			{Resource: "nodes", Verb: string(common.VerbGet), Namespace: ""},
			{Resource: "pods", Verb: string(common.VerbGet), Namespace: "_all"},
			{Resource: "namespaces", Verb: string(common.VerbGet), Namespace: ""},
			{Resource: "services", Verb: string(common.VerbGet), Namespace: "_all"},
		}, nil
	case "create_resource":
		obj, err := parseResourceYAML(args)
		if err != nil {
			return nil, err
		}
		resource := resolveResourceInfoForObject(ctx, cs, obj)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbCreate),
			Namespace: permissionNamespace(resource, obj.GetNamespace()),
		}}, nil
	case "update_resource":
		obj, err := parseResourceYAML(args)
		if err != nil {
			return nil, err
		}
		resource := resolveResourceInfoForObject(ctx, cs, obj)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbUpdate),
			Namespace: permissionNamespace(resource, obj.GetNamespace()),
		}}, nil
	case "patch_resource":
		kind, err := getRequiredString(args, "kind")
		if err != nil {
			return nil, err
		}
		if _, err := getRequiredString(args, "name"); err != nil {
			return nil, err
		}
		namespace, _ := args["namespace"].(string)
		resource := resolveResourceInfo(ctx, cs, kind)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbUpdate),
			Namespace: permissionNamespace(resource, namespace),
		}}, nil
	case "delete_resource":
		kind, err := getRequiredString(args, "kind")
		if err != nil {
			return nil, err
		}
		if _, err := getRequiredString(args, "name"); err != nil {
			return nil, err
		}
		namespace, _ := args["namespace"].(string)
		resource := resolveResourceInfo(ctx, cs, kind)
		return []toolPermission{{
			Resource:  resource.Resource,
			Verb:      string(common.VerbDelete),
			Namespace: permissionNamespace(resource, namespace),
		}}, nil
	case "query_prometheus":
		// Prometheus queries can access metrics from any namespace
		// Require at least read permission on pods in all namespaces
		// This ensures users can only query metrics if they have cluster-wide read access
		return []toolPermission{{
			Resource:  "pods",
			Verb:      string(common.VerbGet),
			Namespace: "_all",
		}}, nil
	default:
		return nil, nil
	}
}

func currentUserFromGin(c *gin.Context) (pkgmodel.User, bool) {
	rawUser, ok := c.Get("user")
	if !ok {
		return pkgmodel.User{}, false
	}
	user, ok := rawUser.(pkgmodel.User)
	return user, ok
}

func AuthorizeTool(c *gin.Context, cs *cluster.ClientSet, toolName string, args map[string]interface{}) (string, bool) {
	if c == nil {
		return "Error: authorization context is required", true
	}
	if cs == nil {
		return "Error: cluster client is required", true
	}
	user, ok := currentUserFromGin(c)
	if !ok {
		return "Error: authenticated user not found in context", true
	}

	permissions, err := requiredToolPermissions(c.Request.Context(), cs, toolName, args)
	if err != nil {
		return "Error: " + err.Error(), true
	}

	for _, permission := range permissions {
		if rbac.CanAccess(user, permission.Resource, permission.Verb, cs.Name, permission.Namespace) {
			continue
		}
		return "Forbidden: " + rbac.NoAccess(user.Key(), permission.Verb, permission.Resource, permission.Namespace, cs.Name), true
	}
	return "", false
}

// ExecuteTool runs a tool and returns the result as a string.
func ExecuteTool(ctx context.Context, c *gin.Context, cs *cluster.ClientSet, toolName string, args map[string]interface{}) (string, bool) {
	if result, isError := AuthorizeTool(c, cs, toolName, args); isError {
		return result, true
	}

	switch toolName {
	case "get_resource":
		return executeGetResource(ctx, cs, args)
	case "list_resources":
		return executeListResources(ctx, cs, args)
	case "get_pod_logs":
		return executeGetPodLogs(ctx, cs, args)
	case "get_cluster_overview":
		return executeGetClusterOverview(ctx, cs)
	case "create_resource":
		return executeCreateResource(ctx, cs, args)
	case "update_resource":
		return executeUpdateResource(ctx, cs, args)
	case "patch_resource":
		return executePatchResource(ctx, cs, args)
	case "delete_resource":
		return executeDeleteResource(ctx, cs, args)
	case "query_prometheus":
		return executeQueryPrometheus(ctx, cs, args)
	default:
		return fmt.Sprintf("Unknown tool: %s", toolName), true
	}
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

func executeCreateResource(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	obj, err := parseResourceYAML(args)
	if err != nil {
		return "Error: " + err.Error(), true
	}

	if err := cs.K8sClient.Create(ctx, obj); err != nil {
		return fmt.Sprintf("Error creating %s/%s: %v", obj.GetKind(), obj.GetName(), err), true
	}

	klog.Infof("AI Agent created resource: %s/%s in namespace %s", obj.GetKind(), obj.GetName(), obj.GetNamespace())
	return fmt.Sprintf("Successfully created %s/%s", obj.GetKind(), obj.GetName()), false
}

func executeUpdateResource(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	obj, err := parseResourceYAML(args)
	if err != nil {
		return "Error: " + err.Error(), true
	}

	if err := cs.K8sClient.Update(ctx, obj); err != nil {
		return fmt.Sprintf("Error updating %s/%s: %v", obj.GetKind(), obj.GetName(), err), true
	}

	klog.Infof("AI Agent updated resource: %s/%s in namespace %s", obj.GetKind(), obj.GetName(), obj.GetNamespace())
	return fmt.Sprintf("Successfully updated %s/%s", obj.GetKind(), obj.GetName()), false
}

func executePatchResource(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
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

	patchBytes := []byte(patchStr)
	patch := client.RawPatch(k8stypes.StrategicMergePatchType, patchBytes)
	if err := cs.K8sClient.Patch(ctx, obj, patch); err != nil {
		return fmt.Sprintf("Error patching %s/%s: %v", resource.Kind, name, err), true
	}

	klog.Infof("AI Agent patched resource: %s/%s in namespace %s", resource.Kind, name, normalizeNamespace(resource, namespace))
	return fmt.Sprintf("Successfully patched %s/%s", resource.Kind, name), false
}

func executeDeleteResource(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
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
		if apierrors.IsNotFound(err) {
			return fmt.Sprintf("%s/%s not found, already deleted", resource.Kind, name), false
		}
		return fmt.Sprintf("Error finding %s/%s: %v", resource.Kind, name, err), true
	}

	if err := cs.K8sClient.Delete(ctx, obj); err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Sprintf("%s/%s not found, already deleted", resource.Kind, name), false
		}
		return fmt.Sprintf("Error deleting %s/%s: %v", resource.Kind, name, err), true
	}

	klog.Infof("AI Agent deleted resource: %s/%s in namespace %s", resource.Kind, name, normalizeNamespace(resource, namespace))
	return fmt.Sprintf("Successfully deleted %s/%s", resource.Kind, name), false
}

func executeQueryPrometheus(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	query, err := getRequiredString(args, "query")
	if err != nil {
		return "Error: " + err.Error(), true
	}

	// Check if Prometheus client is available
	if cs.PromClient == nil {
		return "Error: Prometheus is not configured for this cluster. Please configure Prometheus URL in cluster settings.", true
	}

	queryType, _ := args["query_type"].(string)
	if queryType == "" {
		queryType = "instant"
	}

	duration, _ := args["duration"].(string)
	if duration == "" {
		duration = "1h"
	}

	var result string
	var queryErr error

	switch queryType {
	case "instant":
		result, queryErr = executeInstantQuery(ctx, cs, query)
	case "range":
		result, queryErr = executeRangeQuery(ctx, cs, query, duration)
	default:
		return fmt.Sprintf("Error: unsupported query_type '%s'. Use 'instant' or 'range'.", queryType), true
	}

	if queryErr != nil {
		return fmt.Sprintf("Error executing Prometheus query: %v", queryErr), true
	}

	return result, false
}

func executeInstantQuery(ctx context.Context, cs *cluster.ClientSet, query string) (string, error) {
	result, warnings, err := cs.PromClient.Query(ctx, query, time.Now())
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Prometheus Query: %s\n\n", query))

	if len(warnings) > 0 {
		sb.WriteString(fmt.Sprintf("Warnings: %v\n\n", warnings))
	}

	switch result.Type() {
	case model.ValVector:
		vector := result.(model.Vector)
		if len(vector) == 0 {
			sb.WriteString("No data returned.\n")
		} else {
			sb.WriteString(fmt.Sprintf("Results (%d series):\n", len(vector)))
			for _, sample := range vector {
				sb.WriteString(fmt.Sprintf("- %s: %v\n", sample.Metric, sample.Value))
			}
		}
	case model.ValScalar:
		scalar := result.(*model.Scalar)
		sb.WriteString(fmt.Sprintf("Scalar value: %v at %v\n", scalar.Value, scalar.Timestamp.Time()))
	case model.ValString:
		str := result.(*model.String)
		sb.WriteString(fmt.Sprintf("String value: %s at %v\n", str.Value, str.Timestamp.Time()))
	default:
		sb.WriteString(fmt.Sprintf("Unexpected result type: %s\n", result.Type()))
	}

	return sb.String(), nil
}

func executeRangeQuery(ctx context.Context, cs *cluster.ClientSet, query string, duration string) (string, error) {
	var timeRange time.Duration
	var step time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 1 * time.Minute
	case "1h":
		timeRange = 1 * time.Hour
		step = 2 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 30 * time.Minute
	default:
		return "", fmt.Errorf("unsupported duration: %s. Use '30m', '1h', or '24h'", duration)
	}

	now := time.Now()
	start := now.Add(-timeRange)

	r := v1.Range{
		Start: start,
		End:   now,
		Step:  step,
	}

	result, warnings, err := cs.PromClient.QueryRange(ctx, query, r)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Prometheus Range Query: %s\n", query))
	sb.WriteString(fmt.Sprintf("Time Range: %s to %s (duration: %s, step: %v)\n\n", start.Format("15:04:05"), now.Format("15:04:05"), duration, step))

	if len(warnings) > 0 {
		sb.WriteString(fmt.Sprintf("Warnings: %v\n\n", warnings))
	}

	switch result.Type() {
	case model.ValMatrix:
		matrix := result.(model.Matrix)
		if len(matrix) == 0 {
			sb.WriteString("No data returned.\n")
		} else {
			sb.WriteString(fmt.Sprintf("Results (%d series):\n\n", len(matrix)))
			for seriesIdx, series := range matrix {
				sb.WriteString(fmt.Sprintf("Series %d: %s\n", seriesIdx+1, series.Metric))

				// Show summary statistics
				if len(series.Values) > 0 {
					var sum, min, max float64
					min = float64(series.Values[0].Value)
					max = float64(series.Values[0].Value)

					for _, sample := range series.Values {
						val := float64(sample.Value)
						sum += val
						if val < min {
							min = val
						}
						if val > max {
							max = val
						}
					}
					avg := sum / float64(len(series.Values))

					sb.WriteString(fmt.Sprintf("  Data points: %d\n", len(series.Values)))
					sb.WriteString(fmt.Sprintf("  Min: %.2f, Max: %.2f, Avg: %.2f\n", min, max, avg))

					// Show first and last few values
					showCount := 3
					if len(series.Values) <= showCount*2 {
						showCount = len(series.Values) / 2
					}

					if showCount > 0 {
						sb.WriteString("  First values:\n")
						for i := 0; i < showCount && i < len(series.Values); i++ {
							sample := series.Values[i]
							sb.WriteString(fmt.Sprintf("    %s: %.2f\n", sample.Timestamp.Time().Format("15:04:05"), sample.Value))
						}

						if len(series.Values) > showCount*2 {
							sb.WriteString("  ...\n")
							sb.WriteString("  Last values:\n")
							for i := len(series.Values) - showCount; i < len(series.Values); i++ {
								sample := series.Values[i]
								sb.WriteString(fmt.Sprintf("    %s: %.2f\n", sample.Timestamp.Time().Format("15:04:05"), sample.Value))
							}
						}
					}
				}
				sb.WriteString("\n")
			}
		}
	default:
		sb.WriteString(fmt.Sprintf("Unexpected result type: %s\n", result.Type()))
	}

	return sb.String(), nil
}
