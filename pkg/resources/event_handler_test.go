package resources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestListResourceEventsRBAC(t *testing.T) {
	oldGinMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldGinMode) })

	var eventCalls atomic.Int32
	eventServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		eventCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(corev1.EventList{
			TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "EventList"},
			Items:    []corev1.Event{{ObjectMeta: metav1.ObjectMeta{Name: "scheduled", Namespace: "default"}}},
		})
	}))
	t.Cleanup(eventServer.Close)

	clientSet, err := kubernetes.NewForConfig(&rest.Config{Host: eventServer.URL})
	if err != nil {
		t.Fatalf("create kubernetes client: %v", err)
	}
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	if err := apiextensionsv1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	clusterWidget := &unstructured.Unstructured{}
	clusterWidget.SetAPIVersion("example.com/v1")
	clusterWidget.SetKind("ClusterWidget")
	clusterWidget.SetName("cluster-target")
	namespacedWidget := &unstructured.Unstructured{}
	namespacedWidget.SetAPIVersion("example.com/v1")
	namespacedWidget.SetKind("Widget")
	namespacedWidget.SetName("namespaced-target")
	namespacedWidget.SetNamespace("default")
	k8sClient := fake.NewClientBuilder().WithScheme(scheme).WithObjects(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default", UID: "pod-uid"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default", UID: "namespace-uid"}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker", UID: "node-uid"}},
		&apiextensionsv1.CustomResourceDefinition{
			ObjectMeta: metav1.ObjectMeta{Name: "clusterwidgets.example.com"},
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Group:    "example.com",
				Names:    apiextensionsv1.CustomResourceDefinitionNames{Plural: "clusterwidgets", Kind: "ClusterWidget"},
				Scope:    apiextensionsv1.ClusterScoped,
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
			},
		},
		&apiextensionsv1.CustomResourceDefinition{
			ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Group:    "example.com",
				Names:    apiextensionsv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
				Scope:    apiextensionsv1.NamespaceScoped,
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
			},
		},
		clusterWidget,
		namespacedWidget,
	).Build()
	cs := &cluster.ClientSet{
		Name: "cluster-a",
		K8sClient: &kube.K8sClient{
			Client:    k8sClient,
			ClientSet: clientSet,
		},
	}

	oldHandlers := handlers
	handlers = map[string]resourceHandler{
		string(common.Pods):       NewGenericResourceHandler[*corev1.Pod, *corev1.PodList](common.Pods),
		string(common.Namespaces): NewGenericResourceHandler[*corev1.Namespace, *corev1.NamespaceList](common.Namespaces),
		string(common.Nodes):      NewGenericResourceHandler[*corev1.Node, *corev1.NodeList](common.Nodes),
	}
	t.Cleanup(func() { handlers = oldHandlers })

	var user model.User
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user", user)
		c.Set("cluster", cs)
	})
	eventHandler := NewEventHandler()
	for _, group := range []*gin.RouterGroup{
		router.Group("/api/v1"),
		router.Group("/api/v1/_clusters/:cluster"),
	} {
		group.Use(middleware.RBACMiddleware())
		group.GET("/events/resources", eventHandler.ListResourceEvents)
	}

	eventsDefault := common.Role{
		Name: "events-default", Clusters: []string{"cluster-a"}, Namespaces: []string{"default"},
		Resources: []string{string(common.Events)}, Verbs: []string{string(common.VerbGet)},
	}
	podsDefault := common.Role{
		Name: "pods-default", Clusters: []string{"cluster-a"}, Namespaces: []string{"default"},
		Resources: []string{string(common.Pods)}, Verbs: []string{string(common.VerbGet)},
	}
	eventsAll := common.Role{
		Name: "events-all", Clusters: []string{"cluster-a"}, Namespaces: []string{common.AllNamespaces},
		Resources: []string{string(common.Events)}, Verbs: []string{string(common.VerbGet)},
	}

	tests := []struct {
		name       string
		path       string
		roles      []common.Role
		wantStatus int
		wantCalls  int32
	}{
		{
			name:       "legacy route allows matching event and target permissions",
			path:       "/api/v1/events/resources?resource=pods&name=target&namespace=default",
			roles:      []common.Role{eventsDefault, podsDefault},
			wantStatus: http.StatusOK,
			wantCalls:  1,
		},
		{
			name:       "explicit cluster route allows matching event and target permissions",
			path:       "/api/v1/_clusters/cluster-a/events/resources?resource=pods&name=target&namespace=default",
			roles:      []common.Role{eventsDefault, podsDefault},
			wantStatus: http.StatusOK,
			wantCalls:  1,
		},
		{
			name: "path namespace cannot authorize another event namespace",
			path: "/api/v1/events/resources?resource=pods&name=target&namespace=default",
			roles: []common.Role{
				{
					Name: "events-resources", Clusters: []string{"cluster-a"}, Namespaces: []string{"resources"},
					Resources: []string{string(common.Events)}, Verbs: []string{string(common.VerbGet)},
				},
				podsDefault,
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "event permission cannot replace target resource permission",
			path:       "/api/v1/events/resources?resource=pods&name=target&namespace=default",
			roles:      []common.Role{eventsDefault},
			wantStatus: http.StatusForbidden,
		},
		{
			name: "namespace target uses namespace visibility",
			path: "/api/v1/events/resources?resource=namespaces&name=default",
			roles: []common.Role{
				{
					Name: "events-all", Clusters: []string{"cluster-a"}, Namespaces: []string{common.AllNamespaces},
					Resources: []string{string(common.Events)}, Verbs: []string{string(common.VerbGet)},
				},
				podsDefault,
			},
			wantStatus: http.StatusOK,
			wantCalls:  1,
		},
		{
			name: "known cluster scoped target cannot forge namespace",
			path: "/api/v1/events/resources?resource=nodes&name=worker&namespace=default",
			roles: []common.Role{
				eventsAll,
				{
					Name: "nodes-default", Clusters: []string{"cluster-a"}, Namespaces: []string{"default"},
					Resources: []string{string(common.Nodes)}, Verbs: []string{string(common.VerbGet)},
				},
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name: "cluster scoped custom target cannot forge namespace",
			path: "/api/v1/events/resources?resource=clusterwidgets.example.com&name=cluster-target&namespace=default",
			roles: []common.Role{
				eventsAll,
				{
					Name: "cluster-widgets-default", Clusters: []string{"cluster-a"}, Namespaces: []string{"default"},
					Resources: []string{"clusterwidgets.example.com"}, Verbs: []string{string(common.VerbGet)},
				},
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name: "namespaced custom target keeps exact namespace",
			path: "/api/v1/events/resources?resource=widgets.example.com&name=namespaced-target&namespace=default",
			roles: []common.Role{
				eventsDefault,
				{
					Name: "widgets-default", Clusters: []string{"cluster-a"}, Namespaces: []string{"default"},
					Resources: []string{"widgets.example.com"}, Verbs: []string{string(common.VerbGet)},
				},
			},
			wantStatus: http.StatusOK,
			wantCalls:  1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			eventCalls.Store(0)
			user = model.User{Username: "alice", Roles: tt.roles}
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			router.ServeHTTP(response, request)
			if response.Code != tt.wantStatus {
				t.Fatalf("GET %s returned %d, want %d; body=%s", tt.path, response.Code, tt.wantStatus, response.Body.String())
			}
			if calls := eventCalls.Load(); calls != tt.wantCalls {
				t.Fatalf("event API calls = %d, want %d", calls, tt.wantCalls)
			}
		})
	}
}
