package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/zxh326/kite/pkg/cluster"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/klog/v2"
	"sigs.k8s.io/yaml"
)

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
