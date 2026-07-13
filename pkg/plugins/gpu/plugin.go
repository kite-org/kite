// Package gpu is a kite-fork plugin showing per-node GPU occupancy: total
// cards, cards held by containers, and idle cards. It serves a basic
// scheduler view from the Kubernetes API and upgrades to real per-card data
// when a card-level exporter (dcgm-exporter) is reachable via Prometheus.
package gpu

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/plugins"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

type Plugin struct{}

func init() {
	plugins.Register(&Plugin{})
}

func (p *Plugin) Name() string { return "gpu" }

func (p *Plugin) Enabled(ctx context.Context, cs *cluster.ClientSet) (bool, map[string]any) {
	r := detect(ctx, cs)
	return r.enabled, map[string]any{"level": r.level}
}

func (p *Plugin) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/overview", p.GetOverview)
	group.POST("/nodes/:node/reset-device-plugin", p.ResetDevicePlugin)
}

func (p *Plugin) GetOverview(c *gin.Context) {
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccessCluster(user, cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	keys := ResourceKeys()
	overview, err := buildOverview(ctx, cs.K8sClient, keys)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build GPU overview: " + err.Error()})
		return
	}

	if detect(ctx, cs).level == levelDCGM {
		if err := enrichWithCards(ctx, cs, keys, overview); err != nil {
			klog.Warningf("gpu plugin: card-level query failed for cluster %s, serving basic view: %v", cs.Name, err)
		}
	}

	c.JSON(http.StatusOK, overview)
}
