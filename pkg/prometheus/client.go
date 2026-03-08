package prometheus

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/api"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
	"k8s.io/klog/v2"
)

type Client struct {
	client v1.API
}

type ResourceMetrics struct {
	CPURequest    float64
	CPUTotal      float64
	MemoryRequest float64
	MemoryTotal   float64
}

// UsageDataPoint represents a single time point in usage metrics
type UsageDataPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

// ResourceUsageHistory contains historical usage data for a resource
type ResourceUsageHistory struct {
	CPU        []UsageDataPoint `json:"cpu"`
	Memory     []UsageDataPoint `json:"memory"`
	NetworkIn  []UsageDataPoint `json:"networkIn"`
	NetworkOut []UsageDataPoint `json:"networkOut"`
	DiskRead   []UsageDataPoint `json:"diskRead"`
	DiskWrite  []UsageDataPoint `json:"diskWrite"`
}

// PodMetrics contains metrics for a specific pod
type PodMetrics struct {
	CPU        []UsageDataPoint `json:"cpu"`
	Memory     []UsageDataPoint `json:"memory"`
	NetworkIn  []UsageDataPoint `json:"networkIn"`
	NetworkOut []UsageDataPoint `json:"networkOut"`
	DiskRead   []UsageDataPoint `json:"diskRead"`
	DiskWrite  []UsageDataPoint `json:"diskWrite"`
	Fallback   bool             `json:"fallback"`
}

type PodCurrentMetrics struct {
	PodName   string  `json:"podName"`
	Namespace string  `json:"namespace"`
	CPU       float64 `json:"cpu"`    // CPU cores
	Memory    float64 `json:"memory"` // Memory in MB
}

func NewClientWithRoundTripper(prometheusURL string, rt http.RoundTripper) (*Client, error) {
	if prometheusURL == "" {
		return nil, fmt.Errorf("prometheus URL cannot be empty")
	}
	client, err := api.NewClient(api.Config{
		Address:      prometheusURL,
		RoundTripper: rt,
	})
	if err != nil {
		return nil, fmt.Errorf("error creating prometheus client: %w", err)
	}

	v1api := v1.NewAPI(client)
	return &Client{
		client: v1api,
	}, nil
}

// GetResourceUsageHistory fetches historical usage data for CPU and Memory
func (c *Client) GetResourceUsageHistory(ctx context.Context, instance string, duration string, nodeLabel string) (*ResourceUsageHistory, error) {
	var step time.Duration
	var timeRange time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 1 * time.Minute
	case "1h":
		timeRange = 1 * time.Hour
		step = 2 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 30 * time.Minute
	default:
		return nil, fmt.Errorf("unsupported duration: %s", duration)
	}

	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	cpuConditions := []string{
		`resource="cpu"`,
	}
	memoryConditions := []string{
		`resource="memory"`,
	}
	if instance != "" {
		conditions = append(conditions, fmt.Sprintf(`%s="%s"`, nodeLabel, instance))
		cpuConditions = append(cpuConditions, fmt.Sprintf(`node="%s"`, instance))
		memoryConditions = append(memoryConditions, fmt.Sprintf(`node="%s"`, instance))
	}

	// Query CPU usage percentage - using container CPU usage
	cpuQuery := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[1m])) / sum(kube_node_status_allocatable{%s}) * 100`, strings.Join(conditions, ","), strings.Join(cpuConditions, ","))
	cpuData, err := c.queryRange(ctx, cpuQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying CPU usage: %w", err)
	}

	// Query Memory usage percentage - using container memory usage
	memoryQuery := fmt.Sprintf(`sum(container_memory_usage_bytes{%s}) / sum(kube_node_status_allocatable{%s}) * 100`, strings.Join(conditions, ","), strings.Join(memoryConditions, ","))
	memoryData, err := c.queryRange(ctx, memoryQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Memory usage: %w", err)
	}

	conditions = []string{}
	if instance != "" {
		conditions = append(conditions, fmt.Sprintf(`%s="%s"`, nodeLabel, instance))
	}

	// Query Network incoming bytes rate (bytes per second)
	networkInQuery := fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	networkInData, err := c.queryRange(ctx, networkInQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Network incoming bytes: %w", err)
	}

	// Query Network outgoing bytes rate (bytes per second)
	networkOutQuery := fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	networkOutData, err := c.queryRange(ctx, networkOutQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Network outgoing bytes: %w", err)
	}

	if len(cpuData) == 0 && len(memoryData) == 0 && len(networkInData) == 0 && len(networkOutData) == 0 {
		return nil, fmt.Errorf("metrics-server or kube-state-metrics may not be available or configured correctly")
	}

	return &ResourceUsageHistory{
		CPU:        cpuData,
		Memory:     memoryData,
		NetworkIn:  networkInData,
		NetworkOut: networkOutData,
	}, nil
}

func (c *Client) queryRange(ctx context.Context, query string, start, end time.Time, step time.Duration) ([]UsageDataPoint, error) {
	r := v1.Range{
		Start: start,
		End:   end,
		Step:  step,
	}

	result, warnings, err := c.client.QueryRange(ctx, query, r)
	if err != nil {
		klog.Error("queryRange", "error", err)
		return nil, err
	}
	if len(warnings) > 0 {
		fmt.Printf("Warnings: %v\n", warnings)
	}

	var dataPoints []UsageDataPoint

	switch result.Type() {
	case model.ValMatrix:
		matrix := result.(model.Matrix)
		if len(matrix) > 0 {
			for _, sample := range matrix[0].Values {
				dataPoints = append(dataPoints, UsageDataPoint{
					Timestamp: sample.Timestamp.Time(),
					Value:     float64(sample.Value),
				})
			}
		}
	default:
		return nil, fmt.Errorf("unexpected result type: %s", result.Type())
	}

	return dataPoints, nil
}

// HealthCheck verifies if Prometheus is accessible
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.client.Config(ctx)
	return err
}

// Query executes an instant query against Prometheus
func (c *Client) Query(ctx context.Context, query string, ts time.Time) (model.Value, v1.Warnings, error) {
	return c.client.Query(ctx, query, ts)
}

// QueryRange executes a range query against Prometheus
func (c *Client) QueryRange(ctx context.Context, query string, r v1.Range) (model.Value, v1.Warnings, error) {
	return c.client.QueryRange(ctx, query, r)
}

func (c *Client) GetCPUUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	// Build query conditionally based on whether pod name prefix and container are provided
	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetMemoryUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	// Build query conditionally based on whether pod name prefix and container are provided
	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(container_memory_usage_bytes{%s}) / 1024 / 1024`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetNetworkInUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetNetworkOutUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetDiskReadUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_fs_reads_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetDiskWriteUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_fs_writes_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func FillMissingDataPoints(timeRange time.Duration, step time.Duration, existing []UsageDataPoint) []UsageDataPoint {
	if len(existing) == 0 {
		return existing
	}

	startTime := time.Now().Add(-timeRange)
	firstTime := existing[0].Timestamp

	if firstTime.Sub(startTime) <= step {
		return existing
	}

	result := []UsageDataPoint{}
	for t := startTime.Add(step); t.Before(firstTime); t = t.Add(step) {
		result = append(result, UsageDataPoint{
			Timestamp: t,
			Value:     0.0,
		})
	}

	return append(result, existing...)
}

// GetPodMetrics fetches metrics for a specific pod
func (c *Client) GetPodMetrics(ctx context.Context, namespace, podName, container string, duration string) (*PodMetrics, error) {
	var step time.Duration
	var timeRange time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 15 * time.Second
	case "1h":
		timeRange = 1 * time.Hour
		step = 1 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 5 * time.Minute
	default:
		return nil, fmt.Errorf("unsupported duration: %s", duration)
	}

	cpuData, err := c.GetCPUUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod CPU usage: %w", err)
	}
	// Memory usage query for specific pod
	memoryData, err := c.GetMemoryUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Memory usage: %w", err)
	}

	networkInData, err := c.GetNetworkInUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Network incoming usage: %w", err)
	}

	networkOutData, err := c.GetNetworkOutUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Network outgoing usage: %w", err)
	}

	diskReadData, err := c.GetDiskReadUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Disk read usage: %w", err)
	}

	diskWriteData, err := c.GetDiskWriteUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Disk write usage: %w", err)
	}

	return &PodMetrics{
		CPU:        FillMissingDataPoints(timeRange, step, cpuData),
		Memory:     FillMissingDataPoints(timeRange, step, memoryData),
		NetworkIn:  FillMissingDataPoints(timeRange, step, networkInData),
		NetworkOut: FillMissingDataPoints(timeRange, step, networkOutData),
		DiskRead:   FillMissingDataPoints(timeRange, step, diskReadData),
		DiskWrite:  FillMissingDataPoints(timeRange, step, diskWriteData),
		Fallback:   false,
	}, nil
}
