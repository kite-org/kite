package middleware

import (
	"net/http"
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
		ns, resource := url2namespaceresource(c.Request.URL.Path)
		if ns == "" || resource == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid resource URL"})
			return
		}
		if resource == string(common.Namespaces) && verbs == "get" {
			// if user has roles, allow access to list namespaces resource
			// don't worry about security here, we will filter namespaces in the list namespace handler
			// this is just to allow users to list namespaces they have access to
			c.Next()
			return
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
func url2namespaceresource(url string) (namespace string, resource string) {
	// Split the URL into its components
	parts := strings.Split(url, "/")
	if len(parts) < 4 {
		return
	}
	resource = parts[3] // The resource type is always the third part
	if len(parts) > 4 {
		namespace = parts[4]
	} else {
		namespace = common.AllNamespaces // All namespaces
	}
	return
}
