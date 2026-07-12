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
		ns, resource := url2namespaceresource(c.Request.URL.EscapedPath())
		if ns == "" || resource == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid resource URL"})
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
