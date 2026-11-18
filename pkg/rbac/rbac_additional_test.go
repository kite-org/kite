package rbac

import (
	"testing"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

func TestGetUserRoles(t *testing.T) {
	originalConfig := RBACConfig
	t.Cleanup(func() {
		RBACConfig = originalConfig
	})

	RBACConfig = nil
	if roles := GetUserRoles(model.User{Username: "alice"}); len(roles) != 0 {
		t.Fatalf("expected no roles with nil RBAC config, got %#v", roles)
	}

	RBACConfig = &common.RolesConfig{
		Roles: []common.Role{
			{Name: "admin"},
			{Name: "viewer"},
		},
		RoleMapping: []common.RoleMapping{
			{Name: "admin", Users: []string{"alice"}},
			{Name: "admin", OIDCGroups: []string{"ops"}},
			{Name: "viewer", OIDCGroups: []string{"ops"}},
		},
	}

	roles := GetUserRoles(model.User{Username: "alice", OIDCGroups: []string{"ops"}})
	if len(roles) != 2 {
		t.Fatalf("expected 2 roles, got %d", len(roles))
	}
	if !UserHasRole(model.User{Username: "alice", OIDCGroups: []string{"ops"}}, "admin") {
		t.Fatal("expected admin role to be present")
	}
	if !UserHasRole(model.User{Username: "alice", OIDCGroups: []string{"ops"}}, "viewer") {
		t.Fatal("expected viewer role to be present")
	}

	userRoles := []common.Role{{Name: "direct"}}
	user := model.User{Roles: userRoles}
	roles = GetUserRoles(user)
	if len(roles) != 1 || roles[0].Name != "direct" {
		t.Fatalf("expected direct roles to be returned, got %#v", roles)
	}
}

func TestCanAccessCurrent(t *testing.T) {
	originalConfig := RBACConfig
	t.Cleanup(func() {
		RBACConfig = originalConfig
	})

	allow := common.Role{
		Name:       "pod-reader",
		Clusters:   []string{"prod"},
		Namespaces: []string{"default"},
		Resources:  []string{"pods"},
		Verbs:      []string{"get"},
	}
	RBACConfig = &common.RolesConfig{}
	if CanAccessCurrent(model.User{Username: "alice", Roles: []common.Role{allow}}, "pods", "get", "prod", "default") {
		t.Fatal("expected current authorization to ignore the authenticated role snapshot")
	}
	if !CanAccessCurrent(model.AnonymousUser, "pods", "get", "prod", "default") {
		t.Fatal("expected anonymous authorization to keep the built-in role")
	}
}

func TestNoAccess(t *testing.T) {
	if got := NoAccess("alice", "get", "pods", "", "dev"); got != "user alice does not have permission to get pods on cluster dev" {
		t.Fatalf("unexpected message: %q", got)
	}

	if got := NoAccess("alice", "get", "pods", "_all", "dev"); got != "user alice does not have permission to get pods in namespace All on cluster dev" {
		t.Fatalf("unexpected message: %q", got)
	}

	if got := NoAccess("alice", "get", "pods", "default", "dev"); got != "user alice does not have permission to get pods in namespace default on cluster dev" {
		t.Fatalf("unexpected message: %q", got)
	}
}

func TestMatch(t *testing.T) {
	tests := []struct {
		name string
		list []string
		val  string
		want bool
	}{
		{
			name: "wildcard matches",
			list: []string{"*"},
			val:  "anything",
			want: true,
		},
		{
			name: "exact match",
			list: []string{"dev"},
			val:  "dev",
			want: true,
		},
		{
			name: "regexp match",
			list: []string{"dev.*"},
			val:  "dev-1",
			want: true,
		},
		{
			name: "asd",
			list: []string{"widgets.example.com"},
			val:  "widgets.example.com",
			want: true,
		},
		{
			name: "dots in literal resource do not match arbitrary characters",
			list: []string{"widgets.example.com"},
			val:  "widgets.examplexcom",
			want: false,
		},
		{
			name: "negated value blocks access",
			list: []string{"!kube-system", "*"},
			val:  "kube-system",
			want: false,
		},
		{
			name: "invalid regexp is ignored",
			list: []string{"["},
			val:  "dev",
			want: false,
		},
		{
			name: "empty list does not match",
			list: nil,
			val:  "dev",
			want: false,
		},
		{
			name: "negated regexp overrides wildcard",
			list: []string{"*", "!kube-.*"},
			val:  "kube-system",
			want: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := match(tc.list, tc.val); got != tc.want {
				t.Fatalf("match() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCanAccessClusterAndNamespace(t *testing.T) {
	user := model.User{
		Roles: []common.Role{
			{
				Name:       "team",
				Clusters:   []string{"dev.*"},
				Namespaces: []string{"team.*"},
			},
		},
	}

	if !CanAccessCluster(user, "dev-1") {
		t.Fatal("expected cluster access")
	}
	if CanAccessCluster(user, "prod-1") {
		t.Fatal("expected cluster access to be denied")
	}
	if !CanAccessNamespace(user, "dev-1", "team-a") {
		t.Fatal("expected namespace access")
	}
	if CanAccessNamespace(user, "prod-1", "team-a") {
		t.Fatal("expected namespace access to be denied")
	}

	splitRoleUser := model.User{
		Roles: []common.Role{
			{Name: "prod-other", Clusters: []string{"prod"}, Namespaces: []string{"other"}},
			{Name: "dev-default", Clusters: []string{"dev"}, Namespaces: []string{"default"}},
		},
	}
	if CanAccessNamespace(splitRoleUser, "prod", "default") {
		t.Fatal("expected cluster and namespace permissions from different roles not to be combined")
	}
}

func TestUserHasRole(t *testing.T) {
	user := model.User{
		Roles: []common.Role{
			{Name: "admin"},
		},
	}

	if !UserHasRole(user, "admin") {
		t.Fatal("expected admin role")
	}
	if UserHasRole(user, "viewer") {
		t.Fatal("did not expect viewer role")
	}
}

func TestCanAccess_ResourceAliasesAndNegations(t *testing.T) {
	viewer := model.User{
		Username: "viewer",
		Roles: []common.Role{
			{
				Name:       "viewer",
				Clusters:   []string{"*"},
				Namespaces: []string{"*"},
				Resources:  []string{"!secrets", "!configmaps", "!helmreleases", "*"},
				Verbs:      []string{"get", "log"},
			},
		},
	}

	if CanAccess(viewer, string(common.HelmReleases), "get", "prod", "default") {
		t.Fatal("expected !helmreleases deny rule to block helmrelease access")
	}
	if CanAccess(viewer, string(common.Secrets), "get", "prod", "default") {
		t.Fatal("expected !secrets deny rule to block secrets access")
	}
	if !CanAccess(viewer, string(common.Pods), "get", "prod", "default") {
		t.Fatal("expected wildcard allow to permit pods access")
	}

	aliasDeny := model.User{
		Username: "alias-deny",
		Roles: []common.Role{
			{
				Name:       "custom",
				Clusters:   []string{"*"},
				Namespaces: []string{"*"},
				Resources:  []string{"!secret", "!cm", "!hr", "!crds", "*"},
				Verbs:      []string{"get"},
			},
		},
	}
	for _, res := range []common.ResourceType{common.Secrets, common.ConfigMaps, common.HelmReleases, common.CRDs} {
		if CanAccess(aliasDeny, string(res), "get", "prod", "default") {
			t.Fatalf("expected alias deny rule to block %q", res)
		}
	}

	aliasAllow := model.User{
		Username: "alias-allow",
		Roles: []common.Role{
			{
				Name:       "pod-reader",
				Clusters:   []string{"*"},
				Namespaces: []string{"default"},
				Resources:  []string{"pod"},
				Verbs:      []string{"get"},
			},
		},
	}
	if !CanAccess(aliasAllow, string(common.Pods), "get", "prod", "default") {
		t.Fatal("expected singular pod allow rule to match pods")
	}
	if CanAccess(aliasAllow, string(common.Secrets), "get", "prod", "default") {
		t.Fatal("did not expect pod allow rule to match secrets")
	}

	crdDeny := model.User{
		Username: "crd-deny",
		Roles: []common.Role{
			{
				Name:       "crd-custom",
				Clusters:   []string{"*"},
				Namespaces: []string{"*"},
				Resources:  []string{"!pods", "*"},
				Verbs:      []string{"get"},
			},
		},
	}
	if !CanAccess(crdDeny, "pods.custom.io", "get", "prod", "default") {
		t.Fatal("expected !pods not to block unrelated CRD pods.custom.io")
	}
}
