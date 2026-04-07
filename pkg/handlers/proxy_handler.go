package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

type ProxyHandler struct{}

func NewProxyHandler() *ProxyHandler {
	return &ProxyHandler{}
}

func (h *ProxyHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/namespaces/:namespace/:kind/:name/proxy/*path", h.HandleProxy)
}

func (h *ProxyHandler) HandleProxy(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	kind := c.Param("kind")
	if kind != string(common.Pods) && kind != string(common.Services) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid kind, must be 'pods' or 'services'"})
		return
	}
	name := c.Param("name")
	namespace := c.Param("namespace")
	if !rbac.CanAccess(user, kind, "get", cs.Name, namespace) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	kube.HandleProxy(c, cs.K8sClient, kind, namespace, name, c.Param("path"))
}
