package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/utils"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"sigs.k8s.io/controller-runtime/pkg/client"
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

func GetOverview(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if len(user.Roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
	}

	// Get nodes
	nodes := &v1.NodeList{}
	if err := cs.K8sClient.List(ctx, nodes, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	readyNodes := 0
	var cpuAllocatable, memAllocatable resource.Quantity
	var cpuRequested, memRequested resource.Quantity
	var cpuLimited, memLimited resource.Quantity
	for _, node := range nodes.Items {
		cpuAllocatable.Add(*node.Status.Allocatable.Cpu())
		memAllocatable.Add(*node.Status.Allocatable.Memory())
		for _, condition := range node.Status.Conditions {
			if condition.Type == v1.NodeReady && condition.Status == v1.ConditionTrue {
				readyNodes++
				break
			}
		}
	}

	// Get pods
	pods := &v1.PodList{}
	if err := cs.K8sClient.List(ctx, pods, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	runningPods := 0
	for _, pod := range pods.Items {
		for _, container := range pod.Spec.Containers {
			cpuRequested.Add(*container.Resources.Requests.Cpu())
			memRequested.Add(*container.Resources.Requests.Memory())

			if container.Resources.Limits != nil {
				if cpuLimit := container.Resources.Limits.Cpu(); cpuLimit != nil {
					cpuLimited.Add(*cpuLimit)
				}
				if memLimit := container.Resources.Limits.Memory(); memLimit != nil {
					memLimited.Add(*memLimit)
				}
			}
		}
		if utils.IsPodReady(&pod) || pod.Status.Phase == v1.PodSucceeded {
			runningPods++
		}
	}

	// Get namespaces
	namespaces := &v1.NamespaceList{}
	if err := cs.K8sClient.List(ctx, namespaces, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get services
	services := &v1.ServiceList{}
	if err := cs.K8sClient.List(ctx, services, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	overview := OverviewData{
		TotalNodes:      len(nodes.Items),
		ReadyNodes:      readyNodes,
		TotalPods:       len(pods.Items),
		RunningPods:     runningPods,
		TotalNamespaces: len(namespaces.Items),
		TotalServices:   len(services.Items),
		PromEnabled:     cs.PromClient != nil,
		Resource: common.ResourceMetric{
			CPU: common.Resource{
				Allocatable: cpuAllocatable.MilliValue(),
				Requested:   cpuRequested.MilliValue(),
				Limited:     cpuLimited.MilliValue(),
			},
			Mem: common.Resource{
				Allocatable: memAllocatable.MilliValue(),
				Requested:   memRequested.MilliValue(),
				Limited:     memLimited.MilliValue(),
			},
		},
	}

	c.JSON(http.StatusOK, overview)
}

// var (
// 	initialized bool
// )

func InitCheck(c *gin.Context) {
	// if initialized {
	// 	c.JSON(http.StatusOK, gin.H{"initialized": true})
	// 	return
	// }
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
