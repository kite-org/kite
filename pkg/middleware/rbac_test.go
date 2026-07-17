package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

func TestRBACMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rolesMap := map[string]common.Role{
		"admin": {
			Name:       "admin",
			Clusters:   []string{"*"},
			Resources:  []string{"*"},
			Namespaces: []string{"*"},
			Verbs:      []string{"*"},
		},
		"pod-reader": {
			Name:       "pod-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"pods"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"pod-editor": {
			Name:       "pod-editor",
			Clusters:   []string{"prod"},
			Resources:  []string{"pods"},
			Namespaces: []string{"default"},
			Verbs:      []string{"create", "update", "delete"},
		},
		"slash-cluster-pod-reader": {
			Name:       "slash-cluster-pod-reader",
			Clusters:   []string{"prod/east"},
			Resources:  []string{"pods"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"service-reader": {
			Name:       "service-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"services"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"widget-reader": {
			Name:       "widget-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"widgets.example.com"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"all-namespace-reader": {
			Name:       "all-namespace-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"pods"},
			Namespaces: []string{"*"},
			Verbs:      []string{"get"},
		},
		"no-system-reader": {
			Name:       "no-system-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"pods"},
			Namespaces: []string{"!kube-system", "*"},
			Verbs:      []string{"get"},
		},
		"regexp-reader": {
			Name:       "regexp-reader",
			Clusters:   []string{"prod-.*"},
			Resources:  []string{"po.*"},
			Namespaces: []string{"team-.*"},
			Verbs:      []string{"g.*"},
		},
		"wrong-resource": {
			Name:       "wrong-resource",
			Clusters:   []string{"prod"},
			Resources:  []string{"deployments"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"wrong-namespace": {
			Name:       "wrong-namespace",
			Clusters:   []string{"prod"},
			Resources:  []string{"pods"},
			Namespaces: []string{"other"},
			Verbs:      []string{"get"},
		},
		"node-reader": {
			Name:       "node-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"nodes"},
			Namespaces: []string{common.AllNamespaces},
			Verbs:      []string{"get"},
		},
		"namespaced-node-reader": {
			Name:       "namespaced-node-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"nodes"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"namespaced-node-metrics-reader": {
			Name:       "namespaced-node-metrics-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"nodemetrics"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"events-default-reader": {
			Name:       "events-default-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"events"},
			Namespaces: []string{"default"},
			Verbs:      []string{"get"},
		},
		"events-all-reader": {
			Name:       "events-all-reader",
			Clusters:   []string{"prod"},
			Resources:  []string{"events"},
			Namespaces: []string{common.AllNamespaces},
			Verbs:      []string{"get"},
		},
	}

	tests := []struct {
		name       string
		method     string
		url        string
		route      string
		base       string
		cluster    string
		username   string
		oidcGroups []string
		roles      []string
		roleMap    []common.RoleMapping
		wantStatus int
	}{
		{
			name:       "legacy URL with user role",
			method:     http.MethodGet,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster URL with user role",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/pods/default/nginx",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "unmapped user",
			method:     http.MethodGet,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "bob",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "OIDC group role",
			method:     http.MethodGet,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "alice",
			oidcGroups: []string{"developers"},
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", OIDCGroups: []string{"developers"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "wildcard user mapping",
			method:     http.MethodGet,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "bob",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"*"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "wrong cluster",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/dev/pods/default/nginx",
			cluster:    "dev",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "wrong resource",
			method:     http.MethodGet,
			url:        "/api/v1/deployments/default/web",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "wrong namespace",
			method:     http.MethodGet,
			url:        "/api/v1/pods/kube-system/coredns",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "wrong verb",
			method:     http.MethodDelete,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "POST maps to create",
			method:     http.MethodPost,
			url:        "/api/v1/pods/default",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-editor"},
			roleMap:    []common.RoleMapping{{Name: "pod-editor", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "PATCH maps to update",
			method:     http.MethodPatch,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-editor"},
			roleMap:    []common.RoleMapping{{Name: "pod-editor", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "wildcard role",
			method:     http.MethodDelete,
			url:        "/api/v1/secrets/kube-system/token",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"admin"},
			roleMap:    []common.RoleMapping{{Name: "admin", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "regexp role",
			method:     http.MethodGet,
			url:        "/api/v1/pods/team-a/nginx",
			cluster:    "prod-east",
			username:   "alice",
			roles:      []string{"regexp-reader"},
			roleMap:    []common.RoleMapping{{Name: "regexp-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "negative namespace rule",
			method:     http.MethodGet,
			url:        "/api/v1/pods/%6bube-system/coredns",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"no-system-reader"},
			roleMap:    []common.RoleMapping{{Name: "no-system-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "all namespace list allowed for namespaced role",
			method:     http.MethodGet,
			url:        "/api/v1/pods",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "legacy all namespace pod watch allowed for namespaced role",
			method:     http.MethodGet,
			url:        "/api/v1/pods/_all/watch",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster all namespace pod watch allowed for namespaced role",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/pods/_all/watch",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "legacy non pod all namespace watch denied",
			method:     http.MethodGet,
			url:        "/api/v1/services/_all/watch",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"service-reader"},
			roleMap:    []common.RoleMapping{{Name: "service-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "cluster non pod all namespace watch denied",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/services/_all/watch",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"service-reader"},
			roleMap:    []common.RoleMapping{{Name: "service-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "legacy dynamic CR all namespace list allowed",
			method:     http.MethodGet,
			url:        "/api/v1/widgets.example.com",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"widget-reader"},
			roleMap:    []common.RoleMapping{{Name: "widget-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster dynamic CR all namespace list allowed",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/widgets.example.com/_all",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"widget-reader"},
			roleMap:    []common.RoleMapping{{Name: "widget-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "POST all namespace denied for namespaced role",
			method:     http.MethodPost,
			url:        "/api/v1/pods/_all",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-editor"},
			roleMap:    []common.RoleMapping{{Name: "pod-editor", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "base path all namespace list allowed",
			method:     http.MethodGet,
			url:        "/kite/api/v1/pods/_all",
			base:       "/kite",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "base path cluster pod watch allowed",
			method:     http.MethodGet,
			url:        "/kite/api/v1/_clusters/prod/pods/_all/watch",
			base:       "/kite",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "encoded cluster all namespace list allowed",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod%2Feast/pods/_all",
			cluster:    "prod/east",
			username:   "alice",
			roles:      []string{"slash-cluster-pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "slash-cluster-pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "all namespace list with wildcard namespace",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/pods",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"all-namespace-reader"},
			roleMap:    []common.RoleMapping{{Name: "all-namespace-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:     "permissions from different roles are not combined",
			method:   http.MethodGet,
			url:      "/api/v1/pods/default/nginx",
			cluster:  "prod",
			username: "alice",
			roles:    []string{"wrong-resource", "wrong-namespace"},
			roleMap: []common.RoleMapping{
				{Name: "wrong-resource", Users: []string{"alice"}},
				{Name: "wrong-namespace", Users: []string{"alice"}},
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "legacy cluster scoped resource without _all",
			method:     http.MethodGet,
			url:        "/api/v1/nodes",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"node-reader"},
			roleMap:    []common.RoleMapping{{Name: "node-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster URL scoped resource without _all",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/nodes",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"node-reader"},
			roleMap:    []common.RoleMapping{{Name: "node-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "legacy cluster scoped list denied for namespaced grant",
			method:     http.MethodGet,
			url:        "/api/v1/nodes",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"namespaced-node-reader"},
			roleMap:    []common.RoleMapping{{Name: "namespaced-node-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "cluster scoped list denied for namespaced grant",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/nodes/_all",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"namespaced-node-reader"},
			roleMap:    []common.RoleMapping{{Name: "namespaced-node-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "node metrics list denied for namespaced grant",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/nodemetrics/_all",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"namespaced-node-metrics-reader"},
			roleMap:    []common.RoleMapping{{Name: "namespaced-node-metrics-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "cluster scoped event target normalizes query namespace",
			method:     http.MethodGet,
			url:        "/api/v1/events/resources?resource=nodes&name=worker&namespace=default",
			route:      "/api/v1/events/resources",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"events-all-reader"},
			roleMap:    []common.RoleMapping{{Name: "events-all-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster scoped event target rejects namespaced event grant",
			method:     http.MethodGet,
			url:        "/api/v1/events/resources?resource=nodes&name=worker&namespace=default",
			route:      "/api/v1/events/resources",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"events-default-reader"},
			roleMap:    []common.RoleMapping{{Name: "events-default-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "cluster scoped resource",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/nodes/_all/node-a",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"node-reader"},
			roleMap:    []common.RoleMapping{{Name: "node-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "namespace list uses cluster access",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/namespaces",
			route:      "/api/v1/_clusters/:cluster/namespaces",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "allowed namespace detail",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/namespaces/_all/default",
			route:      "/api/v1/_clusters/:cluster/namespaces/_all/:name",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "forbidden namespace detail",
			method:     http.MethodGet,
			url:        "/api/v1/_clusters/prod/namespaces/_all/kube-system",
			route:      "/api/v1/_clusters/:cluster/namespaces/_all/:name",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "invalid resource URL",
			method:     http.MethodGet,
			url:        "/api/v1",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"admin"},
			roleMap:    []common.RoleMapping{{Name: "admin", Users: []string{"alice"}}},
			wantStatus: http.StatusBadRequest,
		},
	}

	originalConfig := rbac.RBACConfig
	originalBase := common.Base
	t.Cleanup(func() {
		rbac.RBACConfig = originalConfig
		common.Base = originalBase
	})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			common.Base = tc.base
			roles := make([]common.Role, 0, len(tc.roles))
			for _, name := range tc.roles {
				roles = append(roles, rolesMap[name])
			}
			rbac.RBACConfig = &common.RolesConfig{
				Roles:       roles,
				RoleMapping: tc.roleMap,
			}

			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set("user", model.User{Username: tc.username, OIDCGroups: tc.oidcGroups})
				c.Set("cluster", &cluster.ClientSet{Name: tc.cluster})
			})
			router.Use(RBACMiddleware())

			route := tc.route
			if route == "" {
				route = "/*path"
			}
			router.Any(route, func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			})

			response := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.url, nil)
			router.ServeHTTP(response, request)

			if response.Code != tc.wantStatus {
				t.Fatalf("%s %s returned %d, want %d; body=%s", tc.method, tc.url, response.Code, tc.wantStatus, response.Body.String())
			}
		})
	}
}

func TestIsCrossNamespaceList(t *testing.T) {
	testCases := []struct {
		name string
		path string
		want bool
	}{
		{name: "list no namespace segment", path: "/api/v1/pods", want: true},
		{name: "list explicit _all", path: "/api/v1/pods/_all", want: true},
		{name: "list deployments explicit _all", path: "/api/v1/deployments/_all", want: true},
		{name: "cluster list no namespace segment", path: "/api/v1/_clusters/prod/pods", want: true},
		{name: "cluster list explicit _all", path: "/api/v1/_clusters/prod/pods/_all", want: true},
		{name: "single resource _all get", path: "/api/v1/pods/_all/foo", want: false},
		{name: "single resource namespaced get", path: "/api/v1/pods/default/foo", want: false},
		{name: "cluster single resource _all get", path: "/api/v1/_clusters/prod/pods/_all/foo", want: false},
		{name: "describe sub-route", path: "/api/v1/pods/_all/foo/describe", want: false},
		{name: "history sub-route", path: "/api/v1/pods/default/foo/history", want: false},
		{name: "watch sub-route", path: "/api/v1/pods/_all/watch", want: false},
		{name: "specific namespace list is not cross-ns", path: "/api/v1/pods/default", want: false},
		{name: "cluster specific namespace list is not cross-ns", path: "/api/v1/_clusters/prod/pods/default", want: false},
		{name: "too short", path: "/api/v1", want: false},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isCrossNamespaceList(tc.path); got != tc.want {
				t.Errorf("isCrossNamespaceList(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}

func TestIsCrossNamespaceWatch(t *testing.T) {
	testCases := []struct {
		name string
		path string
		want bool
	}{
		{name: "pods all watch", path: "/api/v1/pods/_all/watch", want: true},
		{name: "cluster pods all watch", path: "/api/v1/_clusters/prod/pods/_all/watch", want: true},
		{name: "specific namespace watch is not cross-ns", path: "/api/v1/pods/default/watch", want: false},
		{name: "cluster specific namespace watch is not cross-ns", path: "/api/v1/_clusters/prod/pods/default/watch", want: false},
		{name: "list is not watch", path: "/api/v1/pods/_all", want: false},
		{name: "single resource get is not watch", path: "/api/v1/pods/_all/foo", want: false},
		{name: "describe sub-route is not watch", path: "/api/v1/pods/_all/foo/describe", want: false},
		{name: "plain list is not watch", path: "/api/v1/pods", want: false},
		{name: "too short", path: "/api/v1", want: false},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isCrossNamespaceWatch(tc.path); got != tc.want {
				t.Errorf("isCrossNamespaceWatch(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}
