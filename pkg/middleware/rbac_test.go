package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

func TestURL2NamespaceResource(t *testing.T) {
	testCases := []struct {
		name          string
		url           string
		wantNamespace string
		wantResource  string
	}{
		{
			name:          "legacy namespaced resource detail",
			url:           "/api/v1/pods/default/nginx",
			wantNamespace: "default",
			wantResource:  "pods",
		},
		{
			name:          "legacy resource list across all namespaces",
			url:           "/api/v1/pods",
			wantNamespace: common.AllNamespaces,
			wantResource:  "pods",
		},
		{
			name:          "legacy cluster scoped resource detail",
			url:           "/api/v1/nodes/_all/node-a",
			wantNamespace: common.AllNamespaces,
			wantResource:  "nodes",
		},
		{
			name:          "legacy custom action",
			url:           "/api/v1/pods/default/nginx/describe",
			wantNamespace: "default",
			wantResource:  "pods",
		},
		{
			name:          "cluster path namespaced resource detail",
			url:           "/api/v1/_clusters/prod/pods/default/nginx",
			wantNamespace: "default",
			wantResource:  "pods",
		},
		{
			name:          "cluster path resource list across all namespaces",
			url:           "/api/v1/_clusters/prod/pods",
			wantNamespace: common.AllNamespaces,
			wantResource:  "pods",
		},
		{
			name:          "encoded slash in cluster name does not shift indexes",
			url:           "/api/v1/_clusters/team%2Fprod/pods/default/nginx",
			wantNamespace: "default",
			wantResource:  "pods",
		},
		{
			name:          "encoded namespace letter is decoded",
			url:           "/api/v1/_clusters/prod/pods/%6bube-system/nginx",
			wantNamespace: "kube-system",
			wantResource:  "pods",
		},
		{
			name:          "encoded namespace delimiter is decoded",
			url:           "/api/v1/pods/kube%2Dsystem/nginx",
			wantNamespace: "kube-system",
			wantResource:  "pods",
		},
		{
			name:          "encoded CRD resource is decoded",
			url:           "/api/v1/_clusters/prod/%77idgets.example.com/default/widget-a",
			wantNamespace: "default",
			wantResource:  "widgets.example.com",
		},
		{
			name:          "double encoded namespace is decoded once",
			url:           "/api/v1/pods/%256bube-system/nginx",
			wantNamespace: "%6bube-system",
			wantResource:  "pods",
		},
		{
			name:          "watch route keeps resource and namespace",
			url:           "/api/v1/_clusters/prod/pods/team-a/watch",
			wantNamespace: "team-a",
			wantResource:  "pods",
		},
		{
			name:          "additional path components do not change scope",
			url:           "/api/v1/_clusters/prod/deployments/team-a/web/history",
			wantNamespace: "team-a",
			wantResource:  "deployments",
		},
		{
			name:          "invalid URL too short",
			url:           "/api/v1",
			wantNamespace: "",
			wantResource:  "",
		},
		{
			name:          "cluster path missing resource",
			url:           "/api/v1/_clusters/prod",
			wantNamespace: "",
			wantResource:  "",
		},
		{
			name:          "malformed escaped resource fails closed",
			url:           "/api/v1/%zz/default/name",
			wantNamespace: "",
			wantResource:  "",
		},
		{
			name:          "malformed escaped namespace fails closed",
			url:           "/api/v1/pods/%zz/name",
			wantNamespace: "",
			wantResource:  "",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			gotNamespace, gotResource := url2namespaceresource(tc.url)
			if gotNamespace != tc.wantNamespace || gotResource != tc.wantResource {
				t.Fatalf("url2namespaceresource(%q) = (%q, %q), want (%q, %q)",
					tc.url, gotNamespace, gotResource, tc.wantNamespace, tc.wantResource)
			}
		})
	}
}

func TestURL2NamespaceResourceWithBasePath(t *testing.T) {
	oldBase := common.Base
	common.Base = "/kite"
	t.Cleanup(func() {
		common.Base = oldBase
	})

	namespace, resource := url2namespaceresource("/kite/api/v1/_clusters/team%2Fprod/pods/kube%2Dsystem/nginx")
	if namespace != "kube-system" || resource != "pods" {
		t.Fatalf("url2namespaceresource() = (%q, %q), want (%q, %q)", namespace, resource, "kube-system", "pods")
	}
}

func TestRBACMiddlewarePermissionsByURL(t *testing.T) {
	type permissions struct {
		clusters   []string
		resources  []string
		namespaces []string
		verbs      []string
	}

	testCases := []struct {
		name       string
		method     string
		url        string
		cluster    string
		roles      []permissions
		wantStatus int
		wantBody   string
	}{
		{
			name:    "exact permissions allow legacy resource",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "exact permissions allow cluster path resource",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "no roles deny access",
			method:     http.MethodGet,
			url:        "/api/v1/pods/default/nginx",
			cluster:    "prod",
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "wrong cluster denies access",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"dev"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "wrong resource denies access",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"deployments"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "wrong namespace denies access",
			method:  http.MethodGet,
			url:     "/api/v1/pods/kube-system/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "wrong verb denies access",
			method:  http.MethodDelete,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "explicit DELETE permission allows access",
			method:  http.MethodDelete,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"delete"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "POST maps to create",
			method:  http.MethodPost,
			url:     "/api/v1/pods/default",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"create"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "PUT maps to update",
			method:  http.MethodPut,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"update"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "PATCH maps to update",
			method:  http.MethodPatch,
			url:     "/api/v1/_clusters/prod/deployments/team-a/web",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"deployments"}, namespaces: []string{"team-a"}, verbs: []string{"update"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "pod resize custom action requires update",
			method:  http.MethodPatch,
			url:     "/api/v1/_clusters/prod/pods/default/nginx/resize",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"update"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "pod resize custom action rejects create only role",
			method:  http.MethodPatch,
			url:     "/api/v1/pods/default/nginx/resize",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"create"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "node drain custom action maps POST to create",
			method:  http.MethodPost,
			url:     "/api/v1/_clusters/prod/nodes/_all/node-a/drain",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"nodes"}, namespaces: []string{"_all"}, verbs: []string{"create"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "helm rollback custom action maps PUT to update",
			method:  http.MethodPut,
			url:     "/api/v1/helmreleases/default/release-a/rollback",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"helmreleases"}, namespaces: []string{"default"}, verbs: []string{"update"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "history action maps GET to get",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/deployments/default/web/history",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"deployments"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "wildcards allow access",
			method:  http.MethodDelete,
			url:     "/api/v1/_clusters/prod/pods/team-a/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"*"}, resources: []string{"*"}, namespaces: []string{"*"}, verbs: []string{"*"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "regular expressions allow access",
			method:  http.MethodGet,
			url:     "/api/v1/pods/team-a/nginx",
			cluster: "prod-01",
			roles: []permissions{{
				clusters: []string{"prod-.*"}, resources: []string{"po.*"}, namespaces: []string{"team-.*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative cluster rule denies access",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"!prod", "*"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "negative cluster rule allows another cluster",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/dev/pods/default/nginx",
			cluster: "dev",
			roles: []permissions{{
				clusters: []string{"!prod", "*"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative resource rule denies access",
			method:  http.MethodGet,
			url:     "/api/v1/secrets/default/app-secret",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"!secrets", "*"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "negative resource rule allows another resource",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"!secrets", "*"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative verb rule denies access",
			method:  http.MethodDelete,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"!delete", "*"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "negative verb rule allows another verb",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"!delete", "*"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative namespace rule denies plain namespace",
			method:  http.MethodGet,
			url:     "/api/v1/pods/kube-system/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!kube-system", "*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "negative namespace rule allows another namespace",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!kube-system", "*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative namespace rule denies encoded legacy namespace",
			method:  http.MethodGet,
			url:     "/api/v1/pods/%6bube-system/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!kube-system", "*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
			wantBody:   "kube-system",
		},
		{
			name:    "negative namespace rule denies encoded cluster path namespace",
			method:  http.MethodDelete,
			url:     "/api/v1/_clusters/prod/pods/kube%2Dsystem/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!kube-system", "*"}, verbs: []string{"delete"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "negative CRD resource rule denies encoded resource",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/%77idgets.example.com/default/widget-a",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"!widgets.example.com", "*"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
			wantBody:   "widgets.example.com",
		},
		{
			name:    "exact CRD permission allows encoded resource",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/%77idgets.example.com/default/widget-a",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"widgets.example.com"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "encoded slash in cluster name preserves permission scope",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/team%2Fprod/pods/default/nginx",
			cluster: "team/prod",
			roles: []permissions{{
				clusters: []string{"team/prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "literal percent escape in cluster name stays literal",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod%252Fblue/pods/default/nginx",
			cluster: "prod%2Fblue",
			roles: []permissions{{
				clusters: []string{"prod%2Fblue"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "plus sign in cluster name preserves permission scope",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/team%2Bblue/pods/default/nginx",
			cluster: "team+blue",
			roles: []permissions{{
				clusters: []string{"team+blue"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "cluster scoped resource uses all namespaces scope",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/nodes/_all/node-a",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"nodes"}, namespaces: []string{"*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "all namespace list requires wildcard namespace permission",
			method:  http.MethodGet,
			url:     "/api/v1/pods",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "wildcard namespace allows all namespace list",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/pods",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "exact all namespace permission allows all namespace list",
			method:  http.MethodGet,
			url:     "/api/v1/pods/_all",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"_all"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "negative all namespace rule denies encoded all namespace",
			method:  http.MethodGet,
			url:     "/api/v1/pods/%5Fall/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!_all", "*"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
			wantBody:   "All",
		},
		{
			name:    "double encoded namespace is authorized as a literal value",
			method:  http.MethodGet,
			url:     "/api/v1/pods/%256bube-system/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"%6bube-system"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "namespace GET continues for handler filtering",
			method:  http.MethodGet,
			url:     "/api/v1/_clusters/prod/namespaces",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "namespace DELETE still requires explicit permission",
			method:  http.MethodDelete,
			url:     "/api/v1/_clusters/prod/namespaces/_all/team-a",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"*"}, verbs: []string{"delete"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "invalid short URL returns bad request",
			method:  http.MethodGet,
			url:     "/api/v1",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"*"}, resources: []string{"*"}, namespaces: []string{"*"}, verbs: []string{"*"},
			}},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:    "malformed permission regex does not grant access",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{{
				clusters: []string{"prod"}, resources: []string{"["}, namespaces: []string{"default"}, verbs: []string{"get"},
			}},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "permissions from separate incomplete roles are not combined",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{
				{clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"other"}, verbs: []string{"get"}},
				{clusters: []string{"prod"}, resources: []string{"deployments"}, namespaces: []string{"default"}, verbs: []string{"get"}},
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:    "any complete role grants access",
			method:  http.MethodGet,
			url:     "/api/v1/pods/default/nginx",
			cluster: "prod",
			roles: []permissions{
				{clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"other"}, verbs: []string{"get"}},
				{clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"default"}, verbs: []string{"get"}},
			},
			wantStatus: http.StatusNoContent,
		},
		{
			name:    "explicit role grant overrides another role exclusion",
			method:  http.MethodGet,
			url:     "/api/v1/pods/kube-system/nginx",
			cluster: "prod",
			roles: []permissions{
				{clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"!kube-system", "*"}, verbs: []string{"get"}},
				{clusters: []string{"prod"}, resources: []string{"pods"}, namespaces: []string{"kube-system"}, verbs: []string{"get"}},
			},
			wantStatus: http.StatusNoContent,
		},
	}

	gin.SetMode(gin.TestMode)
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			roles := make([]common.Role, len(tc.roles))
			for i, role := range tc.roles {
				roles[i] = common.Role{
					Name:       "test-role",
					Clusters:   role.clusters,
					Resources:  role.resources,
					Namespaces: role.namespaces,
					Verbs:      role.verbs,
				}
			}

			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set("user", model.User{Username: "tester", Roles: roles})
				c.Set("cluster", &cluster.ClientSet{Name: tc.cluster})
			})
			router.Use(RBACMiddleware())
			router.Any("/*path", func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(tc.method, tc.url, nil)
			router.ServeHTTP(recorder, request)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("%s %s returned %d, want %d; body=%s", tc.method, tc.url, recorder.Code, tc.wantStatus, recorder.Body.String())
			}
			if tc.wantBody != "" && !strings.Contains(recorder.Body.String(), tc.wantBody) {
				t.Fatalf("%s %s body %q does not contain %q", tc.method, tc.url, recorder.Body.String(), tc.wantBody)
			}
		})
	}
}

func TestRBACMiddlewareNamespaceListAndDetailPermissions(t *testing.T) {
	clusterAccessRole := common.Role{
		Name:       "cluster-access",
		Clusters:   []string{"prod"},
		Resources:  []string{"pods"},
		Namespaces: []string{"default"},
		Verbs:      []string{"get"},
	}
	namespaceViewerRole := common.Role{
		Name:       "namespace-viewer",
		Clusters:   []string{"prod"},
		Resources:  []string{"namespaces"},
		Namespaces: []string{"*"},
		Verbs:      []string{"get"},
	}
	otherClusterRole := common.Role{
		Name:       "other-cluster",
		Clusters:   []string{"dev"},
		Resources:  []string{"*"},
		Namespaces: []string{"*"},
		Verbs:      []string{"*"},
	}

	testCases := []struct {
		name       string
		url        string
		cluster    string
		roles      []common.Role
		wantStatus int
	}{
		{
			name:       "legacy namespace list is allowed for cluster access",
			url:        "/api/v1/namespaces",
			cluster:    "prod",
			roles:      []common.Role{clusterAccessRole},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "cluster path namespace list is allowed for cluster access",
			url:        "/api/v1/_clusters/prod/namespaces/_all",
			cluster:    "prod",
			roles:      []common.Role{clusterAccessRole},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "namespace list is denied without target cluster access",
			url:        "/api/v1/_clusters/prod/namespaces",
			cluster:    "prod",
			roles:      []common.Role{otherClusterRole},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "legacy namespace detail uses normal resource permissions",
			url:        "/api/v1/namespaces/_all/kube-system",
			cluster:    "prod",
			roles:      []common.Role{clusterAccessRole},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "cluster path namespace detail uses normal resource permissions",
			url:        "/api/v1/_clusters/prod/namespaces/_all/kube-system",
			cluster:    "prod",
			roles:      []common.Role{clusterAccessRole},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "namespace detail is allowed with explicit permission",
			url:        "/api/v1/_clusters/prod/namespaces/_all/kube-system",
			cluster:    "prod",
			roles:      []common.Role{namespaceViewerRole},
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "namespace history uses normal resource permissions",
			url:        "/api/v1/_clusters/prod/namespaces/_all/kube-system/history",
			cluster:    "prod",
			roles:      []common.Role{clusterAccessRole},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "namespace describe is allowed with explicit permission",
			url:        "/api/v1/namespaces/_all/kube-system/describe",
			cluster:    "prod",
			roles:      []common.Role{namespaceViewerRole},
			wantStatus: http.StatusNoContent,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set("user", model.User{Username: "tester", Roles: tc.roles})
				c.Set("cluster", &cluster.ClientSet{Name: tc.cluster})
			})

			allowed := func(c *gin.Context) {
				c.Status(http.StatusNoContent)
			}
			paths := []string{
				"/api/v1/namespaces",
				"/api/v1/namespaces/_all",
				"/api/v1/namespaces/_all/:name",
				"/api/v1/namespaces/_all/:name/history",
				"/api/v1/namespaces/_all/:name/describe",
				"/api/v1/_clusters/:cluster/namespaces",
				"/api/v1/_clusters/:cluster/namespaces/_all",
				"/api/v1/_clusters/:cluster/namespaces/_all/:name",
				"/api/v1/_clusters/:cluster/namespaces/_all/:name/history",
				"/api/v1/_clusters/:cluster/namespaces/_all/:name/describe",
			}
			for _, path := range paths {
				router.GET(path, RBACMiddleware(), allowed)
			}

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tc.url, nil)
			router.ServeHTTP(recorder, request)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("GET %s returned %d, want %d; body=%s", tc.url, recorder.Code, tc.wantStatus, recorder.Body.String())
			}
		})
	}
}
