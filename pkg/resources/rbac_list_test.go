package resources

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func TestGenericResourceRBACAllNamespaces(t *testing.T) {
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{
			Username: "alice",
			Roles: []common.Role{
				{
					Name:       "configmap-default-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"default"},
					Resources:  []string{string(common.ConfigMaps)},
					Verbs:      []string{string(common.VerbGet)},
				},
				{
					Name:       "configmap-team-b-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"team-b"},
					Resources:  []string{string(common.ConfigMaps)},
					Verbs:      []string{string(common.VerbGet)},
				},
				{
					Name:       "secret-team-reader",
					Clusters:   []string{"cluster-a"},
					Namespaces: []string{"team-a"},
					Resources:  []string{string(common.Secrets)},
					Verbs:      []string{string(common.VerbGet)},
				},
			},
		},
		clusterAObjects: []client.Object{
			&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "allowed-default", Namespace: "default"}},
			&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "allowed-team-b", Namespace: "team-b"}},
			&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "denied", Namespace: "team-a"}},
		},
	})

	for _, path := range []string{
		"/api/v1/configmaps",
		"/api/v1/configmaps/_all",
		"/api/v1/_clusters/cluster-a/configmaps",
		"/api/v1/_clusters/cluster-a/configmaps/_all",
	} {
		t.Run(path, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			list := decodePodAPIResponse[corev1.ConfigMapList](t, response)
			if len(list.Items) != 2 ||
				list.Items[0].Namespace != "default" || list.Items[0].Name != "allowed-default" ||
				list.Items[1].Namespace != "team-b" || list.Items[1].Name != "allowed-team-b" {
				t.Fatalf("GET %s returned %#v, want default and team-b configmaps", path, list.Items)
			}
		})
	}
}

func TestClusterScopedSearchRBACFiltering(t *testing.T) {
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{Username: "operator"},
		clusterAObjects: []client.Object{
			&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-node"}},
			&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "worker-pv"}},
		},
	})

	tests := []struct {
		resource common.ResourceType
		name     string
	}{
		{resource: common.Nodes, name: "worker-node"},
		{resource: common.PersistentVolumes, name: "worker-pv"},
	}
	for _, test := range tests {
		t.Run(string(test.resource), func(t *testing.T) {
			handler := newResourceHandlers()[string(test.resource)]
			search := func(user model.User) []common.SearchResult {
				recorder := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(recorder)
				ctx.Request = httptest.NewRequest(http.MethodGet, "/search", nil)
				ctx.Set("user", user)
				ctx.Set("cluster", &cluster.ClientSet{
					Name:      "cluster-a",
					K8sClient: &kube.K8sClient{Client: fixture.clients["cluster-a"]},
				})
				results, err := handler.Search(ctx, "worker", 10)
				if err != nil {
					t.Fatalf("search %s: %v", test.resource, err)
				}
				return results
			}

			denied := search(model.User{Username: "alice", Roles: []common.Role{{
				Name:       "pod-reader",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{"default"},
				Resources:  []string{string(common.Pods)},
				Verbs:      []string{string(common.VerbGet)},
			}}})
			if len(denied) != 0 {
				t.Fatalf("unauthorized search returned %#v", denied)
			}

			allowed := search(model.User{Username: "alice", Roles: []common.Role{{
				Name:       "cluster-resource-reader",
				Clusters:   []string{"cluster-a"},
				Namespaces: []string{common.AllNamespaces},
				Resources:  []string{string(test.resource)},
				Verbs:      []string{string(common.VerbGet)},
			}}})
			if len(allowed) != 1 || allowed[0].Name != test.name {
				t.Fatalf("authorized search returned %#v, want %s", allowed, test.name)
			}
		})
	}
}

func TestNamespaceListRBACFiltering(t *testing.T) {
	fixture := newPodAPITestFixture(t, podAPITestConfig{
		user: model.User{
			Username: "alice",
			Roles: []common.Role{
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
			},
		},
		clusterAObjects: []client.Object{
			&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
			&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "team-a"}},
			&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system"}},
		},
	})

	for _, path := range []string{
		"/api/v1/namespaces",
		"/api/v1/namespaces/_all",
		"/api/v1/_clusters/cluster-a/namespaces",
		"/api/v1/_clusters/cluster-a/namespaces/_all",
	} {
		t.Run(path, func(t *testing.T) {
			response := performPodAPIRequest(t, fixture, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK {
				t.Fatalf("GET %s returned %d, want %d; body=%s", path, response.Code, http.StatusOK, response.Body.String())
			}
			list := decodePodAPIResponse[corev1.NamespaceList](t, response)
			if len(list.Items) != 2 || list.Items[0].Name != "default" || list.Items[1].Name != "team-a" {
				t.Fatalf("GET %s returned %#v, want default and team-a", path, list.Items)
			}
		})
	}
}
