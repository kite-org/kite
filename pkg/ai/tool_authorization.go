package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	pkgmodel "github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

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

	user, _ := currentUserFromGin(c)

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
		return executeCreateResource(ctx, cs, user, args)
	case "update_resource":
		return executeUpdateResource(ctx, cs, user, args)
	case "patch_resource":
		return executePatchResource(ctx, cs, user, args)
	case "delete_resource":
		return executeDeleteResource(ctx, cs, user, args)
	case "query_prometheus":
		return executeQueryPrometheus(ctx, cs, args)
	default:
		return fmt.Sprintf("Unknown tool: %s", toolName), true
	}
}
