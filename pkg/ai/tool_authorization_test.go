package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func TestPermissionNamespace(t *testing.T) {
	tests := []struct {
		name      string
		resource  resourceInfo
		namespace string
		want      string
	}{
		{
			name:      "cluster scoped ignores namespace",
			resource:  resourceInfo{ClusterScoped: true},
			namespace: "default",
			want:      "",
		},
		{
			name:      "namespaced empty becomes all",
			resource:  resourceInfo{},
			namespace: " ",
			want:      "_all",
		},
		{
			name:      "namespaced passes through",
			resource:  resourceInfo{},
			namespace: " default ",
			want:      "default",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := permissionNamespace(tc.resource, tc.namespace); got != tc.want {
				t.Fatalf("unexpected namespace: want %q, got %q", tc.want, got)
			}
		})
	}
}

func TestRequiredToolPermissions(t *testing.T) {
	tests := []struct {
		name     string
		toolName string
		args     map[string]interface{}
		want     []toolPermission
	}{
		{
			name:     "get resource",
			toolName: "get_resource",
			args: map[string]interface{}{
				"kind":      "pods",
				"namespace": "default",
			},
			want: []toolPermission{{Resource: "pods", Verb: "get", Namespace: "default"}},
		},
		{
			name:     "list resources across namespaces",
			toolName: "list_resources",
			args: map[string]interface{}{
				"kind": "Deployment",
			},
			want: []toolPermission{{Resource: "deployments", Verb: "get", Namespace: "_all"}},
		},
		{
			name:     "get pod logs",
			toolName: "get_pod_logs",
			args: map[string]interface{}{
				"name":      "nginx",
				"namespace": "default",
			},
			want: []toolPermission{{Resource: "pods", Verb: "log", Namespace: "default"}},
		},
		{
			name:     "cluster overview",
			toolName: "get_cluster_overview",
			args:     map[string]interface{}{},
			want: []toolPermission{
				{Resource: "nodes", Verb: "get", Namespace: ""},
				{Resource: "pods", Verb: "get", Namespace: "_all"},
				{Resource: "namespaces", Verb: "get", Namespace: ""},
				{Resource: "services", Verb: "get", Namespace: "_all"},
			},
		},
		{
			name:     "create namespaced resource",
			toolName: "create_resource",
			args: map[string]interface{}{
				"yaml": "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: default\n",
			},
			want: []toolPermission{{Resource: "configmaps", Verb: "create", Namespace: "default"}},
		},
		{
			name:     "create cluster scoped resource",
			toolName: "create_resource",
			args: map[string]interface{}{
				"yaml": "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: example\n",
			},
			want: []toolPermission{{Resource: "namespaces", Verb: "create", Namespace: ""}},
		},
		{
			name:     "patch cluster scoped resource",
			toolName: "patch_resource",
			args: map[string]interface{}{
				"kind":      "Node",
				"name":      "node-1",
				"namespace": "default",
				"patch":     `{"metadata":{"labels":{"env":"prod"}}}`,
			},
			want: []toolPermission{{Resource: "nodes", Verb: "update", Namespace: ""}},
		},
		{
			name:     "delete resource",
			toolName: "delete_resource",
			args: map[string]interface{}{
				"kind":      "Service",
				"name":      "api",
				"namespace": "default",
			},
			want: []toolPermission{{Resource: "services", Verb: "delete", Namespace: "default"}},
		},
		{
			name:     "prometheus query",
			toolName: "query_prometheus",
			args:     map[string]interface{}{"query": "up"},
			want:     []toolPermission{{Resource: "pods", Verb: "get", Namespace: "_all"}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := requiredToolPermissions(context.Background(), &cluster.ClientSet{}, tc.toolName, tc.args)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("unexpected permissions:\nwant: %#v\ngot:  %#v", tc.want, got)
			}
		})
	}
}

func TestRequiredToolPermissionsQualifiesCustomResources(t *testing.T) {
	cs := newToolAuthorizationTestClientSet(t)
	widgetYAML := "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: example\n  namespace: default\n"
	tests := []struct {
		name     string
		toolName string
		args     map[string]interface{}
		verb     string
	}{
		{name: "get", toolName: "get_resource", args: map[string]interface{}{"kind": "widgets.example.com", "namespace": "default"}, verb: "get"},
		{name: "list", toolName: "list_resources", args: map[string]interface{}{"kind": "widgets.example.com", "namespace": "default"}, verb: "get"},
		{name: "create", toolName: "create_resource", args: map[string]interface{}{"yaml": widgetYAML}, verb: "create"},
		{name: "update", toolName: "update_resource", args: map[string]interface{}{"yaml": widgetYAML}, verb: "update"},
		{name: "patch", toolName: "patch_resource", args: map[string]interface{}{"kind": "widgets.example.com", "name": "example", "namespace": "default"}, verb: "update"},
		{name: "delete", toolName: "delete_resource", args: map[string]interface{}{"kind": "widgets.example.com", "name": "example", "namespace": "default"}, verb: "delete"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := requiredToolPermissions(context.Background(), cs, tc.toolName, tc.args)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			want := []toolPermission{{Resource: "widgets.example.com", Verb: tc.verb, Namespace: "default"}}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("unexpected permissions:\nwant: %#v\ngot:  %#v", want, got)
			}
		})
	}
}

func TestAuthorizeToolCustomResourceGroups(t *testing.T) {
	cs := newToolAuthorizationTestClientSet(t)
	tests := []struct {
		name              string
		resource          string
		yaml              string
		wantError         bool
		wantErrorResource string
	}{
		{
			name:     "qualified custom resource permission allows",
			resource: "widgets.example.com",
			yaml:     "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: example\n  namespace: default\n",
		},
		{
			name:              "same plural in another group is denied",
			resource:          "widgets.other.example.com",
			yaml:              "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: example\n  namespace: default\n",
			wantError:         true,
			wantErrorResource: "widgets.example.com",
		},
		{
			name:              "builtin permission with same plural is denied",
			resource:          "pods",
			yaml:              "apiVersion: example.com/v1\nkind: CustomPod\nmetadata:\n  name: example\n  namespace: default\n",
			wantError:         true,
			wantErrorResource: "pods.example.com",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/ai/chat", nil)
			c.Set("user", model.User{
				Username: "alice",
				Roles: []common.Role{{
					Name:       "resource-creator",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{tc.resource},
					Verbs:      []string{"create"},
				}},
			})

			result, isError := AuthorizeTool(c, cs, "create_resource", map[string]interface{}{"yaml": tc.yaml})
			if isError != tc.wantError {
				t.Fatalf("AuthorizeTool() error = %v, want %v; result=%q", isError, tc.wantError, result)
			}
			if tc.wantError && (!strings.Contains(result, "Forbidden:") || !strings.Contains(result, tc.wantErrorResource)) {
				t.Fatalf("unexpected authorization error: %q", result)
			}
		})
	}
}

func newToolAuthorizationTestClientSet(t *testing.T) *cluster.ClientSet {
	t.Helper()
	resources := metav1.APIResourceList{
		TypeMeta:     metav1.TypeMeta{APIVersion: "v1", Kind: "APIResourceList"},
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{
			{Name: "widgets", SingularName: "widget", Namespaced: true, Kind: "Widget"},
			{Name: "pods", SingularName: "custompod", Namespaced: true, Kind: "CustomPod"},
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api":
			_ = json.NewEncoder(w).Encode(metav1.APIVersions{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIVersions"},
				Versions: []string{"v1"},
			})
		case "/apis":
			_ = json.NewEncoder(w).Encode(metav1.APIGroupList{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIGroupList"},
				Groups: []metav1.APIGroup{{
					Name:             "example.com",
					Versions:         []metav1.GroupVersionForDiscovery{{GroupVersion: "example.com/v1", Version: "v1"}},
					PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "example.com/v1", Version: "v1"},
				}},
			})
		case "/api/v1":
			_ = json.NewEncoder(w).Encode(metav1.APIResourceList{GroupVersion: "v1"})
		case "/apis/example.com/v1":
			_ = json.NewEncoder(w).Encode(resources)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	clientSet, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		t.Fatalf("create kubernetes client: %v", err)
	}
	return &cluster.ClientSet{
		Name:      "cluster-a",
		K8sClient: &kube.K8sClient{ClientSet: clientSet},
	}
}
