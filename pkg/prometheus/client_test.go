package prometheus

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
)

type fakePromAPI struct {
	queryRangeResponses map[string]model.Value
	queryRangeCalls     []v1.Range
	queryRangeQueries   []string
}

func (f *fakePromAPI) Config(context.Context) (v1.ConfigResult, error) {
	return v1.ConfigResult{}, nil
}

func (f *fakePromAPI) Query(context.Context, string, time.Time, ...v1.Option) (model.Value, v1.Warnings, error) {
	return &model.String{}, nil, nil
}

func (f *fakePromAPI) QueryRange(_ context.Context, query string, r v1.Range, _ ...v1.Option) (model.Value, v1.Warnings, error) {
	f.queryRangeCalls = append(f.queryRangeCalls, r)
	f.queryRangeQueries = append(f.queryRangeQueries, query)
	if value, ok := f.queryRangeResponses[query]; ok {
		return value, nil, nil
	}
	return nil, nil, fmt.Errorf("unexpected query: %s", query)
}

func matrixValue(ts time.Time, value float64) model.Value {
	return model.Matrix{
		&model.SampleStream{
			Values: []model.SamplePair{
				{
					Timestamp: model.TimeFromUnixNano(ts.UnixNano()),
					Value:     model.SampleValue(value),
				},
			},
		},
	}
}

func TestQueryRange(t *testing.T) {
	now := time.Date(2026, 3, 27, 12, 0, 0, 0, time.UTC)
	api := &fakePromAPI{
		queryRangeResponses: map[string]model.Value{
			"query": matrixValue(now, 1.5),
			"bad":   &model.String{Value: "unexpected"},
		},
	}
	client := &Client{client: api}

	got, err := client.queryRange(context.Background(), "query", now.Add(-time.Minute), now, 30*time.Second)
	if err != nil {
		t.Fatalf("queryRange() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("queryRange() len = %d, want 1", len(got))
	}
	if !got[0].Timestamp.Equal(now) {
		t.Fatalf("queryRange() timestamp = %v, want %v", got[0].Timestamp, now)
	}
	if got[0].Value != 1.5 {
		t.Fatalf("queryRange() value = %v, want 1.5", got[0].Value)
	}

	if _, err := client.queryRange(context.Background(), "bad", now.Add(-time.Minute), now, 30*time.Second); err == nil || !strings.Contains(err.Error(), "unexpected result type") {
		t.Fatalf("queryRange() error = %v, want unexpected result type", err)
	}
}

func TestFillMissingDataPoints(t *testing.T) {
	if got := FillMissingDataPoints(time.Now().Add(-time.Minute), time.Second, nil); got != nil {
		t.Fatalf("FillMissingDataPoints() nil = %#v, want nil", got)
	}

	now := time.Now()
	step := time.Minute
	timeRange := 10 * time.Minute
	existing := []UsageDataPoint{
		{
			Timestamp: now.Add(-timeRange + 3*step),
			Value:     42,
		},
	}

	got := FillMissingDataPoints(now.Add(-timeRange), step, existing)
	if len(got) != 3 {
		t.Fatalf("FillMissingDataPoints() len = %d, want 3", len(got))
	}
	if got[0].Value != 0 || got[1].Value != 0 || got[2].Value != 42 {
		t.Fatalf("FillMissingDataPoints() values = %#v, want two zeros then original point", got)
	}
	if !got[2].Timestamp.Equal(existing[0].Timestamp) {
		t.Fatalf("FillMissingDataPoints() last timestamp = %v, want %v", got[2].Timestamp, existing[0].Timestamp)
	}
}

func TestGetResourceUsageHistory(t *testing.T) {
	sampleTime := time.Date(2026, 3, 27, 11, 30, 0, 0, time.UTC)
	api := &fakePromAPI{queryRangeResponses: map[string]model.Value{}}
	client := &Client{client: api}

	cpuQuery := `sum(rate(container_cpu_usage_seconds_total{container!="POD",container!="",node="node-a"}[1m])) / sum(kube_node_status_allocatable{resource="cpu",node="node-a"}) * 100`
	memoryQuery := `sum(container_memory_usage_bytes{container!="POD",container!="",node="node-a"}) / sum(kube_node_status_allocatable{resource="memory",node="node-a"}) * 100`
	networkInQuery := `sum(rate(container_network_receive_bytes_total{node="node-a"}[1m]))`
	networkOutQuery := `sum(rate(container_network_transmit_bytes_total{node="node-a"}[1m]))`
	for _, query := range []string{cpuQuery, memoryQuery, networkInQuery, networkOutQuery} {
		api.queryRangeResponses[query] = matrixValue(sampleTime, 1)
	}

	got, err := client.GetResourceUsageHistory(context.Background(), "node-a", "1h", "node")
	if err != nil {
		t.Fatalf("GetResourceUsageHistory() error = %v", err)
	}
	if len(got.CPU) != 1 || len(got.Memory) != 1 || len(got.NetworkIn) != 1 || len(got.NetworkOut) != 1 {
		t.Fatalf("GetResourceUsageHistory() lengths = %#v", got)
	}
	if len(api.queryRangeCalls) != 4 {
		t.Fatalf("GetResourceUsageHistory() query calls = %d, want 4", len(api.queryRangeCalls))
	}
	if api.queryRangeCalls[0].Step != 2*time.Minute {
		t.Fatalf("GetResourceUsageHistory() step = %v, want 2m", api.queryRangeCalls[0].Step)
	}
	for i := 1; i < len(api.queryRangeCalls); i++ {
		if api.queryRangeCalls[i] != api.queryRangeCalls[0] {
			t.Fatalf("GetResourceUsageHistory() range %d = %#v, want %#v", i, api.queryRangeCalls[i], api.queryRangeCalls[0])
		}
	}
}

func TestGetResourceUsageHistoryUnsupportedDuration(t *testing.T) {
	client := &Client{client: &fakePromAPI{}}

	if _, err := client.GetResourceUsageHistory(context.Background(), "", "bad", "node"); err == nil || !strings.Contains(err.Error(), "unsupported duration") {
		t.Fatalf("GetResourceUsageHistory() error = %v, want unsupported duration", err)
	}
}

func TestGetPodMetrics(t *testing.T) {
	sampleTime := time.Date(2026, 3, 27, 11, 0, 0, 0, time.UTC)
	api := &fakePromAPI{queryRangeResponses: map[string]model.Value{}}
	client := &Client{client: api}

	queries := []string{
		`sum(rate(container_cpu_usage_seconds_total{container!="POD",container!="",pod=~"web.*",container="api",namespace="default"}[1m]))`,
		`sum(container_memory_usage_bytes{container!="POD",container!="",pod=~"web.*",container="api",namespace="default"}) / 1024 / 1024`,
		`sum(rate(container_network_receive_bytes_total{pod=~"web.*",container="api",namespace="default"}[1m]))`,
		`sum(rate(container_network_transmit_bytes_total{pod=~"web.*",container="api",namespace="default"}[1m]))`,
		`sum(rate(container_fs_reads_bytes_total{container!="POD",container!="",pod=~"web.*",container="api",namespace="default"}[1m]))`,
		`sum(rate(container_fs_writes_bytes_total{container!="POD",container!="",pod=~"web.*",container="api",namespace="default"}[1m]))`,
	}
	for _, query := range queries {
		api.queryRangeResponses[query] = matrixValue(sampleTime, 2)
	}

	got, err := client.GetPodMetrics(context.Background(), "default", "web", "api", "30m")
	if err != nil {
		t.Fatalf("GetPodMetrics() error = %v", err)
	}
	if got.Fallback {
		t.Fatalf("GetPodMetrics() fallback = true, want false")
	}
	if len(api.queryRangeCalls) != len(queries) {
		t.Fatalf("GetPodMetrics() query calls = %d, want %d", len(api.queryRangeCalls), len(queries))
	}
	if api.queryRangeCalls[0].Step != 15*time.Second {
		t.Fatalf("GetPodMetrics() step = %v, want 15s", api.queryRangeCalls[0].Step)
	}
	for i, query := range queries {
		if api.queryRangeQueries[i] != query {
			t.Fatalf("GetPodMetrics() query %d = %q, want %q", i, api.queryRangeQueries[i], query)
		}
	}
}

func TestGetPodMetricsUnsupportedDuration(t *testing.T) {
	client := &Client{client: &fakePromAPI{}}

	if _, err := client.GetPodMetrics(context.Background(), "default", "web", "api", "bad"); err == nil || !strings.Contains(err.Error(), "unsupported duration") {
		t.Fatalf("GetPodMetrics() error = %v, want unsupported duration", err)
	}
}
