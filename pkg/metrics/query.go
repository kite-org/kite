package metrics

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	prommodel "github.com/prometheus/common/model"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

func (h *Handler) QueryPrometheus(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	// Arbitrary PromQL can read across namespaces, so require a cluster-wide grant.
	if !rbac.CanAccessAllNamespaces(user, "prometheus", string(common.VerbGet), cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": rbac.NoAccess(user.Key(), "get", "prometheus", common.AllNamespaces, cs.Name)})
		return
	}
	if cs.PromClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus client not available"})
		return
	}
	var params struct {
		Query string `form:"query" binding:"required"`
		Time  *int64 `form:"time" binding:"omitempty,gte=0"`
		Start *int64 `form:"start" binding:"omitempty,gte=0"`
		End   *int64 `form:"end" binding:"omitempty,gte=0"`
		Step  int64  `form:"step" binding:"gte=0,lte=86400"`
	}
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	var result prommodel.Value
	var warnings v1.Warnings
	var err error
	if strings.HasSuffix(c.FullPath(), "/query_range") {
		if params.Start == nil || params.End == nil || params.Step == 0 || *params.End < *params.Start {
			c.JSON(http.StatusBadRequest, gin.H{"error": "start, end and a positive step in seconds are required; end must not precede start"})
			return
		}
		if (*params.End-*params.Start)/params.Step > 11000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Query exceeds 11000 intervals per series; increase step"})
			return
		}
		result, warnings, err = cs.PromClient.QueryRange(ctx, params.Query, v1.Range{
			Start: time.Unix(*params.Start, 0),
			End:   time.Unix(*params.End, 0),
			Step:  time.Duration(params.Step) * time.Second,
		})
	} else {
		timestamp := time.Now()
		if params.Time != nil {
			timestamp = time.Unix(*params.Time, 0)
		}
		result, warnings, err = cs.PromClient.Query(ctx, params.Query, timestamp)
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"resultType": result.Type().String(), "result": result, "warnings": warnings})
}
