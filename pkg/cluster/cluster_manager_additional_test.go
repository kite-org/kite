package cluster

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/bytedance/mockey"
	"github.com/zxh326/kite/pkg/model"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/zxh326/kite/pkg/kube"
)

func init() {
	if err := os.Setenv("MOCKEY_CHECK_GCFLAGS", "false"); err != nil {
		panic(err)
	}
}

func TestIsClusterLocalURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{
			name: "cluster local dns name",
			url:  "http://prometheus.monitoring.svc.cluster.local:9090",
			want: true,
		},
		{
			name: "svc host with port",
			url:  "http://prometheus.monitoring.svc:9090",
			want: true,
		},
		{
			name: "external url",
			url:  "https://prometheus.example.com",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isClusterLocalURL(tt.url); got != tt.want {
				t.Fatalf("isClusterLocalURL(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}

func TestCreateK8sProxyTransport(t *testing.T) {
	k8sConfig := &rest.Config{
		Host: "https://apiserver.example.com",
		TLSClientConfig: rest.TLSClientConfig{
			Insecure: true,
		},
	}

	t.Run("uses explicit port", func(t *testing.T) {
		transport, err := createK8sProxyTransport(k8sConfig, "https://prometheus.monitoring.svc.cluster.local:9090")
		if err != nil {
			t.Fatalf("createK8sProxyTransport() error = %v", err)
		}
		if transport.namespace != "monitoring" {
			t.Fatalf("namespace = %q, want %q", transport.namespace, "monitoring")
		}
		if transport.svcName != "prometheus" {
			t.Fatalf("svcName = %q, want %q", transport.svcName, "prometheus")
		}
		if transport.port != "9090" {
			t.Fatalf("port = %q, want %q", transport.port, "9090")
		}
	})

	t.Run("defaults https port", func(t *testing.T) {
		transport, err := createK8sProxyTransport(k8sConfig, "https://prometheus.monitoring.svc.cluster.local")
		if err != nil {
			t.Fatalf("createK8sProxyTransport() error = %v", err)
		}
		if transport.port != "443" {
			t.Fatalf("port = %q, want %q", transport.port, "443")
		}
	})
}

func TestK8sProxyTransportRoundTrip(t *testing.T) {
	var gotMethod string
	var gotScheme string
	var gotHost string
	var gotPath string

	transport := &k8sProxyTransport{
		transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			gotMethod = req.Method
			gotScheme = req.URL.Scheme
			gotHost = req.URL.Host
			gotPath = req.URL.Path
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("ok")),
				Header:     make(http.Header),
			}, nil
		}),
		apiServerURL: "https://apiserver.example.com",
		namespace:    "monitoring",
		svcName:      "prometheus",
		port:         "443",
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/api/v1/query", nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("StatusCode = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if gotMethod != http.MethodGet {
		t.Fatalf("method = %q, want %q", gotMethod, http.MethodGet)
	}
	if gotScheme != "https" {
		t.Fatalf("scheme = %q, want %q", gotScheme, "https")
	}
	if gotHost != "apiserver.example.com" {
		t.Fatalf("host = %q, want %q", gotHost, "apiserver.example.com")
	}
	if gotPath != "/api/v1/namespaces/monitoring/services/prometheus:443/proxy/api/v1/query" {
		t.Fatalf("path = %q, want %q", gotPath, "/api/v1/namespaces/monitoring/services/prometheus:443/proxy/api/v1/query")
	}
}

func TestDiscoveryPrometheusURL(t *testing.T) {
	t.Run("discovers prometheus port 9090", func(t *testing.T) {
		svc := &corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "prometheus",
				Namespace: "monitoring",
				Labels: map[string]string{
					"app.kubernetes.io/name": "prometheus",
				},
			},
			Spec: corev1.ServiceSpec{
				Type: corev1.ServiceTypeClusterIP,
				Ports: []corev1.ServicePort{
					{Port: 9090},
				},
			},
		}

		kc := &kube.K8sClient{
			Client: fake.NewClientBuilder().
				WithScheme(kube.GetScheme()).
				WithObjects(svc).
				Build(),
		}

		got := discoveryPrometheusURL(kc)
		want := "http://prometheus.monitoring.svc.cluster.local:9090"
		if got != want {
			t.Fatalf("discoveryPrometheusURL() = %q, want %q", got, want)
		}
	})

	t.Run("discovers vmsingle port 8428", func(t *testing.T) {
		svc := &corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "vmsingle",
				Namespace: "monitoring",
				Labels: map[string]string{
					"app.kubernetes.io/name": "vmsingle",
				},
			},
			Spec: corev1.ServiceSpec{
				Type: corev1.ServiceTypeClusterIP,
				Ports: []corev1.ServicePort{
					{Port: 8428},
				},
			},
		}

		kc := &kube.K8sClient{
			Client: fake.NewClientBuilder().
				WithScheme(kube.GetScheme()).
				WithObjects(svc).
				Build(),
		}

		got := discoveryPrometheusURL(kc)
		want := "http://vmsingle.monitoring.svc.cluster.local:8428"
		if got != want {
			t.Fatalf("discoveryPrometheusURL() = %q, want %q", got, want)
		}
	})

	t.Run("discovers legacy vmsingle port 8429", func(t *testing.T) {
		svc := &corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "vmsingle",
				Namespace: "monitoring",
				Labels: map[string]string{
					"app.kubernetes.io/name": "vmsingle",
				},
			},
			Spec: corev1.ServiceSpec{
				Type: corev1.ServiceTypeClusterIP,
				Ports: []corev1.ServicePort{
					{Port: 8429},
				},
			},
		}

		kc := &kube.K8sClient{
			Client: fake.NewClientBuilder().
				WithScheme(kube.GetScheme()).
				WithObjects(svc).
				Build(),
		}

		got := discoveryPrometheusURL(kc)
		want := "http://vmsingle.monitoring.svc.cluster.local:8429"
		if got != want {
			t.Fatalf("discoveryPrometheusURL() = %q, want %q", got, want)
		}
	})
}

func TestGetClientSet(t *testing.T) {
	t.Run("returns error when no clusters exist", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{},
			errors:   map[string]string{},
		}

		_, err := cm.GetClientSet("")
		if err == nil || err.Error() != "no clusters available" {
			t.Fatalf("GetClientSet() error = %v, want %q", err, "no clusters available")
		}
	})

	t.Run("returns default cluster when set", func(t *testing.T) {
		expected := &ClientSet{Name: "default"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"default": expected,
				"other":   {Name: "other"},
			},
			errors:         map[string]string{},
			defaultContext: "default",
		}

		got, err := cm.GetClientSet("")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("falls back to first cluster when default context is empty", func(t *testing.T) {
		expected := &ClientSet{Name: "first"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"first": expected,
			},
			errors: map[string]string{},
		}

		got, err := cm.GetClientSet("")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("returns named cluster", func(t *testing.T) {
		expected := &ClientSet{Name: "target"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"target": expected,
			},
			errors: map[string]string{},
		}

		got, err := cm.GetClientSet("target")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("returns error for missing cluster", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"target": {Name: "target"},
			},
			errors: map[string]string{},
		}

		_, err := cm.GetClientSet("missing")
		if err == nil || err.Error() != "cluster not found: missing" {
			t.Fatalf("GetClientSet() error = %v, want %q", err, "cluster not found: missing")
		}
	})
}

func TestBuildClientSet(t *testing.T) {
	t.Run("uses in-cluster constructor", func(t *testing.T) {
		inClusterCalled := false
		inClusterMock := mockey.Mock(createClientSetInCluster).To(func(name, prometheusURL string) (*ClientSet, error) {
			inClusterCalled = true
			if name != "cluster-a" {
				t.Fatalf("name = %q, want %q", name, "cluster-a")
			}
			if prometheusURL != "http://prometheus" {
				t.Fatalf("prometheusURL = %q, want %q", prometheusURL, "http://prometheus")
			}
			return &ClientSet{Name: name}, nil
		}).Build()
		defer inClusterMock.UnPatch()

		fromConfigMock := mockey.Mock(createClientSetFromConfig).To(func(name, content, prometheusURL string) (*ClientSet, error) {
			t.Fatalf("createClientSetFromConfig() unexpectedly called with name=%q content=%q prometheusURL=%q", name, content, prometheusURL)
			return nil, nil
		}).Build()
		defer fromConfigMock.UnPatch()

		got, err := buildClientSet(&model.Cluster{
			Name:          "cluster-a",
			InCluster:     true,
			PrometheusURL: "http://prometheus",
		})
		if err != nil {
			t.Fatalf("buildClientSet() error = %v", err)
		}
		if !inClusterCalled {
			t.Fatalf("createClientSetInCluster() was not called")
		}
		if got.Name != "cluster-a" {
			t.Fatalf("buildClientSet() = %#v, want cluster name %q", got, "cluster-a")
		}
	})

	t.Run("uses kubeconfig constructor", func(t *testing.T) {
		fromConfigCalled := false
		inClusterMock := mockey.Mock(createClientSetInCluster).To(func(name, prometheusURL string) (*ClientSet, error) {
			t.Fatalf("createClientSetInCluster() unexpectedly called with name=%q prometheusURL=%q", name, prometheusURL)
			return nil, nil
		}).Build()
		defer inClusterMock.UnPatch()

		fromConfigMock := mockey.Mock(createClientSetFromConfig).To(func(name, content, prometheusURL string) (*ClientSet, error) {
			fromConfigCalled = true
			if name != "cluster-b" {
				t.Fatalf("name = %q, want %q", name, "cluster-b")
			}
			if content != "config-data" {
				t.Fatalf("content = %q, want %q", content, "config-data")
			}
			if prometheusURL != "http://prometheus" {
				t.Fatalf("prometheusURL = %q, want %q", prometheusURL, "http://prometheus")
			}
			return &ClientSet{Name: name}, nil
		}).Build()
		defer fromConfigMock.UnPatch()

		got, err := buildClientSet(&model.Cluster{
			Name:          "cluster-b",
			Config:        model.SecretString("config-data"),
			PrometheusURL: "http://prometheus",
		})
		if err != nil {
			t.Fatalf("buildClientSet() error = %v", err)
		}
		if !fromConfigCalled {
			t.Fatalf("createClientSetFromConfig() was not called")
		}
		if got.Name != "cluster-b" {
			t.Fatalf("buildClientSet() = %#v, want cluster name %q", got, "cluster-b")
		}
	})
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
