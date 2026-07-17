package rbac

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRoleHandlers(t *testing.T) { //nolint:gocyclo // handler lifecycle test with multiple subtests
	originalDB := model.DB
	originalManagedSections := common.ManagedSections
	originalSyncNow := SyncNow
	originalGinMode := gin.Mode()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	common.SetManagedSections(map[string]bool{})
	SyncNow = make(chan struct{}, 16)
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		model.DB = originalDB
		common.SetManagedSections(originalManagedSections)
		SyncNow = originalSyncNow
		gin.SetMode(originalGinMode)
		_ = sqlDB.Close()
	})

	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := db.AutoMigrate(&model.Role{}, &model.RoleAssignment{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	router := gin.New()
	router.GET("/roles", ListRoles)
	router.GET("/roles/:id", GetRole)
	router.POST("/roles", CreateRole)
	router.PUT("/roles/:id", UpdateRole)
	router.DELETE("/roles/:id", DeleteRole)
	router.POST("/roles/:id/assign", AssignRole)
	router.DELETE("/roles/:id/assign", UnassignRole)

	perform := func(method, path, body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		router.ServeHTTP(response, request)
		return response
	}

	t.Run("ordinary role lifecycle", func(t *testing.T) {
		response := perform(http.MethodPost, "/roles", `{"name":" developer ","description":"initial","clusters":["prod"],"namespaces":["default"],"resources":["pods"],"verbs":["get"]}`)
		if response.Code != http.StatusCreated {
			t.Fatalf("create returned %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
		}
		var created struct {
			Role model.Role `json:"role"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
			t.Fatalf("decode create response: %v", err)
		}
		if created.Role.ID == 0 || created.Role.Name != "developer" {
			t.Fatalf("created role = %#v", created.Role)
		}
		rolePath := "/roles/" + strconv.FormatUint(uint64(created.Role.ID), 10)

		response = perform(http.MethodGet, "/roles", "")
		if response.Code != http.StatusOK {
			t.Fatalf("list returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		var listed struct {
			Roles []model.Role `json:"roles"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
			t.Fatalf("decode list response: %v", err)
		}
		if len(listed.Roles) != 1 || listed.Roles[0].ID != created.Role.ID {
			t.Fatalf("listed roles = %#v", listed.Roles)
		}

		response = perform(http.MethodGet, rolePath, "")
		if response.Code != http.StatusOK {
			t.Fatalf("get returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}

		response = perform(http.MethodPut, rolePath, `{"name":"developer-updated","description":"updated","clusters":["prod"],"namespaces":["team-a"],"resources":["deployments"],"verbs":["get","update"]}`)
		if response.Code != http.StatusOK {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		var updated struct {
			Role model.Role `json:"role"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode update response: %v", err)
		}
		if updated.Role.Name != "developer-updated" || updated.Role.Description != "updated" {
			t.Fatalf("updated role = %#v", updated.Role)
		}

		userAssignment := `{"subjectType":"user","subject":"alice"}`
		response = perform(http.MethodPost, rolePath+"/assign", userAssignment)
		if response.Code != http.StatusCreated {
			t.Fatalf("assign user returned %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
		}
		response = perform(http.MethodPost, rolePath+"/assign", userAssignment)
		if response.Code != http.StatusOK {
			t.Fatalf("duplicate assignment returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		response = perform(http.MethodPost, rolePath+"/assign", `{"subjectType":"group","subject":"developers"}`)
		if response.Code != http.StatusCreated {
			t.Fatalf("assign group returned %d, want %d; body=%s", response.Code, http.StatusCreated, response.Body.String())
		}
		var assignmentCount int64
		if err := db.Model(&model.RoleAssignment{}).Where("role_id = ?", created.Role.ID).Count(&assignmentCount).Error; err != nil {
			t.Fatalf("count assignments: %v", err)
		}
		if assignmentCount != 2 {
			t.Fatalf("assignment count = %d, want 2", assignmentCount)
		}

		response = perform(http.MethodDelete, rolePath+"/assign?subjectType=user&subject=alice", "")
		if response.Code != http.StatusOK {
			t.Fatalf("unassign returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		if err := db.Model(&model.RoleAssignment{}).Where("role_id = ?", created.Role.ID).Count(&assignmentCount).Error; err != nil {
			t.Fatalf("count assignments after unassign: %v", err)
		}
		if assignmentCount != 1 {
			t.Fatalf("assignment count after unassign = %d, want 1", assignmentCount)
		}

		response = perform(http.MethodDelete, rolePath, "")
		if response.Code != http.StatusOK {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
		}
		if err := db.Model(&model.RoleAssignment{}).Where("role_id = ?", created.Role.ID).Count(&assignmentCount).Error; err != nil {
			t.Fatalf("count assignments after role delete: %v", err)
		}
		if assignmentCount != 0 {
			t.Fatalf("assignment count after role delete = %d, want 0", assignmentCount)
		}
		response = perform(http.MethodGet, rolePath, "")
		if response.Code != http.StatusNotFound {
			t.Fatalf("get deleted role returned %d, want %d; body=%s", response.Code, http.StatusNotFound, response.Body.String())
		}
	})

	t.Run("managed rbac rejects mutations", func(t *testing.T) {
		common.SetManagedSections(map[string]bool{"rbac": true})
		defer common.SetManagedSections(map[string]bool{})

		var roleCountBefore, assignmentCountBefore int64
		if err := db.Model(&model.Role{}).Count(&roleCountBefore).Error; err != nil {
			t.Fatalf("count roles: %v", err)
		}
		if err := db.Model(&model.RoleAssignment{}).Count(&assignmentCountBefore).Error; err != nil {
			t.Fatalf("count assignments: %v", err)
		}

		tests := []struct {
			name   string
			method string
			path   string
			body   string
		}{
			{name: "create", method: http.MethodPost, path: "/roles", body: `{"name":"blocked"}`},
			{name: "update", method: http.MethodPut, path: "/roles/1", body: `{"name":"blocked"}`},
			{name: "delete", method: http.MethodDelete, path: "/roles/1"},
			{name: "assign", method: http.MethodPost, path: "/roles/1/assign", body: `{"subjectType":"user","subject":"alice"}`},
			{name: "unassign", method: http.MethodDelete, path: "/roles/1/assign?subjectType=user&subject=alice"},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				response := perform(test.method, test.path, test.body)
				if response.Code != http.StatusForbidden {
					t.Fatalf("returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
				}
			})
		}

		var roleCountAfter, assignmentCountAfter int64
		if err := db.Model(&model.Role{}).Count(&roleCountAfter).Error; err != nil {
			t.Fatalf("count roles after requests: %v", err)
		}
		if err := db.Model(&model.RoleAssignment{}).Count(&assignmentCountAfter).Error; err != nil {
			t.Fatalf("count assignments after requests: %v", err)
		}
		if roleCountAfter != roleCountBefore || assignmentCountAfter != assignmentCountBefore {
			t.Fatalf("managed requests changed database: roles %d -> %d, assignments %d -> %d", roleCountBefore, roleCountAfter, assignmentCountBefore, assignmentCountAfter)
		}
	})

	t.Run("system roles cannot be updated or deleted", func(t *testing.T) {
		systemRole := model.Role{
			Name:        "admin",
			Description: "system role",
			IsSystem:    true,
			Clusters:    model.SliceString{"*"},
			Namespaces:  model.SliceString{"*"},
			Resources:   model.SliceString{"*"},
			Verbs:       model.SliceString{"*"},
		}
		if err := db.Create(&systemRole).Error; err != nil {
			t.Fatalf("create system role: %v", err)
		}
		rolePath := "/roles/" + strconv.FormatUint(uint64(systemRole.ID), 10)

		response := perform(http.MethodPut, rolePath, `{"name":"changed","description":"changed","clusters":["dev"],"namespaces":["dev"],"resources":["pods"],"verbs":["get"]}`)
		if response.Code != http.StatusForbidden {
			t.Fatalf("update returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}
		response = perform(http.MethodDelete, rolePath, "")
		if response.Code != http.StatusForbidden {
			t.Fatalf("delete returned %d, want %d; body=%s", response.Code, http.StatusForbidden, response.Body.String())
		}

		var stored model.Role
		if err := db.First(&stored, systemRole.ID).Error; err != nil {
			t.Fatalf("load system role: %v", err)
		}
		if stored.Name != systemRole.Name || stored.Description != systemRole.Description || !stored.IsSystem {
			t.Fatalf("system role changed: %#v", stored)
		}
	})
}
