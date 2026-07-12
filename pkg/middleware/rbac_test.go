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
	}

	tests := []struct {
		name       string
		method     string
		url        string
		route      string
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
			name:       "all namespace list denied by namespaced role",
			method:     http.MethodGet,
			url:        "/api/v1/pods",
			cluster:    "prod",
			username:   "alice",
			roles:      []string{"pod-reader"},
			roleMap:    []common.RoleMapping{{Name: "pod-reader", Users: []string{"alice"}}},
			wantStatus: http.StatusForbidden,
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
	t.Cleanup(func() {
		rbac.RBACConfig = originalConfig
	})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
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
