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
			klog.V(1).Infof("RBAC Check - User: %s, OIDC Groups: %v, Resource: %s, Verb: %s, Cluster: %s, Namespace: %s, Hit Role: %v",
				user.Key(), user.OIDCGroups, resource, verb, cluster, namespace, role.Name)
			return true
		}
	}
	klog.V(1).Infof("RBAC Check - User: %s, OIDC Groups: %v, Resource: %s, Verb: %s, Cluster: %s, Namespace: %s, No Access",
		user.Key(), user.OIDCGroups, resource, verb, cluster, namespace)
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
