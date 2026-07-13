// Package plugins provides a lightweight runtime extension point for kite
// forks. Plugins live under pkg/plugins/<name>, register themselves via
// Register from an init function, and are collected by pkg/plugins/all so
// that routes.go only needs a single hook line.
package plugins

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

type Plugin interface {
	Name() string
	// Enabled reports whether the plugin is usable for the given cluster.
	// extra is returned verbatim in the /plugins response.
	Enabled(ctx context.Context, cs *cluster.ClientSet) (bool, map[string]any)
	// RegisterRoutes mounts the plugin's routes under /api/v1/plugins/<name>.
	// Plugin routes are registered before the resource RBAC middleware, so
	// handlers must enforce access control themselves (e.g.
	// rbac.CanAccessCluster), same as the overview/metrics endpoints.
	RegisterRoutes(group *gin.RouterGroup)
}

// registry is only mutated from init functions, before RegisterRoutes runs.
var registry []Plugin

func Register(p Plugin) {
	registry = append(registry, p)
}

type PluginStatus struct {
	Name    string         `json:"name"`
	Enabled bool           `json:"enabled"`
	Extra   map[string]any `json:"extra,omitempty"`
}

func RegisterRoutes(api *gin.RouterGroup) {
	api.GET("/plugins", listPlugins)
	for _, p := range registry {
		p.RegisterRoutes(api.Group("/plugins/" + p.Name()))
	}
}

func listPlugins(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccessCluster(user, cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	statuses := make([]PluginStatus, 0, len(registry))
	for _, p := range registry {
		enabled, extra := p.Enabled(c.Request.Context(), cs)
		statuses = append(statuses, PluginStatus{Name: p.Name(), Enabled: enabled, Extra: extra})
	}
	c.JSON(http.StatusOK, gin.H{"plugins": statuses})
}
