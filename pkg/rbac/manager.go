package rbac

import (
	"fmt"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

var (
	RBACConfig *common.RolesConfig
	once       sync.Once
	rwlock     sync.RWMutex
)

func InitRBAC() {
	once.Do(func() {
		if err := model.InitDefaultRole(); err != nil {
			panic(fmt.Sprintf("failed to init default roles: %v", err))
		}
		go SyncRolesConfig()
	})
}

// loadRolesFromDB populates RBACConfig from DB rows
func loadRolesFromDB() error {
	cfg := &common.RolesConfig{
		Roles:       []common.Role{},
		RoleMapping: []common.RoleMapping{},
	}

	var roles []model.Role
	if err := model.DB.Preload("Assignments").Find(&roles).Error; err != nil {
		return err
	}

	for _, r := range roles {
		cr := common.Role{
			Name:        r.Name,
			Description: r.Description,
			Clusters:    r.Clusters,
			Namespaces:  r.Namespaces,
			Resources:   r.Resources,
			Verbs:       r.Verbs,
		}
		cfg.Roles = append(cfg.Roles, cr)

		for _, a := range r.Assignments {
			rm := common.RoleMapping{
				Name: cr.Name,
			}
			if a.SubjectType == model.SubjectTypeUser {
				rm.Users = append(rm.Users, a.Subject)
			} else {
				rm.OIDCGroups = append(rm.OIDCGroups, a.Subject)
			}
			cfg.RoleMapping = append(cfg.RoleMapping, rm)
		}
	}
	rwlock.Lock()
	RBACConfig = cfg
	rwlock.Unlock()
	return nil
}

var (
	SyncNow = make(chan struct{}, 1)
)

// TriggerSync sends a non-blocking signal to refresh RBAC config from the database.
func TriggerSync() {
	select {
	case SyncNow <- struct{}{}:
	default:
	}
}

func SyncRolesConfig() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	TriggerSync()
	for {
		select {
		case <-ticker.C:
		case <-SyncNow:
		}
		if err := loadRolesFromDB(); err != nil {
			klog.Errorf("failed to sync rbac from db: %v", err)
		}
	}
}
