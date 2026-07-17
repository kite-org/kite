package rbac

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

// CanAccess checks if user/oidcGroup can access resource with verb in cluster/namespace
func CanAccess(user model.User, resource, verb, cluster, namespace string) bool {
	roles := GetUserRoles(user)
	for _, role := range roles {
		if match(role.Clusters, cluster) &&
			match(role.Namespaces, namespace) &&
			match(role.Resources, resource) &&
			match(role.Verbs, verb) {
			klog.V(2).Infof("RBAC Check - User: %s, OIDC Groups: %v, Resource: %s, Verb: %s, Cluster: %s, Namespace: %s, Hit Role: %v",
				user.Key(), user.OIDCGroups, resource, verb, cluster, namespace, role.Name)
			return true
		}
	}
	klog.V(2).Infof("RBAC Check - User: %s, OIDC Groups: %v, Resource: %s, Verb: %s, Cluster: %s, Namespace: %s, No Access",
		user.Key(), user.OIDCGroups, resource, verb, cluster, namespace)
	return false
}

// CanAccessCurrent checks the latest role configuration instead of the role
// snapshot attached during authentication. Anonymous access keeps using its
// built-in role.
func CanAccessCurrent(user model.User, resource, verb, cluster, namespace string) bool {
	if user.Username == model.AnonymousUser.Username && user.Provider == model.AnonymousUser.Provider {
		user.Roles = model.AnonymousUser.Roles
	} else {
		user.Roles = nil
	}
	return CanAccess(user, resource, verb, cluster, namespace)
}

// HasResourcePermission reports whether the user holds any role that grants
// `verb` on `resource` in `cluster`, regardless of namespace. It is used by
// the RBAC middleware to decide whether a cross-namespace LIST may pass
// through to the handler — the handler then filters items with the full
// resource permission so the user only sees objects they may access.
// Requiring a matching role here prevents zero-permission users from
// triggering list calls.
func HasResourcePermission(user model.User, resource, verb, cluster string) bool {
	roles := GetUserRoles(user)
	for _, role := range roles {
		if match(role.Clusters, cluster) &&
			match(role.Resources, resource) &&
			match(role.Verbs, verb) {
			return true
		}
	}
	return false
}

func CanAccessCluster(user model.User, name string) bool {
	roles := GetUserRoles(user)
	for _, role := range roles {
		if match(role.Clusters, name) {
			return true
		}
	}
	return false
}

func CanAccessNamespace(user model.User, cluster, name string) bool {
	roles := GetUserRoles(user)
	for _, role := range roles {
		if match(role.Clusters, cluster) && match(role.Namespaces, name) {
			return true
		}
	}
	return false
}

// GetUserRoles returns all roles for a user/oidcGroups
func GetUserRoles(user model.User) []common.Role {
	if user.Roles != nil {
		return user.Roles
	}
	rolesMap := make(map[string]common.Role)
	rwlock.RLock()
	defer rwlock.RUnlock()
	if RBACConfig == nil {
		return nil
	}
	for _, mapping := range RBACConfig.RoleMapping {
		if contains(mapping.Users, "*") || contains(mapping.Users, user.Key()) {
			if r := findRoleLocked(mapping.Name); r != nil {
				rolesMap[r.Name] = *r
			}
		}
		for _, group := range user.OIDCGroups {
			if contains(mapping.OIDCGroups, group) {
				if r := findRoleLocked(mapping.Name); r != nil {
					rolesMap[r.Name] = *r
				}
			}
		}
	}
	roles := make([]common.Role, 0, len(rolesMap))
	for _, role := range rolesMap {
		roles = append(roles, role)
	}
	return roles
}

func findRoleLocked(name string) *common.Role {
	for _, r := range RBACConfig.Roles {
		if r.Name == name {
			return &r
		}
	}
	return nil
}

func match(list []string, val string) bool {
	for _, pattern := range list {
		if len(pattern) > 1 && strings.HasPrefix(pattern, "!") && matchPattern(pattern[1:], val) {
			return false
		}
	}
	for _, pattern := range list {
		if strings.HasPrefix(pattern, "!") {
			continue
		}
		if matchPattern(pattern, val) {
			return true
		}
	}
	return false
}

func matchPattern(pattern, val string) bool {
	if pattern == "*" || pattern == val {
		return true
	}
	// Plain values are literals; dots are common in Kubernetes API group names.
	if !strings.ContainsAny(pattern, `\^$*+?()[]{}|`) {
		return false
	}
	re, err := regexp.Compile("^(?:" + pattern + ")$")
	if err != nil {
		klog.Error(err)
		return false
	}
	return re.MatchString(val)
}

func contains(list []string, val string) bool {
	return slices.Contains(list, val)
}

func NoAccess(user, verb, resource, ns, cluster string) string {
	if ns == "" {
		return fmt.Sprintf("user %s does not have permission to %s %s on cluster %s",
			user, verb, resource, cluster)
	}
	if ns == common.AllNamespaces {
		ns = "All"
	}
	return fmt.Sprintf("user %s does not have permission to %s %s in namespace %s on cluster %s",
		user, verb, resource, ns, cluster)
}

func UserHasRole(user model.User, roleName string) bool {
	roles := GetUserRoles(user)
	for _, role := range roles {
		if role.Name == roleName {
			return true
		}
	}
	return false
}
