package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/prometheus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type PromHandler struct {
	metricsServerCache     map[string][]prometheus.UsageDataPoint
	metricsServerCacheLock sync.Mutex
}

var validDurations = map[string]bool{
	"30m": true,
	"1h":  true,
	"24h": true,
}

func NewPromHandler() *PromHandler {
	h := &PromHandler{
		metricsServerCache: make(map[string][]prometheus.UsageDataPoint),
	}
	go func() {
		for {
			time.Sleep(time.Minute)
			h.metricsServerCacheLock.Lock()
			cutoff := time.Now().Add(-30 * time.Minute)
			for key, points := range h.metricsServerCache {
				var filtered []prometheus.UsageDataPoint
				for _, pt := range points {
					if pt.Timestamp.After(cutoff) {
						filtered = append(filtered, pt)
					}
				}
				if len(filtered) > 0 {
					h.metricsServerCache[key] = filtered
				} else {
					delete(h.metricsServerCache, key)
				}
			}
			h.metricsServerCacheLock.Unlock()
		}
	}()

	return h
}

func (h *PromHandler) GetResourceUsageHistory(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	// Get query parameter for time range
	duration := c.DefaultQuery("duration", "1h")

	// Validate duration parameter
	if !validDurations[duration] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid duration. Must be one of: 30m, 1h, 24h"})
		return
	}

	// Get resource usage history if Prometheus is available
	if cs.PromClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus client not available"})
		return
	}

	instance := c.Query("instance")
	resourceUsageHistory, err := cs.PromClient.GetResourceUsageHistory(ctx, instance, duration, "instance")
	if err != nil {
		resourceUsageHistory, err = cs.PromClient.GetResourceUsageHistory(ctx, instance, duration, "node")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get resource usage history: %v", err)})
			return
		}
	}

	c.JSON(http.StatusOK, resourceUsageHistory)
}

// GetPodMetrics handles pod-specific metrics requests
func (h *PromHandler) GetPodMetrics(c *gin.Context) {
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	// Get path parameters
	namespace := c.Param("namespace")
	podName := c.Param("podName")
	if namespace == "" || podName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace and podName are required"})
		return
	}

	// Get query parameters
	duration := c.DefaultQuery("duration", "1h")
	container := c.Query("container") // Optional container name
	labelSelector := c.Query("labelSelector")

	// Validate duration parameter
	if !validDurations[duration] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid duration. Must be one of: 30m, 1h, 24h"})
		return
	}

	// Try Prometheus first
	var podMetrics *prometheus.PodMetrics
	var err error
	if cs.PromClient != nil {
		podMetrics, err = cs.PromClient.GetPodMetrics(ctx, namespace, podName, container, duration)
		if err == nil && podMetrics != nil {
			podMetrics.Fallback = false
			c.JSON(http.StatusOK, podMetrics)
			return
		}
	}

	// Fallback: metrics-server
	podMetrics, err = h.fetchPodMetricsFromMetricsServer(c, namespace, podName, container, labelSelector)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get pod metrics from both Prometheus and metrics-server: %v", err)})
		return
	}
	podMetrics.Fallback = true
	c.JSON(http.StatusOK, podMetrics)
}

func (h *PromHandler) fetchPodMetricsFromMetricsServer(c *gin.Context, namespace, podName, container, labelSelector string) (*prometheus.PodMetrics, error) {
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	if cs.K8sClient.MetricsClient == nil {
		return nil, fmt.Errorf("metrics client not available")
	}
	h.metricsServerCacheLock.Lock()
	defer h.metricsServerCacheLock.Unlock()

	appendPoint := func(cache []prometheus.UsageDataPoint, value float64, ts time.Time) []prometheus.UsageDataPoint {
		for i := len(cache) - 1; i >= 0; i-- {
			if ts.Sub(cache[i].Timestamp) < 15*time.Second {
				cache[i].Value = value
				return cache
			}
		}
		return append(cache, prometheus.UsageDataPoint{Timestamp: ts, Value: value})
	}

	var cpuSeries, memSeries []prometheus.UsageDataPoint
	handlePodMetrics := func(podMetrics *metricsv1beta1.PodMetrics, timestamp time.Time) {
		for _, c := range podMetrics.Containers {
			key := namespace + "/" + podMetrics.Name + "/" + c.Name
			cpuUsage := float64(c.Usage.Cpu().MilliValue()) / 1000.0
			memUsage := float64(c.Usage.Memory().Value()) / 1024.0 / 1024.0
			cpuCacheKey := key + "/cpu"
			memCacheKey := key + "/mem"
			h.metricsServerCache[cpuCacheKey] = appendPoint(h.metricsServerCache[cpuCacheKey], cpuUsage, timestamp)
			h.metricsServerCache[memCacheKey] = appendPoint(h.metricsServerCache[memCacheKey], memUsage, timestamp)
			if container == "" || c.Name == container {
				cpuSeries = append(cpuSeries, h.metricsServerCache[cpuCacheKey]...)
				memSeries = append(memSeries, h.metricsServerCache[memCacheKey]...)
			}
		}
	}

	if labelSelector != "" {
		listOpts := metav1.ListOptions{LabelSelector: labelSelector}
		podMetricsList, err := cs.K8sClient.MetricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, listOpts)
		if err != nil {
			return nil, err
		}
		if len(podMetricsList.Items) == 0 {
			return nil, fmt.Errorf("no pod metrics found")
		}
		timestamp := time.Now()
		for _, podMetrics := range podMetricsList.Items {
			handlePodMetrics(&podMetrics, timestamp)
		}
		return &prometheus.PodMetrics{
			CPU:      mergeUsageDataPointsSum(cpuSeries),
			Memory:   mergeUsageDataPointsSum(memSeries),
			Fallback: true,
		}, nil
	}

	// single pod
	podMetrics, err := cs.K8sClient.MetricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	handlePodMetrics(podMetrics, podMetrics.Timestamp.Time)
	return &prometheus.PodMetrics{
		CPU:      cpuSeries,
		Memory:   memSeries,
		Fallback: true,
	}, nil
}

func mergeUsageDataPointsSum(points []prometheus.UsageDataPoint) []prometheus.UsageDataPoint {
	m := make(map[int64]float64)
	for _, pt := range points {
		ts := pt.Timestamp.Unix()
		m[ts] += pt.Value
	}
	var merged []prometheus.UsageDataPoint
	for ts, value := range m {
		merged = append(merged, prometheus.UsageDataPoint{
			Timestamp: time.Unix(ts, 0),
			Value:     value,
		})
	}
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Timestamp.Before(merged[j].Timestamp)
	})
	return merged
}
