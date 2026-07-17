package rbac

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
)

func TestLoadRolesFromDB(t *testing.T) {
	originalDB := model.DB
	rwlock.RLock()
	originalConfig := RBACConfig
	rwlock.RUnlock()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		model.DB = originalDB
		rwlock.Lock()
		RBACConfig = originalConfig
		rwlock.Unlock()
		_ = sqlDB.Close()
	})

	if err := db.AutoMigrate(&model.Role{}, &model.RoleAssignment{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	role := model.Role{
		Name:       "pod-reader",
		Clusters:   model.SliceString{"prod"},
		Namespaces: model.SliceString{"default"},
		Resources:  model.SliceString{"pods"},
		Verbs:      model.SliceString{"get"},
	}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("create role: %v", err)
	}
	assignments := []model.RoleAssignment{
		{RoleID: role.ID, SubjectType: model.SubjectTypeUser, Subject: "alice"},
		{RoleID: role.ID, SubjectType: model.SubjectTypeGroup, Subject: "developers"},
	}
	if err := db.Create(&assignments).Error; err != nil {
		t.Fatalf("create assignments: %v", err)
	}

	model.DB = db
	if err := loadRolesFromDB(); err != nil {
		t.Fatalf("load roles: %v", err)
	}

	rwlock.RLock()
	config := RBACConfig
	rwlock.RUnlock()
	if config == nil || len(config.Roles) != 1 || len(config.RoleMapping) != 2 {
		t.Fatalf("loaded config = %#v, want one role and two mappings", config)
	}
	if !CanAccess(model.User{Username: "alice"}, "pods", "get", "prod", "default") {
		t.Fatal("expected user assignment to grant access")
	}
	if !CanAccess(model.User{Username: "bob", OIDCGroups: []string{"developers"}}, "pods", "get", "prod", "default") {
		t.Fatal("expected group assignment to grant access")
	}
}
