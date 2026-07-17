package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

func RBACMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := c.MustGet("user").(model.User)
		cs := c.MustGet("cluster").(*cluster.ClientSet)

		verbs := method2verb(c.Request.Method)
		path := c.Request.URL.EscapedPath()
		ns, resource := url2namespaceresource(path)
		if ns == "" || resource == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid resource URL"})
			return
		}
		if verbs == string(common.VerbGet) && resource == string(common.Events) &&
			strings.HasSuffix(c.FullPath(), "/events/resources") {
			ns = c.Query("namespace")
			if ns == "" {
				ns = common.AllNamespaces
			}
			targetResource := c.Query("resource")
			targetMeta := common.LookupResource(targetResource)
			if targetMeta != nil && targetMeta.ClusterScoped {
				ns = common.AllNamespaces
			}
			if targetMeta == nil && rbac.HasResourcePermission(user, resource, verbs, cs.Name) {
				c.Next()
				return
			}
			if rbac.CanAccess(user, resource, verbs, cs.Name, ns) {
				c.Next()
				return
			}
			c.AbortWithStatusJSON(http.StatusForbidden,
				gin.H{"error": rbac.NoAccess(user.Key(), verbs, resource, ns, cs.Name)})
			return
		}
		if resource == string(common.Namespaces) && verbs == "get" {
			name := c.Param("name")
			if name == "" && rbac.CanAccessCluster(user, cs.Name) {
				// if user has cluster access, allow access to list namespaces resource
				// don't worry about security here, we will filter namespaces in the list namespace handler
				// this is just to allow users to list namespaces they have access to
				c.Next()
				return
			}
			if name != "" && rbac.CanAccessNamespace(user, cs.Name, name) {
				c.Next()
				return
			}
		}

		// Cross-namespace LIST / WATCH passthrough.
		//
		// When a user selects multiple namespaces the frontend collapses the
		// selection into a single "_all" request (see use-resource-table-state).
		// The same happens for the "All Namespaces" view. The RBAC check below
		// would reject such requests unless one of the user's roles carried an
		// explicit "_all" / "*" namespace grant — which is not the case for
		// namespace-scoped roles, so multi-namespace listing (and the SSE pod
		// watch) returned 403 even though the user was permitted to access each
		// individual namespace.
		//
		// The list handlers and the pod watch handler filter every returned /
		// streamed item, so it is safe to let the request reach the handler as
		// long as:
		//   - it is a genuine LIST or the pods /_all/watch SSE sub-route (any
		//     other sub-route such as /:name, /describe, /history, /logs,
		//     /files, /related still requires an explicit _all/* grant);
		//   - known resources are namespace-scoped; dynamic CR LIST requests
		//     defer the scope check to the CR handler (known cluster-scoped
		//     resources keep requiring an _all/* namespace grant);
		//   - the user holds at least one role granting `verb` on this resource
		//     in this cluster (zero-permission users are still rejected).
		if verbs == "get" && ns == common.AllNamespaces {
			isList := isCrossNamespaceList(path)
			isWatch := resource == string(common.Pods) && isCrossNamespaceWatch(path)
			if meta := common.LookupResource(resource); (isList || isWatch) && (meta == nil || !meta.ClusterScoped) {
				if rbac.HasResourcePermission(user, resource, verbs, cs.Name) {
					c.Next()
					return
				}
			}
		}

		canAccess := rbac.CanAccess(user, resource, verbs, cs.Name, ns)
		if canAccess {
			c.Next()
		} else {
			c.AbortWithStatusJSON(http.StatusForbidden,
				gin.H{"error": rbac.NoAccess(user.Key(), verbs, resource, ns, cs.Name)})
		}
	}
}

func method2verb(method string) string {
	switch method {
	case http.MethodPost:
		return string(common.VerbCreate)
	case http.MethodPut, http.MethodPatch:
		return string(common.VerbUpdate)
	default:
		return strings.ToLower(method)
	}
}

// url2namespaceresource converts a URL path to a resource type.
// For example:
//
// - /api/v1/pods/default/pods => default, pods
// - /api/v1/pvs/_all/some-pv => _all, some-pv
// - /api/v1/pods/default => default, pods
// - /api/v1/pods => "", pods
func url2namespaceresource(path string) (namespace string, resource string) {
	if common.Base != "" {
		path = strings.TrimPrefix(path, common.Base)
	}
	// Split the URL into its components
	parts := strings.Split(path, "/")
	resourceIndex := 3
	if len(parts) > resourceIndex && parts[resourceIndex] == "_clusters" {
		resourceIndex += 2
	}
	if len(parts) <= resourceIndex {
		return
	}
	resource, err := url.PathUnescape(parts[resourceIndex])
	if err != nil {
		return "", ""
	}
	if len(parts) > resourceIndex+1 {
		namespace, err = url.PathUnescape(parts[resourceIndex+1])
		if err != nil {
			return "", ""
		}
	} else {
		namespace = common.AllNamespaces // All namespaces
	}
	return
}

// isCrossNamespaceList reports whether the URL denotes a genuine cross-namespace
// LIST request (i.e. no :name and no sub-route such as /describe, /history,
// /logs, /files, /related). It mirrors the path parsing in
// url2namespaceresource, so callers must first confirm ns == common.AllNamespaces.
//
// Accepted forms (after common.Base is stripped):
//
//	/<group>/<ver>/<res>
//	/<group>/<ver>/<res>/_all
//	/<group>/<ver>/_clusters/<cluster>/<res>
//	/<group>/<ver>/_clusters/<cluster>/<res>/_all
//
// Anything longer is a single-resource GET or a sub-route (other than /watch,
// which is handled by isCrossNamespaceWatch) and is NOT a list.
func isCrossNamespaceList(path string) bool {
	if common.Base != "" {
		path = strings.TrimPrefix(path, common.Base)
	}
	parts := strings.Split(path, "/")
	resourceIndex := 3
	if len(parts) > resourceIndex && parts[resourceIndex] == "_clusters" {
		resourceIndex += 2
	}
	if len(parts) == resourceIndex+1 {
		return true
	}
	return len(parts) == resourceIndex+2 && parts[resourceIndex+1] == common.AllNamespaces
}

// isCrossNamespaceWatch reports whether the URL denotes the cross-namespace
// SSE watch sub-route. Only the pods resource currently registers a watch
// handler (see PodHandler.registerCustomRoutes); callers must restrict the
// passthrough to that resource.
//
// Accepted form (after common.Base is stripped):
//
//	/<group>/<ver>/<res>/_all/watch
//	/<group>/<ver>/_clusters/<cluster>/<res>/_all/watch
//
// IMPORTANT: any watch handler matched by this route MUST filter every streamed
// event through the full rbac.CanAccess check when ns == _all. The middleware
// only checks that the user holds a get permission on the resource; per-object
// filtering is the handler's responsibility (see PodHandler.Watch).
func isCrossNamespaceWatch(path string) bool {
	if common.Base != "" {
		path = strings.TrimPrefix(path, common.Base)
	}
	parts := strings.Split(path, "/")
	resourceIndex := 3
	if len(parts) > resourceIndex && parts[resourceIndex] == "_clusters" {
		resourceIndex += 2
	}
	return len(parts) == resourceIndex+3 &&
		parts[resourceIndex+1] == common.AllNamespaces &&
		parts[resourceIndex+2] == "watch"
}
