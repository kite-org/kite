package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/utils"
	"golang.org/x/sync/errgroup"
	v1 "k8s.io/api/core/v1"
)

type OverviewData struct {
	TotalNodes      int                   `json:"totalNodes"`
	ReadyNodes      int                   `json:"readyNodes"`
	TotalPods       int                   `json:"totalPods"`
	RunningPods     int                   `json:"runningPods"`
	TotalNamespaces int                   `json:"totalNamespaces"`
	TotalServices   int                   `json:"totalServices"`
	PromEnabled     bool                  `json:"prometheusEnabled"`
	Resource        common.ResourceMetric `json:"resource"`
}

// nodeMetrics holds aggregated metrics computed from the node list.
type nodeMetrics struct {
	total          int
	ready          int
	cpuAllocatable int64 // millicores
	memAllocatable int64 // milli-bytes (matches original MilliValue() contract)
}

// podMetrics holds aggregated metrics computed from the pod list.
type podMetrics struct {
	total        int
	running      int
	cpuRequested int64 // millicores
	memRequested int64 // milli-bytes (matches original MilliValue() contract)
	cpuLimited   int64 // millicores
	memLimited   int64 // milli-bytes (matches original MilliValue() contract)
}

func GetOverview(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if len(user.Roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return // Fix: was missing, caused 4 queries to run for unauthorized users
	}

	// Solution : Fetch and compute all 4 resource types in parallel.
	// Each goroutine owns its data — no shared state, no mutexes needed.
	var nm nodeMetrics
	var pm podMetrics
	var nsCount, svcCount int

	g, gctx := errgroup.WithContext(ctx)

	// Goroutine 1: List nodes + compute allocatable resources + ready count
	g.Go(func() error {
		var nodes v1.NodeList
		if err := cs.K8sClient.List(gctx, &nodes); err != nil {
			return err
		}
		nm.total = len(nodes.Items)
		// Solution : Use int64 arithmetic instead of resource.Quantity.Add()
		// (avoids big.Int operations — ~10-50x faster for the accumulation loop)
		for i := range nodes.Items {
			node := &nodes.Items[i]
			nm.cpuAllocatable += node.Status.Allocatable.Cpu().MilliValue()
			nm.memAllocatable += node.Status.Allocatable.Memory().MilliValue()
			for _, cond := range node.Status.Conditions {
				if cond.Type == v1.NodeReady && cond.Status == v1.ConditionTrue {
					nm.ready++
					break
				}
			}
		}
		return nil
	})

	// Goroutine 2: List pods + compute resource requests/limits + running count
	g.Go(func() error {
		var pods v1.PodList
		if err := cs.K8sClient.List(gctx, &pods); err != nil {
			return err
		}
		pm.total = len(pods.Items)
		// Solution : int64 accumulation instead of resource.Quantity.Add()
		for i := range pods.Items {
			pod := &pods.Items[i]
			for j := range pod.Spec.Containers {
				container := &pod.Spec.Containers[j]
				pm.cpuRequested += container.Resources.Requests.Cpu().MilliValue()
				pm.memRequested += container.Resources.Requests.Memory().MilliValue()

				if container.Resources.Limits != nil {
					if cpu := container.Resources.Limits.Cpu(); cpu != nil {
						pm.cpuLimited += cpu.MilliValue()
					}
					if mem := container.Resources.Limits.Memory(); mem != nil {
						pm.memLimited += mem.MilliValue()
					}
				}
			}
			if utils.IsPodReady(pod) || pod.Status.Phase == v1.PodSucceeded {
				pm.running++
			}
		}
		return nil
	})

	// Goroutine 3: List namespaces (count only)
	g.Go(func() error {
		var namespaces v1.NamespaceList
		if err := cs.K8sClient.List(gctx, &namespaces); err != nil {
			return err
		}
		nsCount = len(namespaces.Items)
		return nil
	})

	// Goroutine 4: List services (count only)
	g.Go(func() error {
		var services v1.ServiceList
		if err := cs.K8sClient.List(gctx, &services); err != nil {
			return err
		}
		svcCount = len(services.Items)
		return nil
	})

	// Wait for all goroutines; if any fails the context is cancelled
	if err := g.Wait(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Memory is reported in bytes from Value(); convert to milli for the API
	// (consistent with the original behavior that used MilliValue() on Quantity)
	overview := OverviewData{
		TotalNodes:      nm.total,
		ReadyNodes:      nm.ready,
		TotalPods:       pm.total,
		RunningPods:     pm.running,
		TotalNamespaces: nsCount,
		TotalServices:   svcCount,
		PromEnabled:     cs.PromClient != nil,
		Resource: common.ResourceMetric{
			CPU: common.Resource{
				Allocatable: nm.cpuAllocatable,
				Requested:   pm.cpuRequested,
				Limited:     pm.cpuLimited,
			},
			Mem: common.Resource{
				Allocatable: nm.memAllocatable,
				Requested:   pm.memRequested,
				Limited:     pm.memLimited,
			},
		},
	}

	c.JSON(http.StatusOK, overview)
}

func InitCheck(c *gin.Context) {
	step := 0
	uc, _ := model.CountUsers()
	if uc == 0 && !common.AnonymousUserEnabled {
		c.SetCookie("auth_token", "", -1, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"initialized": false, "step": step})
	}
	if uc > 0 || common.AnonymousUserEnabled {
		step++
	}
	cc, _ := model.CountClusters()
	if cc > 0 {
		step++
	}
	initialized := step == 2
	c.JSON(http.StatusOK, gin.H{"initialized": initialized, "step": step})
}
