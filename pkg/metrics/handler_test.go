package metrics

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/prometheus"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func TestMergeUsageDataPointsSum(t *testing.T) {
	base := time.Date(2026, 3, 27, 10, 0, 0, 0, time.UTC)
	points := []prometheus.UsageDataPoint{
		{Timestamp: base.Add(200 * time.Millisecond), Value: 0.3},
		{Timestamp: base.Add(1 * time.Second), Value: 0.4},
		{Timestamp: base, Value: 0.2},
	}

	got := mergeUsageDataPointsSum(points)

	if len(got) != 2 {
		t.Fatalf("mergeUsageDataPointsSum() len = %d, want 2", len(got))
	}
	if got[0].Timestamp.Unix() != base.Unix() {
		t.Fatalf("first timestamp = %d, want %d", got[0].Timestamp.Unix(), base.Unix())
	}
	if got[0].Value != 0.5 {
		t.Fatalf("first value = %v, want 0.5", got[0].Value)
	}
	if got[1].Timestamp.Unix() != base.Add(1*time.Second).Unix() {
		t.Fatalf("second timestamp = %d, want %d", got[1].Timestamp.Unix(), base.Add(1*time.Second).Unix())
	}
	if got[1].Value != 0.4 {
		t.Fatalf("second value = %v, want 0.4", got[1].Value)
	}
}

func TestGetPodMetricsRBAC(t *testing.T) {
	originalGinMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(originalGinMode)
	})

	var calls atomic.Int32
	metricsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{
			"kind":"PodMetrics",
			"apiVersion":"metrics.k8s.io/v1beta1",
			"metadata":{"name":"web","namespace":"default"},
			"timestamp":"2026-07-17T00:00:00Z",
			"window":"30s",
			"containers":[{"name":"app","usage":{"cpu":"100m","memory":"64Mi"}}]
		}`)
	}))
	t.Cleanup(metricsServer.Close)

	metricsClient, err := metricsclient.NewForConfig(&rest.Config{Host: metricsServer.URL})
	if err != nil {
		t.Fatalf("create metrics client: %v", err)
	}
	clientSet := &cluster.ClientSet{
		Name: "prod",
		K8sClient: &kube.K8sClient{
			MetricsClient: metricsClient,
		},
	}

	tests := []struct {
		name       string
		roles      []common.Role
		wantStatus int
		wantCalls  int32
	}{
		{
			name: "allows matching pod read permission",
			roles: []common.Role{{
				Name:       "pod-reader",
				Clusters:   []string{"prod"},
				Namespaces: []string{"default"},
				Resources:  []string{"pods"},
				Verbs:      []string{"get"},
			}},
			wantStatus: http.StatusOK,
			wantCalls:  1,
		},
		{
			name: "denies a different namespace",
			roles: []common.Role{{
				Name:       "team-reader",
				Clusters:   []string{"prod"},
				Namespaces: []string{"team-a"},
				Resources:  []string{"pods"},
				Verbs:      []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name: "does not combine dimensions across roles",
			roles: []common.Role{
				{
					Name:       "prod-deployment-reader",
					Clusters:   []string{"prod"},
					Namespaces: []string{"default"},
					Resources:  []string{"deployments"},
					Verbs:      []string{"get"},
				},
				{
					Name:       "staging-pod-reader",
					Clusters:   []string{"staging"},
					Namespaces: []string{"default"},
					Resources:  []string{"pods"},
					Verbs:      []string{"get"},
				},
			},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls.Store(0)
			handler := &Handler{metricsServerCache: make(map[string][]prometheus.UsageDataPoint)}
			router := gin.New()
			router.GET("/prometheus/pods/:namespace/:podName/metrics", func(c *gin.Context) {
				c.Set("cluster", clientSet)
				c.Set("user", model.User{Username: "alice", Roles: tt.roles})
				handler.GetPodMetrics(c)
			})

			request := httptest.NewRequest(http.MethodGet, "/prometheus/pods/default/web/metrics?duration=30m", nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, tt.wantStatus, response.Body.String())
			}
			if got := calls.Load(); got != tt.wantCalls {
				t.Fatalf("metrics API calls = %d, want %d", got, tt.wantCalls)
			}
		})
	}
}
