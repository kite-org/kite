package resources

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/client/interceptor"
)

type podAPITestConfig struct {
	user                 model.User
	write                bool
	clusterAObjects      []client.Object
	clusterBObjects      []client.Object
	clusterAInterceptors interceptor.Funcs
	clusterBInterceptors interceptor.Funcs
	clusterAClientSet    *kubernetes.Clientset
	clusterAConfig       *rest.Config
	registerRoutes       func(*gin.RouterGroup)
}

type podAPITestFixture struct {
	router  *gin.Engine
	clients map[string]client.Client
}

type podAPITestClusterProvider map[string]*cluster.ClientSet

func (p podAPITestClusterProvider) GetClientSet(clusterName string) (*cluster.ClientSet, error) {
	if clusterName == "" {
		clusterName = "cluster-a"
	}
	clientSet, ok := p[clusterName]
	if !ok {
		return nil, fmt.Errorf("cluster not found: %s", clusterName)
	}
	return clientSet, nil
}

func setupResourceAPITestDB(t *testing.T, user model.User) {
	t.Helper()

	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sqlite connection: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable sqlite foreign keys: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ResourceHistory{}); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create operator user: %v", err)
	}
	model.DB = db
	t.Cleanup(func() {
		model.DB = oldDB
		_ = sqlDB.Close()
	})
}

func newPodAPITestFixture(t *testing.T, config podAPITestConfig) *podAPITestFixture {
	t.Helper()

	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	if err := metricsv1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}

	if config.user.Username == "" {
		config.user.Username = "operator"
	}
	if config.write {
		setupResourceAPITestDB(t, config.user)
	}

	newClient := func(objects []client.Object, funcs interceptor.Funcs) client.Client {
		return fake.NewClientBuilder().
			WithScheme(scheme).
			WithObjects(objects...).
			WithReturnManagedFields().
			WithInterceptorFuncs(funcs).
			Build()
	}
	clusterAClient := newClient(config.clusterAObjects, config.clusterAInterceptors)
	clusterBClient := newClient(config.clusterBObjects, config.clusterBInterceptors)
	clientSets := podAPITestClusterProvider{
		"cluster-a": {
			Name: "cluster-a",
			K8sClient: &kube.K8sClient{
				Client:        clusterAClient,
				ClientSet:     config.clusterAClientSet,
				Configuration: config.clusterAConfig,
			},
		},
		"cluster-b": {
			Name: "cluster-b",
			K8sClient: &kube.K8sClient{
				Client: clusterBClient,
			},
		},
	}
	oldHandlers := handlers
	t.Cleanup(func() {
		handlers = oldHandlers
	})

	oldGinMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(oldGinMode)
	})
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user", config.user)
	})

	api := router.Group("/api/v1")
	for _, group := range []*gin.RouterGroup{
		api.Group(""),
		api.Group("/_clusters/:cluster"),
	} {
		group.Use(middleware.ClusterMiddleware(clientSets))
		group.Use(middleware.RBACMiddleware())
		if config.registerRoutes != nil {
			config.registerRoutes(group)
		} else {
			RegisterRoutes(group)
		}
	}

	return &podAPITestFixture{
		router: router,
		clients: map[string]client.Client{
			"cluster-a": clusterAClient,
			"cluster-b": clusterBClient,
		},
	}
}

func performPodAPIRequest(t *testing.T, fixture *podAPITestFixture, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	fixture.router.ServeHTTP(response, request)
	return response
}

func decodePodAPIResponse[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()

	var value T
	if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	return value
}

func TestPodRBACAllNamespacesDoesNotJoinPermissionsAcrossRoles(t *testing.T) {
	user := model.User{
		Username: "alice",
		Roles: []common.Role{
			{
				Name:       "pod-reader",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{common.AllNamespaces, "default"},
				Resources:  []string{string(common.Pods)},
				Verbs:      []string{string(common.VerbGet)},
			},
			{
				Name:       "team-a-deployment-reader",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{"team-a"},
				Resources:  []string{string(common.Deployments)},
				Verbs:      []string{string(common.VerbGet)},
			},
		},
	}
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: user,
		clusterAObjects: []client.Object{
			&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p-default", Namespace: "default"}},
			&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p-team", Namespace: "team-a"}},
		},
	})

	response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/_all", "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/pods/_all returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	pods := decodePodAPIResponse[PodListWithMetrics](t, response)
	got := make([]string, len(pods.Items))
	for i, pod := range pods.Items {
		got[i] = pod.Namespace + "/" + pod.Name
	}
	want := []string{"default/p-default"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("GET /api/v1/pods/_all returned pods %v, want %v", got, want)
	}
}

func TestPodWatchRBACDoesNotJoinPermissionsAcrossRoles(t *testing.T) {
	originalConfig := rbac.RBACConfig
	t.Cleanup(func() {
		rbac.RBACConfig = originalConfig
	})

	watchServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/pods" || r.URL.Query().Get("watch") != "true" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintln(w, `{"type":"ADDED","object":{"apiVersion":"v1","kind":"Pod","metadata":{"name":"allowed","namespace":"default"}}}`)
		_, _ = fmt.Fprintln(w, `{"type":"ADDED","object":{"apiVersion":"v1","kind":"Pod","metadata":{"name":"denied","namespace":"team-a"}}}`)
	}))
	t.Cleanup(watchServer.Close)

	clientSet, err := kubernetes.NewForConfig(&rest.Config{Host: watchServer.URL})
	if err != nil {
		t.Fatal(err)
	}
	roles := []common.Role{
		{
			Name:       "pod-default-reader",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbGet)},
		},
		{
			Name:       "deployment-team-reader",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"team-a"},
			Resources:  []string{string(common.Deployments)},
			Verbs:      []string{string(common.VerbGet)},
		},
	}
	rbac.RBACConfig = &common.RolesConfig{
		Roles: roles,
		RoleMapping: []common.RoleMapping{
			{Name: "pod-default-reader", Users: []string{"alice"}},
			{Name: "deployment-team-reader", Users: []string{"alice"}},
		},
	}
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user:              model.User{Username: "alice", Roles: roles},
		clusterAClientSet: clientSet,
	})

	for _, path := range []string{
		"/api/v1/pods/_all/watch",
		"/api/v1/_clusters/cluster-a/pods/_all/watch",
	} {
		t.Run(path, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			if !bytes.Contains(response.Body.Bytes(), []byte(`"name":"allowed"`)) {
				t.Fatalf("GET %s omitted authorized pod; body=%s", path, response.Body.String())
			}
			if bytes.Contains(response.Body.Bytes(), []byte(`"name":"denied"`)) {
				t.Fatalf("GET %s leaked unauthorized pod; body=%s", path, response.Body.String())
			}
		})
	}

	rbac.RBACConfig = &common.RolesConfig{}
	for _, path := range []string{
		"/api/v1/pods/_all/watch",
		"/api/v1/_clusters/cluster-a/pods/_all/watch",
	} {
		t.Run("revoked "+path, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			if bytes.Contains(response.Body.Bytes(), []byte(`"name":"allowed"`)) ||
				bytes.Contains(response.Body.Bytes(), []byte(`"name":"denied"`)) {
				t.Fatalf("GET %s returned pod events after current RBAC revocation; body=%s", path, response.Body.String())
			}
		})
	}
}

func podAPIListUser() model.User {
	return model.User{
		Username: "alice",
		Roles: []common.Role{{
			Name:       "pod-reader",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"*"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbGet)},
		}},
	}
}

func TestPodAPIList(t *testing.T) {
	user := podAPIListUser()

	t.Run("paths isolate namespaces and sort pods", func(t *testing.T) {
		newer := metav1.NewTime(time.Unix(200, 0))
		older := metav1.NewTime(time.Unix(100, 0))
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAObjects: []client.Object{
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "beta", Namespace: "default", CreationTimestamp: newer}},
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
					Name:              "alpha",
					Namespace:         "default",
					CreationTimestamp: newer,
					Annotations: map[string]string{
						common.KubectlAnnotation: "removed",
						"keep":                   "value",
					},
				}},
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "old", Namespace: "default", CreationTimestamp: older}},
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "team", Namespace: "team-a", CreationTimestamp: older}},
			},
			clusterAInterceptors: interceptor.Funcs{
				List: func(ctx context.Context, underlying client.WithWatch, list client.ObjectList, options ...client.ListOption) error {
					if err := underlying.List(ctx, list, options...); err != nil {
						return err
					}
					if pods, ok := list.(*corev1.PodList); ok {
						for i := range pods.Items {
							if pods.Items[i].Name == "alpha" {
								pods.Items[i].ManagedFields = []metav1.ManagedFieldsEntry{{Manager: "kubectl"}}
							}
						}
					}
					return nil
				},
			},
		})

		for _, test := range []struct {
			path string
			want []string
		}{
			{path: "/api/v1/pods", want: []string{"default/alpha", "default/beta", "default/old", "team-a/team"}},
			{path: "/api/v1/pods/default", want: []string{"default/alpha", "default/beta", "default/old"}},
			{path: "/api/v1/pods/_all", want: []string{"default/alpha", "default/beta", "default/old", "team-a/team"}},
		} {
			response := performPodAPIRequest(t, fixture, http.MethodGet, test.path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", test.path, response.Code, http.StatusOK, response.Body.String())
			}
			pods := decodePodAPIResponse[PodListWithMetrics](t, response)
			got := make([]string, len(pods.Items))
			for i, pod := range pods.Items {
				got[i] = pod.Namespace + "/" + pod.Name
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("GET %s returned pods %v, want %v", test.path, got, test.want)
			}
			if test.path == "/api/v1/pods/default" {
				if len(pods.Items[0].ManagedFields) != 0 {
					t.Fatalf("managedFields = %#v, want empty", pods.Items[0].ManagedFields)
				}
				if _, ok := pods.Items[0].Annotations[common.KubectlAnnotation]; ok {
					t.Fatalf("annotations still contain %q", common.KubectlAnnotation)
				}
				if pods.Items[0].Annotations["keep"] != "value" {
					t.Fatalf("annotations = %#v, want keep=value", pods.Items[0].Annotations)
				}
			}
		}
	})

	t.Run("passes list options", func(t *testing.T) {
		var gotOptions client.ListOptions
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAObjects: []client.Object{
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default", Labels: map[string]string{"app": "web"}}},
			},
			clusterAInterceptors: interceptor.Funcs{
				List: func(ctx context.Context, underlying client.WithWatch, list client.ObjectList, options ...client.ListOption) error {
					if _, ok := list.(*corev1.PodList); ok {
						gotOptions = *(&client.ListOptions{}).ApplyOptions(options)
					}
					return underlying.List(ctx, list)
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default?labelSelector=app%3Dweb&fieldSelector=metadata.name%3Dpod-a&limit=2&continue=next-token", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("list with options returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		if gotOptions.Namespace != "default" {
			t.Fatalf("list namespace = %q, want default", gotOptions.Namespace)
		}
		if gotOptions.Limit != 2 {
			t.Fatalf("list limit = %d, want 2", gotOptions.Limit)
		}
		if gotOptions.Continue != "next-token" {
			t.Fatalf("list continue = %q, want next-token", gotOptions.Continue)
		}
		if gotOptions.LabelSelector == nil || gotOptions.LabelSelector.String() != "app=web" {
			t.Fatalf("list label selector = %v, want app=web", gotOptions.LabelSelector)
		}
		if gotOptions.FieldSelector == nil || gotOptions.FieldSelector.String() != "metadata.name=pod-a" {
			t.Fatalf("list field selector = %v, want metadata.name=pod-a", gotOptions.FieldSelector)
		}
	})
}

func TestPodAPIListValidation(t *testing.T) {
	user := podAPIListUser()

	for _, test := range []struct {
		name  string
		query string
	}{
		{name: "invalid limit", query: "limit=nope"},
		{name: "invalid label selector", query: "labelSelector=app%20in%20%28"},
		{name: "invalid field selector", query: "fieldSelector=x"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newPodAPITestFixture(t, podAPITestConfig{user: user})
			response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default?"+test.query, "", nil)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("list returned %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}
}

func TestPodAPIListResponseVariants(t *testing.T) {
	user := podAPIListUser()

	t.Run("reduce trims pod metadata and spec", func(t *testing.T) {
		restartAlways := corev1.ContainerRestartPolicyAlways
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAObjects: []client.Object{&corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name:        "rich",
					Namespace:   "default",
					Labels:      map[string]string{"app": "web"},
					Annotations: map[string]string{"note": "drop"},
				},
				Spec: corev1.PodSpec{
					NodeName: "node-a",
					Volumes:  []corev1.Volume{{Name: "drop"}},
					InitContainers: []corev1.Container{{
						Name: "init", Image: "init:v1", Command: []string{"drop"}, RestartPolicy: &restartAlways,
					}},
					Containers: []corev1.Container{{
						Name: "app", Image: "app:v1", Command: []string{"drop"}, Env: []corev1.EnvVar{{Name: "DROP"}},
					}},
				},
			}},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default?reduce=true", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("reduced list returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		pods := decodePodAPIResponse[PodListWithMetrics](t, response)
		if len(pods.Items) != 1 {
			t.Fatalf("reduced items = %d, want 1", len(pods.Items))
		}
		pod := pods.Items[0]
		if pod.Name != "rich" || pod.Namespace != "default" || pod.Labels != nil || pod.Annotations != nil {
			t.Fatalf("reduced metadata = %#v, want only name and namespace", pod.ObjectMeta)
		}
		if pod.Spec.NodeName != "node-a" || len(pod.Spec.Volumes) != 0 {
			t.Fatalf("reduced spec = %#v, want nodeName without volumes", pod.Spec)
		}
		if len(pod.Spec.InitContainers) != 1 || pod.Spec.InitContainers[0].Name != "init" || pod.Spec.InitContainers[0].Image != "init:v1" || len(pod.Spec.InitContainers[0].Command) != 0 {
			t.Fatalf("reduced init containers = %#v", pod.Spec.InitContainers)
		}
		if len(pod.Spec.Containers) != 1 || pod.Spec.Containers[0].Name != "app" || pod.Spec.Containers[0].Image != "app:v1" || len(pod.Spec.Containers[0].Command) != 0 || len(pod.Spec.Containers[0].Env) != 0 {
			t.Fatalf("reduced containers = %#v", pod.Spec.Containers)
		}
	})

	t.Run("merges pod metrics", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAObjects: []client.Object{
				&corev1.Pod{
					ObjectMeta: metav1.ObjectMeta{Name: "measured", Namespace: "default"},
					Spec: corev1.PodSpec{Containers: []corev1.Container{
						{Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m"), corev1.ResourceMemory: resource.MustParse("64Mi")},
							Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m"), corev1.ResourceMemory: resource.MustParse("256Mi")},
						}},
						{Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("50m"), corev1.ResourceMemory: resource.MustParse("32Mi")},
							Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("128Mi")},
						}},
					}},
				},
				&metricsv1.PodMetrics{
					ObjectMeta: metav1.ObjectMeta{Name: "measured", Namespace: "default"},
					Containers: []metricsv1.ContainerMetrics{
						{Usage: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("20m"), corev1.ResourceMemory: resource.MustParse("10Mi")}},
						{Usage: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("30m"), corev1.ResourceMemory: resource.MustParse("20Mi")}},
					},
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("metrics list returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		pods := decodePodAPIResponse[PodListWithMetrics](t, response)
		got := pods.Items[0].Metrics
		want := &PodMetrics{
			CPUUsage: 50, CPURequest: 150, CPULimit: 750,
			MemoryUsage: 30 * 1024 * 1024, MemoryRequest: 96 * 1024 * 1024, MemoryLimit: 384 * 1024 * 1024,
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("metrics = %#v, want %#v", got, want)
		}
	})

	t.Run("metrics list error still returns pods", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:            user,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default"}}},
			clusterAInterceptors: interceptor.Funcs{
				List: func(ctx context.Context, underlying client.WithWatch, list client.ObjectList, options ...client.ListOption) error {
					if _, ok := list.(*metricsv1.PodMetricsList); ok {
						return errors.New("metrics unavailable")
					}
					return underlying.List(ctx, list, options...)
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("list returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		pods := decodePodAPIResponse[PodListWithMetrics](t, response)
		if len(pods.Items) != 1 || pods.Items[0].Metrics != nil {
			t.Fatalf("items = %#v, want one pod with nil metrics", pods.Items)
		}
	})

	t.Run("pod list error returns internal server error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAInterceptors: interceptor.Funcs{
				List: func(_ context.Context, _ client.WithWatch, list client.ObjectList, _ ...client.ListOption) error {
					if _, ok := list.(*corev1.PodList); ok {
						return errors.New("pod list failed")
					}
					return nil
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default", "", nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("list returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})

	t.Run("negative namespace rule filters all namespace result", func(t *testing.T) {
		negativeUser := model.User{
			Username: "alice",
			Roles: []common.Role{{
				Name:       "pod-reader",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{"!kube-system", "*"},
				Resources:  []string{string(common.Pods)},
				Verbs:      []string{string(common.VerbGet)},
			}},
		}
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: negativeUser,
			clusterAObjects: []client.Object{
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "default"}},
				&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "dns", Namespace: "kube-system"}},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/_all", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("list returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		pods := decodePodAPIResponse[PodListWithMetrics](t, response)
		if len(pods.Items) != 1 || pods.Items[0].Namespace != "default" || pods.Items[0].Name != "app" {
			t.Fatalf("items = %#v, want only default/app", pods.Items)
		}
	})
}

func TestPodAPIGet(t *testing.T) {
	user := model.User{
		Username: "alice",
		Roles: []common.Role{{
			Name:       "pod-reader",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbGet)},
		}},
	}

	t.Run("returns a cleaned pod", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name:      "pod-a",
				Namespace: "default",
				Annotations: map[string]string{
					common.KubectlAnnotation: "removed",
					"keep":                   "value",
				},
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Get: func(ctx context.Context, underlying client.WithWatch, key client.ObjectKey, object client.Object, options ...client.GetOption) error {
					if err := underlying.Get(ctx, key, object, options...); err != nil {
						return err
					}
					if pod, ok := object.(*corev1.Pod); ok {
						pod.ManagedFields = []metav1.ManagedFieldsEntry{{Manager: "kubectl"}}
					}
					return nil
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/pod-a", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		pod := decodePodAPIResponse[corev1.Pod](t, response)
		if pod.Name != "pod-a" || pod.Namespace != "default" {
			t.Fatalf("pod = %s/%s, want default/pod-a", pod.Namespace, pod.Name)
		}
		if len(pod.ManagedFields) != 0 {
			t.Fatalf("managedFields = %#v, want empty", pod.ManagedFields)
		}
		if _, ok := pod.Annotations[common.KubectlAnnotation]; ok {
			t.Fatalf("annotations still contain %q", common.KubectlAnnotation)
		}
		if pod.Annotations["keep"] != "value" {
			t.Fatalf("annotations = %#v, want keep=value", pod.Annotations)
		}
	})

	t.Run("not found", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user})
		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/missing", "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusNotFound, response.Body.String())
		}
	})

	t.Run("client error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: user,
			clusterAInterceptors: interceptor.Funcs{
				Get: func(_ context.Context, _ client.WithWatch, _ client.ObjectKey, _ client.Object, _ ...client.GetOption) error {
					return errors.New("get failed")
				},
			},
		})
		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/pod-a", "", nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})
}

func TestPodAPICreate(t *testing.T) {
	user := model.User{
		Username: "operator",
		Roles: []common.Role{{
			Name:       "pod-creator",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbCreate)},
		}},
	}

	t.Run("creates in URL namespace", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		body := `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"created","namespace":"body-ns"},"spec":{"containers":[{"name":"app","image":"app:v1"}]}}`
		response := performPodAPIRequest(t, fixture, http.MethodPost, "/api/v1/pods/default", body, nil)
		if response.Code != http.StatusCreated {
			t.Fatalf("create returned %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
		}
		created := decodePodAPIResponse[corev1.Pod](t, response)
		if created.Name != "created" || created.Namespace != "default" {
			t.Fatalf("created pod = %s/%s, want default/created", created.Namespace, created.Name)
		}
		var stored corev1.Pod
		if err := fixture.clients["cluster-a"].Get(context.Background(), types.NamespacedName{Namespace: "default", Name: "created"}, &stored); err != nil {
			t.Fatalf("get created pod: %v", err)
		}
		if stored.Namespace != "default" || len(stored.Spec.Containers) != 1 || stored.Spec.Containers[0].Image != "app:v1" {
			t.Fatalf("stored pod = %#v", stored)
		}
	})

	t.Run("rejects invalid JSON", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		response := performPodAPIRequest(t, fixture, http.MethodPost, "/api/v1/pods/default", `{`, nil)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("create returned %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	t.Run("client error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAInterceptors: interceptor.Funcs{
				Create: func(_ context.Context, _ client.WithWatch, _ client.Object, _ ...client.CreateOption) error {
					return errors.New("create failed")
				},
			},
		})
		body := `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"failed"}}`
		response := performPodAPIRequest(t, fixture, http.MethodPost, "/api/v1/pods/default", body, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("create returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})
}

func TestPodAPIUpdate(t *testing.T) {
	user := model.User{
		Username: "operator",
		Roles: []common.Role{{
			Name:       "pod-updater",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbUpdate)},
		}},
	}

	t.Run("uses URL name and namespace", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default", ResourceVersion: "1",
			}}},
		})
		body := `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"body-name","namespace":"body-ns","resourceVersion":"1","labels":{"updated":"true"}}}`
		response := performPodAPIRequest(t, fixture, http.MethodPut, "/api/v1/pods/default/target", body, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		updated := decodePodAPIResponse[corev1.Pod](t, response)
		if updated.Name != "target" || updated.Namespace != "default" || updated.Labels["updated"] != "true" {
			t.Fatalf("updated pod = %#v", updated)
		}
		var stored corev1.Pod
		if err := fixture.clients["cluster-a"].Get(context.Background(), types.NamespacedName{Namespace: "default", Name: "target"}, &stored); err != nil {
			t.Fatalf("get updated pod: %v", err)
		}
		if stored.Name != "target" || stored.Namespace != "default" || stored.Labels["updated"] != "true" {
			t.Fatalf("stored pod = %#v", stored)
		}
	})

	t.Run("rejects invalid JSON", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		response := performPodAPIRequest(t, fixture, http.MethodPut, "/api/v1/pods/default/target", `{`, nil)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	t.Run("not found follows current internal error contract", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		body := `{"apiVersion":"v1","kind":"Pod","metadata":{"resourceVersion":"1"}}`
		response := performPodAPIRequest(t, fixture, http.MethodPut, "/api/v1/pods/default/missing", body, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})

	t.Run("client error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default", ResourceVersion: "1",
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Update: func(_ context.Context, _ client.WithWatch, _ client.Object, _ ...client.UpdateOption) error {
					return errors.New("update failed")
				},
			},
		})
		body := `{"apiVersion":"v1","kind":"Pod","metadata":{"resourceVersion":"1"}}`
		response := performPodAPIRequest(t, fixture, http.MethodPut, "/api/v1/pods/default/target", body, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})
}

func TestPodAPIPatch(t *testing.T) {
	user := model.User{
		Username: "operator",
		Roles: []common.Role{{
			Name:       "pod-updater",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbUpdate)},
		}},
	}

	for _, test := range []struct {
		name     string
		query    string
		body     string
		wantType types.PatchType
		wantMode string
	}{
		{
			name:     "strategic merge by default",
			body:     `{"metadata":{"labels":{"mode":"strategic"}}}`,
			wantType: types.StrategicMergePatchType,
			wantMode: "strategic",
		},
		{
			name:     "merge patch",
			query:    "?patchType=merge",
			body:     `{"metadata":{"labels":{"mode":"merge"}}}`,
			wantType: types.MergePatchType,
			wantMode: "merge",
		},
		{
			name:     "JSON patch",
			query:    "?patchType=json",
			body:     `[{"op":"add","path":"/metadata/labels/mode","value":"json"}]`,
			wantType: types.JSONPatchType,
			wantMode: "json",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			var gotType types.PatchType
			fixture := newPodAPITestFixture(t, podAPITestConfig{
				user:  user,
				write: true,
				clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
					Name: "target", Namespace: "default", Labels: map[string]string{"existing": "kept"},
				}}},
				clusterAInterceptors: interceptor.Funcs{
					Patch: func(ctx context.Context, underlying client.WithWatch, object client.Object, patch client.Patch, options ...client.PatchOption) error {
						gotType = patch.Type()
						return underlying.Patch(ctx, object, patch, options...)
					},
				},
			})

			response := performPodAPIRequest(t, fixture, http.MethodPatch, "/api/v1/pods/default/target"+test.query, test.body, nil)
			if response.Code != http.StatusOK {
				t.Fatalf("patch returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
			}
			if gotType != test.wantType {
				t.Fatalf("patch type = %q, want %q", gotType, test.wantType)
			}
			var stored corev1.Pod
			if err := fixture.clients["cluster-a"].Get(context.Background(), types.NamespacedName{Namespace: "default", Name: "target"}, &stored); err != nil {
				t.Fatalf("get patched pod: %v", err)
			}
			if stored.Labels["mode"] != test.wantMode || stored.Labels["existing"] != "kept" {
				t.Fatalf("stored labels = %#v, want mode=%s and existing=kept", stored.Labels, test.wantMode)
			}
		})
	}

	t.Run("not found", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		response := performPodAPIRequest(t, fixture, http.MethodPatch, "/api/v1/pods/default/missing", `{}`, nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("patch returned %d, want %d; body=%s", response.Code, http.StatusNotFound, response.Body.String())
		}
	})

	t.Run("get error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAInterceptors: interceptor.Funcs{
				Get: func(_ context.Context, _ client.WithWatch, _ client.ObjectKey, _ client.Object, _ ...client.GetOption) error {
					return errors.New("get failed")
				},
			},
		})
		response := performPodAPIRequest(t, fixture, http.MethodPatch, "/api/v1/pods/default/target", `{}`, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("patch returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})

	t.Run("patch error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default",
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Patch: func(_ context.Context, _ client.WithWatch, _ client.Object, _ client.Patch, _ ...client.PatchOption) error {
					return errors.New("patch failed")
				},
			},
		})
		response := performPodAPIRequest(t, fixture, http.MethodPatch, "/api/v1/pods/default/target", `{}`, nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("patch returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})
}

func TestPodAPIDelete(t *testing.T) {
	user := model.User{
		Username: "operator",
		Roles: []common.Role{{
			Name:       "pod-deleter",
			Clusters:   []string{"cluster-a"},
			Namespaces: []string{"default"},
			Resources:  []string{string(common.Pods)},
			Verbs:      []string{string(common.VerbDelete)},
		}},
	}

	t.Run("defaults to foreground and waits for deletion", func(t *testing.T) {
		var gotOptions client.DeleteOptions
		getCalls := 0
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default",
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Get: func(ctx context.Context, underlying client.WithWatch, key client.ObjectKey, object client.Object, options ...client.GetOption) error {
					getCalls++
					return underlying.Get(ctx, key, object, options...)
				},
				Delete: func(ctx context.Context, underlying client.WithWatch, object client.Object, options ...client.DeleteOption) error {
					gotOptions = *(&client.DeleteOptions{}).ApplyOptions(options)
					return underlying.Delete(ctx, object, options...)
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodDelete, "/api/v1/pods/default/target", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		if gotOptions.PropagationPolicy == nil || *gotOptions.PropagationPolicy != metav1.DeletePropagationForeground {
			t.Fatalf("propagation policy = %v, want Foreground", gotOptions.PropagationPolicy)
		}
		if getCalls != 2 {
			t.Fatalf("Get calls = %d, want 2 initial and deletion wait checks", getCalls)
		}
		var deleted corev1.Pod
		err := fixture.clients["cluster-a"].Get(context.Background(), types.NamespacedName{Namespace: "default", Name: "target"}, &deleted)
		if !k8serrors.IsNotFound(err) {
			t.Fatalf("get deleted pod error = %v, want not found", err)
		}
	})

	t.Run("supports orphan force without waiting", func(t *testing.T) {
		var gotOptions client.DeleteOptions
		getCalls := 0
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default",
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Get: func(ctx context.Context, underlying client.WithWatch, key client.ObjectKey, object client.Object, options ...client.GetOption) error {
					getCalls++
					return underlying.Get(ctx, key, object, options...)
				},
				Delete: func(ctx context.Context, underlying client.WithWatch, object client.Object, options ...client.DeleteOption) error {
					gotOptions = *(&client.DeleteOptions{}).ApplyOptions(options)
					return underlying.Delete(ctx, object, options...)
				},
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodDelete, "/api/v1/pods/default/target?cascade=false&force=true&wait=false", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		if gotOptions.PropagationPolicy == nil || *gotOptions.PropagationPolicy != metav1.DeletePropagationOrphan {
			t.Fatalf("propagation policy = %v, want Orphan", gotOptions.PropagationPolicy)
		}
		if gotOptions.GracePeriodSeconds == nil || *gotOptions.GracePeriodSeconds != 0 {
			t.Fatalf("grace period = %v, want 0", gotOptions.GracePeriodSeconds)
		}
		if getCalls != 1 {
			t.Fatalf("Get calls = %d, want only the initial lookup", getCalls)
		}
		var deleted corev1.Pod
		err := fixture.clients["cluster-a"].Get(context.Background(), types.NamespacedName{Namespace: "default", Name: "target"}, &deleted)
		if !k8serrors.IsNotFound(err) {
			t.Fatalf("get deleted pod error = %v, want not found", err)
		}
	})

	t.Run("not found", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{user: user, write: true})
		response := performPodAPIRequest(t, fixture, http.MethodDelete, "/api/v1/pods/default/missing?wait=false", "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusNotFound, response.Body.String())
		}
	})

	t.Run("get error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAInterceptors: interceptor.Funcs{
				Get: func(_ context.Context, _ client.WithWatch, _ client.ObjectKey, _ client.Object, _ ...client.GetOption) error {
					return errors.New("get failed")
				},
			},
		})
		response := performPodAPIRequest(t, fixture, http.MethodDelete, "/api/v1/pods/default/target?wait=false", "", nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})

	t.Run("delete error", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user:  user,
			write: true,
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{
				Name: "target", Namespace: "default",
			}}},
			clusterAInterceptors: interceptor.Funcs{
				Delete: func(_ context.Context, _ client.WithWatch, _ client.Object, _ ...client.DeleteOption) error {
					return errors.New("delete failed")
				},
			},
		})
		response := performPodAPIRequest(t, fixture, http.MethodDelete, "/api/v1/pods/default/target?wait=false", "", nil)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusInternalServerError, response.Body.String())
		}
	})
}

func TestPodRBACHTTPVerbs(t *testing.T) {
	allVerbs := []string{
		string(common.VerbGet),
		string(common.VerbCreate),
		string(common.VerbUpdate),
		string(common.VerbDelete),
	}
	for _, test := range []struct {
		name        string
		method      string
		path        string
		body        string
		missingVerb string
	}{
		{name: "GET requires get", method: http.MethodGet, path: "/api/v1/pods/default/target", missingVerb: string(common.VerbGet)},
		{name: "POST requires create", method: http.MethodPost, path: "/api/v1/pods/default", body: `{}`, missingVerb: string(common.VerbCreate)},
		{name: "PUT requires update", method: http.MethodPut, path: "/api/v1/pods/default/target", body: `{}`, missingVerb: string(common.VerbUpdate)},
		{name: "PATCH requires update", method: http.MethodPatch, path: "/api/v1/pods/default/target", body: `{}`, missingVerb: string(common.VerbUpdate)},
		{name: "DELETE requires delete", method: http.MethodDelete, path: "/api/v1/pods/default/target?wait=false", missingVerb: string(common.VerbDelete)},
	} {
		t.Run(test.name, func(t *testing.T) {
			verbs := make([]string, 0, len(allVerbs)-1)
			for _, verb := range allVerbs {
				if verb != test.missingVerb {
					verbs = append(verbs, verb)
				}
			}
			fixture := newPodAPITestFixture(t, podAPITestConfig{
				user: model.User{
					Username: "alice",
					Roles: []common.Role{{
						Name:       "pod-operator",
						Clusters:   []string{"cluster-a"},
						Namespaces: []string{"default"},
						Resources:  []string{string(common.Pods)},
						Verbs:      verbs,
					}},
				},
				clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}},
			})

			response := performPodAPIRequest(t, fixture, test.method, test.path, test.body, nil)
			if response.Code != http.StatusForbidden {
				t.Fatalf("%s %s returned %d, want %d; body=%s", test.method, test.path, response.Code, http.StatusForbidden, response.Body.String())
			}
			body := decodePodAPIResponse[map[string]string](t, response)
			want := fmt.Sprintf("user alice does not have permission to %s pods in namespace default on cluster cluster-a", test.missingVerb)
			if body["error"] != want {
				t.Fatalf("error = %q, want %q", body["error"], want)
			}
		})
	}
}

func TestPodRBACDimensions(t *testing.T) {
	t.Run("same role matches all four dimensions", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: model.User{
				Username: "alice",
				Roles: []common.Role{{
					Name:       "complete",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.Pods)},
					Verbs:      []string{string(common.VerbGet)},
				}},
			},
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}},
		})
		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/target", "", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
	})

	t.Run("does not combine dimensions across roles", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: model.User{
				Username: "alice",
				Roles: []common.Role{
					{
						Name:       "wrong-resource",
						Clusters:   []string{"cluster-a"},
						Namespaces: []string{"default"},
						Resources:  []string{string(common.Deployments)},
						Verbs:      []string{string(common.VerbGet)},
					},
					{
						Name:       "wrong-cluster-and-namespace",
						Clusters:   []string{"cluster-b"},
						Namespaces: []string{"team-a"},
						Resources:  []string{string(common.Pods)},
						Verbs:      []string{string(common.VerbGet)},
					},
				},
			},
			clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}},
		})
		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/target", "", nil)
		if response.Code != http.StatusForbidden {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
	})

	for _, test := range []struct {
		name      string
		path      string
		headers   map[string]string
		role      common.Role
		wantError string
	}{
		{
			name:    "wrong cluster",
			path:    "/api/v1/pods/default/target",
			headers: map[string]string{middleware.ClusterNameHeader: "cluster-b"},
			role: common.Role{
				Clusters: []string{"cluster-a"}, Namespaces: []string{"default"}, Resources: []string{string(common.Pods)}, Verbs: []string{string(common.VerbGet)},
			},
			wantError: "user alice does not have permission to get pods in namespace default on cluster cluster-b",
		},
		{
			name:      "wrong namespace",
			path:      "/api/v1/pods/team-a/target",
			wantError: "user alice does not have permission to get pods in namespace team-a on cluster cluster-a",
			role: common.Role{
				Clusters: []string{"cluster-a"}, Namespaces: []string{"default"}, Resources: []string{string(common.Pods)}, Verbs: []string{string(common.VerbGet)},
			},
		},
		{
			name:      "wrong resource",
			path:      "/api/v1/pods/default/target",
			wantError: "user alice does not have permission to get pods in namespace default on cluster cluster-a",
			role: common.Role{
				Clusters: []string{"cluster-a"}, Namespaces: []string{"default"}, Resources: []string{string(common.Deployments)}, Verbs: []string{string(common.VerbGet)},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.role.Name = test.name
			fixture := newPodAPITestFixture(t, podAPITestConfig{
				user: model.User{Username: "alice", Roles: []common.Role{test.role}},
			})
			response := performPodAPIRequest(t, fixture, http.MethodGet, test.path, "", test.headers)
			if response.Code != http.StatusForbidden {
				t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
			}
			body := decodePodAPIResponse[map[string]string](t, response)
			if body["error"] != test.wantError {
				t.Fatalf("error = %q, want %q", body["error"], test.wantError)
			}
		})
	}

	for _, path := range []string{
		"/api/v1/pods",
		"/api/v1/pods/_all",
		"/api/v1/_clusters/cluster-a/pods",
		"/api/v1/_clusters/cluster-a/pods/_all",
	} {
		t.Run("all namespace entry "+path, func(t *testing.T) {
			fixture := newPodAPITestFixture(t, podAPITestConfig{
				user: model.User{
					Username: "alice",
					Roles: []common.Role{{
						Name:       "default-only",
						Clusters:   []string{"cluster-a"},
						Namespaces: []string{"default"},
						Resources:  []string{string(common.Pods)},
						Verbs:      []string{string(common.VerbGet)},
					}},
				},
				clusterAObjects: []client.Object{
					&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "allowed", Namespace: "default"}},
					&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "denied", Namespace: "team-a"}},
				},
			})
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			pods := decodePodAPIResponse[PodListWithMetrics](t, response)
			if len(pods.Items) != 1 || pods.Items[0].Name != "allowed" || pods.Items[0].Namespace != "default" {
				t.Fatalf("GET %s returned %#v, want only default/allowed", path, pods.Items)
			}
		})
	}
}

func TestPodAPIClusterSelection(t *testing.T) {
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{
			Username: "alice",
			Roles: []common.Role{{
				Name:       "pod-reader",
				Clusters:   []string{"*"},
				Namespaces: []string{"default"},
				Resources:  []string{string(common.Pods)},
				Verbs:      []string{string(common.VerbGet)},
			}},
		},
		clusterAObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "from-a", Namespace: "default"}}},
		clusterBObjects: []client.Object{&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "from-b", Namespace: "default"}}},
	})

	for _, test := range []struct {
		name    string
		path    string
		headers map[string]string
		wantPod string
	}{
		{name: "default cluster", path: "/api/v1/pods/default", wantPod: "from-a"},
		{name: "query selects cluster b", path: "/api/v1/pods/default?x-cluster-name=cluster-b", wantPod: "from-b"},
		{name: "header overrides query", path: "/api/v1/pods/default?x-cluster-name=cluster-a", headers: map[string]string{middleware.ClusterNameHeader: "cluster-b"}, wantPod: "from-b"},
		{name: "path overrides header and query", path: "/api/v1/_clusters/cluster-a/pods/default?x-cluster-name=cluster-b", headers: map[string]string{middleware.ClusterNameHeader: "cluster-b"}, wantPod: "from-a"},
		{name: "explicit cluster path recognizes namespace", path: "/api/v1/_clusters/cluster-b/pods/default", wantPod: "from-b"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, test.path, "", test.headers)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", test.path, response.Code, http.StatusOK, response.Body.String())
			}
			pods := decodePodAPIResponse[PodListWithMetrics](t, response)
			if len(pods.Items) != 1 || pods.Items[0].Name != test.wantPod || pods.Items[0].Namespace != "default" {
				t.Fatalf("GET %s returned %#v, want default/%s", test.path, pods.Items, test.wantPod)
			}
		})
	}

	t.Run("unknown cluster", func(t *testing.T) {
		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default?x-cluster-name=missing", "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("unknown cluster returned %d, want %d; body=%s", response.Code, http.StatusNotFound, response.Body.String())
		}
		body := decodePodAPIResponse[map[string]string](t, response)
		if body["error"] != "cluster not found: missing" {
			t.Fatalf("error = %q, want %q", body["error"], "cluster not found: missing")
		}
	})
}

func TestPodAPIDescribe(t *testing.T) {
	t.Run("production routes are registered", func(t *testing.T) {
		fixture := newPodAPITestFixture(t, podAPITestConfig{})
		defaultRoute := false
		clusterRoute := false
		for _, route := range fixture.router.Routes() {
			if route.Method != http.MethodGet {
				continue
			}
			if route.Path == "/api/v1/pods/:namespace/:name/describe" {
				defaultRoute = true
			}
			if route.Path == "/api/v1/_clusters/:cluster/pods/:namespace/:name/describe" {
				clusterRoute = true
			}
		}
		if !defaultRoute || !clusterRoute {
			t.Fatalf("describe routes registered: default=%t explicitCluster=%t", defaultRoute, clusterRoute)
		}
	})

	t.Run("default and explicit cluster prefixes", func(t *testing.T) {
		calls := 0
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: model.User{
				Username: "alice",
				Roles: []common.Role{{
					Name:       "pod-reader",
					Clusters:   []string{"*"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.Pods)},
					Verbs:      []string{string(common.VerbGet)},
				}},
			},
			registerRoutes: func(group *gin.RouterGroup) {
				group.GET("/pods/:namespace/:name/describe", func(c *gin.Context) {
					calls++
					c.JSON(http.StatusOK, gin.H{"result": "fixed pod description"})
				})
			},
		})

		for _, path := range []string{
			"/api/v1/pods/default/pod-a/describe",
			"/api/v1/_clusters/cluster-b/pods/default/pod-b/describe",
		} {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			body := decodePodAPIResponse[map[string]string](t, response)
			if body["result"] != "fixed pod description" {
				t.Fatalf("result = %q, want fixed pod description", body["result"])
			}
		}
		if calls != 2 {
			t.Fatalf("describe handler calls = %d, want 2", calls)
		}
	})

	t.Run("permission denied before handler", func(t *testing.T) {
		calls := 0
		fixture := newPodAPITestFixture(t, podAPITestConfig{
			user: model.User{
				Username: "alice",
				Roles: []common.Role{{
					Name:       "pod-creator",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.Pods)},
					Verbs:      []string{string(common.VerbCreate)},
				}},
			},
			registerRoutes: func(group *gin.RouterGroup) {
				group.GET("/pods/:namespace/:name/describe", func(c *gin.Context) {
					calls++
					c.JSON(http.StatusOK, gin.H{"result": "fixed pod description"})
				})
			},
		})

		response := performPodAPIRequest(t, fixture, http.MethodGet, "/api/v1/pods/default/pod-a/describe", "", nil)
		if response.Code != http.StatusForbidden {
			t.Fatalf("describe returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
		if calls != 0 {
			t.Fatalf("describe handler calls = %d, want 0", calls)
		}
	})
}
