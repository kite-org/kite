package resources

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func ResolveResource(c *gin.Context) {
	var params struct {
		APIVersion string `form:"apiVersion" binding:"required"`
		Kind       string `form:"kind" binding:"required"`
		Namespace  string `form:"namespace"`
	}
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	gv, err := schema.ParseGroupVersion(params.APIVersion)
	if err != nil || gv.Version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "apiVersion must contain a version"})
		return
	}
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	mapping, err := cs.K8sClient.RESTMapper().RESTMapping(gv.WithKind(params.Kind).GroupKind())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	namespace := params.Namespace
	scope := "Namespaced"
	if mapping.Scope.Name() == meta.RESTScopeNameRoot {
		namespace = common.AllNamespaces
		scope = "Cluster"
	} else if !common.IsSafePathSegment(namespace) || namespace == common.AllNamespaces {
		c.JSON(http.StatusBadRequest, gin.H{"error": "valid namespace is required for namespaced resources"})
		return
	}
	resource := common.HistoryResourceType(mapping.Resource.Resource, mapping.Resource.Group)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccess(user, resource, string(common.VerbGet), cs.Name, namespace) {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), string(common.VerbGet), resource, namespace, cs.Name)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"resource": mapping.Resource.Resource,
		"group":    mapping.Resource.Group,
		"scope":    scope,
	})
}
