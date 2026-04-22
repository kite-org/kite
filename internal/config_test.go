package internal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/handlers"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// setupTestDB initializes an in-memory SQLite database for testing.
// It returns a cleanup function that restores the original DB.
func setupTestDB(t *testing.T) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("failed to enable foreign keys: %v", err)
	}

	models := []any{
		model.User{},
		model.Cluster{},
		model.GeneralSetting{},
		model.LDAPSetting{},
		model.OAuthProvider{},
		model.Role{},
		model.RoleAssignment{},
	}
	for _, m := range models {
		if err := db.AutoMigrate(m); err != nil {
			t.Fatalf("failed to migrate: %v", err)
		}
	}

	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
}

// saveManagedSections saves and restores the global ManagedSections map.
func saveManagedSections(t *testing.T) {
	t.Helper()
	orig := common.ManagedSections
	common.ManagedSections = map[string]bool{}
	t.Cleanup(func() { common.ManagedSections = orig })
}

const testConfigYAML = `clusters:
  - name: prod
    description: "Production cluster"
    config: |
      apiVersion: v1
      kind: Config
      clusters:
        - cluster:
            server: https://k8s.example.com
          name: prod
    prometheusURL: "http://prom:9090"
    default: true
  - name: local
    inCluster: true

oauth:
  - name: google
    clientId: "test-client-id"
    clientSecret: "test-secret"
    issuer: "https://accounts.google.com"
    scopes: "openid,profile,email"
    usernameClaim: "email"
    enabled: true

ldap:
  enabled: true
  serverUrl: "ldaps://ldap.example.com:636"
  bindDn: "cn=admin,dc=example,dc=com"
  bindPassword: "test-bind-password"
  userBaseDn: "ou=users,dc=example,dc=com"
  userFilter: "(uid=%s)"
  groupBaseDn: "ou=groups,dc=example,dc=com"
  groupFilter: "(member=%s)"

rbac:
  roles:
    - name: admin
      description: "Full access"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["*"]
    - name: viewer
      description: "Read-only"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "log"]
    - name: dev-team
      description: "Dev team access"
      clusters: ["dev-*", "staging-*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "create", "update", "delete", "log"]
  roleMapping:
    - name: admin
      users: ["alice", "bob"]
      oidcGroups: ["platform-admins"]
    - name: viewer
      users: ["*"]
    - name: dev-team
      oidcGroups: ["developers"]
`

// TestLoadConfigFromFile_EndToEnd tests the full config file loading flow with a real database.
func TestLoadConfigFromFile_EndToEnd(t *testing.T) { //nolint:gocyclo // end-to-end test with multiple subtests
	setupTestDB(t)
	saveManagedSections(t)

	// Drain SyncNow so TriggerSync in applyRBAC doesn't block
	oldSyncNow := rbac.SyncNow
	rbac.SyncNow = make(chan struct{}, 10)
	t.Cleanup(func() { rbac.SyncNow = oldSyncNow })

	// Create system roles first (normally done by InitRBAC)
	if err := model.InitDefaultRole(); err != nil {
		t.Fatalf("InitDefaultRole: %v", err)
	}

	// Write config file to temp dir
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(testConfigYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// Load config
	LoadConfigFromFile(configPath)

	// --- Verify managed sections ---
	t.Run("ManagedSections", func(t *testing.T) {
		for _, section := range []string{"clusters", "oauth", "ldap", "rbac"} {
			if !common.IsSectionManaged(section) {
				t.Errorf("expected section %q to be managed", section)
			}
		}
	})

	// --- Verify clusters ---
	t.Run("Clusters", func(t *testing.T) {
		clusters, err := model.ListClusters()
		if err != nil {
			t.Fatalf("ListClusters: %v", err)
		}
		if len(clusters) != 2 {
			t.Fatalf("expected 2 clusters, got %d", len(clusters))
		}

		byName := map[string]*model.Cluster{}
		for _, c := range clusters {
			byName[c.Name] = c
		}

		prod := byName["prod"]
		if prod == nil {
			t.Fatal("prod cluster not found")
		}
		if prod.PrometheusURL != "http://prom:9090" {
			t.Errorf("prod prometheus URL = %q, want %q", prod.PrometheusURL, "http://prom:9090")
		}
		if !prod.IsDefault {
			t.Error("prod should be default")
		}
		if prod.Description != "Production cluster" {
			t.Errorf("prod description = %q", prod.Description)
		}

		local := byName["local"]
		if local == nil {
			t.Fatal("local cluster not found")
		}
		if !local.InCluster {
			t.Error("local should be inCluster")
		}
	})

	// --- Verify OAuth ---
	t.Run("OAuth", func(t *testing.T) {
		providers, err := model.GetAllOAuthProviders()
		if err != nil {
			t.Fatalf("GetAllOAuthProviders: %v", err)
		}
		if len(providers) != 1 {
			t.Fatalf("expected 1 OAuth provider, got %d", len(providers))
		}
		p := providers[0]
		if string(p.Name) != "google" {
			t.Errorf("provider name = %q, want %q", p.Name, "google")
		}
		if p.ClientID != "test-client-id" {
			t.Errorf("clientId = %q", p.ClientID)
		}
		if !p.Enabled {
			t.Error("provider should be enabled")
		}
		if p.Issuer != "https://accounts.google.com" {
			t.Errorf("issuer = %q", p.Issuer)
		}
		if p.UsernameClaim != "email" {
			t.Errorf("usernameClaim = %q", p.UsernameClaim)
		}
	})

	// --- Verify LDAP ---
	t.Run("LDAP", func(t *testing.T) {
		setting, err := model.GetLDAPSetting()
		if err != nil {
			t.Fatalf("GetLDAPSetting: %v", err)
		}
		if !setting.Enabled {
			t.Error("LDAP should be enabled")
		}
		if setting.ServerURL != "ldaps://ldap.example.com:636" {
			t.Errorf("serverUrl = %q", setting.ServerURL)
		}
		if setting.BindDN != "cn=admin,dc=example,dc=com" {
			t.Errorf("bindDn = %q", setting.BindDN)
		}
		if setting.UserBaseDN != "ou=users,dc=example,dc=com" {
			t.Errorf("userBaseDn = %q", setting.UserBaseDN)
		}
		if setting.GroupBaseDN != "ou=groups,dc=example,dc=com" {
			t.Errorf("groupBaseDn = %q", setting.GroupBaseDN)
		}
	})

	// --- Verify RBAC roles ---
	t.Run("RBAC_Roles", func(t *testing.T) {
		var roles []model.Role
		if err := model.DB.Find(&roles).Error; err != nil {
			t.Fatalf("Find roles: %v", err)
		}
		if len(roles) != 3 {
			t.Fatalf("expected 3 roles, got %d", len(roles))
		}
		byName := map[string]model.Role{}
		for _, r := range roles {
			byName[r.Name] = r
		}

		admin := byName["admin"]
		if admin.Description != "Full access" {
			t.Errorf("admin description = %q", admin.Description)
		}
		if !admin.IsSystem {
			t.Error("admin should still be system role")
		}

		viewer := byName["viewer"]
		if viewer.Description != "Read-only" {
			t.Errorf("viewer description = %q", viewer.Description)
		}

		devTeam := byName["dev-team"]
		if devTeam.Description != "Dev team access" {
			t.Errorf("dev-team description = %q", devTeam.Description)
		}
	})

	// --- Verify RBAC role assignments ---
	t.Run("RBAC_Assignments", func(t *testing.T) {
		var assignments []model.RoleAssignment
		if err := model.DB.Find(&assignments).Error; err != nil {
			t.Fatalf("Find assignments: %v", err)
		}
		// admin: alice, bob (users) + platform-admins (group) = 3
		// viewer: * (user) = 1
		// dev-team: developers (group) = 1
		// Total = 5
		if len(assignments) != 5 {
			t.Fatalf("expected 5 assignments, got %d", len(assignments))
		}
	})
}

// TestLoadConfigFromFile_EnvExpansion tests ${ENV_VAR} placeholder expansion.
func TestLoadConfigFromFile_EnvExpansion(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	t.Setenv("TEST_OAUTH_SECRET", "expanded-secret-value")

	configYAML := `oauth:
  - name: test-provider
    clientId: "my-client"
    clientSecret: "${TEST_OAUTH_SECRET}"
    issuer: "https://example.com"
    enabled: true
`

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	LoadConfigFromFile(configPath)

	providers, err := model.GetAllOAuthProviders()
	if err != nil {
		t.Fatalf("GetAllOAuthProviders: %v", err)
	}
	if len(providers) != 1 {
		t.Fatalf("expected 1 provider, got %d", len(providers))
	}
	if string(providers[0].ClientSecret) != "expanded-secret-value" {
		t.Errorf("clientSecret = %q, want %q", providers[0].ClientSecret, "expanded-secret-value")
	}
}

// TestLoadConfigFromFile_PartialConfig tests that only configured sections become managed.
func TestLoadConfigFromFile_PartialConfig(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	// Only clusters section
	configYAML := `clusters:
  - name: test-only
    inCluster: true
`
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	LoadConfigFromFile(configPath)

	if !common.IsSectionManaged("clusters") {
		t.Error("clusters should be managed")
	}
	for _, section := range []string{"oauth", "ldap", "rbac"} {
		if common.IsSectionManaged(section) {
			t.Errorf("section %q should NOT be managed", section)
		}
	}
}

// TestLoadConfigFromFile_EmptyPath tests that empty path is a no-op.
func TestLoadConfigFromFile_EmptyPath(t *testing.T) {
	saveManagedSections(t)

	LoadConfigFromFile("")

	for _, section := range []string{"clusters", "oauth", "ldap", "rbac"} {
		if common.IsSectionManaged(section) {
			t.Errorf("section %q should NOT be managed with empty path", section)
		}
	}
}

// TestLoadConfigFromFile_StartupOverwrite tests that config file overwrites existing DB data.
func TestLoadConfigFromFile_StartupOverwrite(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	// Pre-populate with an existing cluster
	existing := &model.Cluster{
		Name:      "old-cluster",
		InCluster: true,
		Enable:    true,
	}
	if err := model.AddCluster(existing); err != nil {
		t.Fatalf("AddCluster: %v", err)
	}

	configYAML := `clusters:
  - name: new-cluster
    inCluster: true
`
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	LoadConfigFromFile(configPath)

	clusters, _ := model.ListClusters()
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster after overwrite, got %d", len(clusters))
	}
	if clusters[0].Name != "new-cluster" {
		t.Errorf("cluster name = %q, want %q", clusters[0].Name, "new-cluster")
	}
}

// TestInitCheckWithManagedClusters tests that InitCheck returns initialized=true
// when clusters are managed AND a user exists.
func TestInitCheckWithManagedClusters(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)
	common.ManagedSections["clusters"] = true

	// Drain SyncNow so TriggerSync doesn't block
	oldSyncNow := rbac.SyncNow
	rbac.SyncNow = make(chan struct{}, 10)
	t.Cleanup(func() { rbac.SyncNow = oldSyncNow })

	// Create a user so InitCheck considers step 1 (user) done
	if err := model.InitDefaultRole(); err != nil {
		t.Fatalf("InitDefaultRole: %v", err)
	}
	if err := model.AddSuperUser(&model.User{Username: "admin", Password: "pass"}); err != nil {
		t.Fatalf("AddSuperUser: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/init_check", handlers.InitCheck)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/init_check", nil)
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if init, ok := result["initialized"].(bool); !ok || !init {
		t.Errorf("initialized = %v, want true", result["initialized"])
	}
	if step, ok := result["step"].(float64); !ok || step != 2 {
		t.Errorf("step = %v, want 2", result["step"])
	}
}

// TestInitCheckWithManagedClustersNoUsers tests that InitCheck returns initialized=false
// when clusters are managed but no user exists.
func TestInitCheckWithManagedClustersNoUsers(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)
	common.ManagedSections["clusters"] = true

	// Save and restore AnonymousUserEnabled
	origAnon := common.AnonymousUserEnabled
	common.AnonymousUserEnabled = false
	t.Cleanup(func() { common.AnonymousUserEnabled = origAnon })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/init_check", handlers.InitCheck)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/init_check", nil)
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if init, ok := result["initialized"].(bool); !ok || init {
		t.Errorf("initialized = %v, want false (no users)", result["initialized"])
	}
	if step, ok := result["step"].(float64); !ok || step != 0 {
		t.Errorf("step = %v, want 0 (no users)", result["step"])
	}
}

// TestLoadConfigFromFile_SuperUser tests that superUser is created on first startup.
func TestLoadConfigFromFile_SuperUser(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	// Drain SyncNow so TriggerSync doesn't block
	oldSyncNow := rbac.SyncNow
	rbac.SyncNow = make(chan struct{}, 10)
	t.Cleanup(func() { rbac.SyncNow = oldSyncNow })

	// Create system roles (needed for AddSuperUser -> AddRoleAssignment)
	if err := model.InitDefaultRole(); err != nil {
		t.Fatalf("InitDefaultRole: %v", err)
	}

	configYAML := `superUser:
  username: "testadmin"
  password: "testpass123"
clusters:
  - name: test
    inCluster: true
`
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	LoadConfigFromFile(configPath)

	// Verify super user was created
	uc, _ := model.CountUsers()
	if uc != 1 {
		t.Fatalf("expected 1 user, got %d", uc)
	}

	user, err := model.GetUserByUsername("testadmin")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if user.Username != "testadmin" {
		t.Errorf("username = %q, want %q", user.Username, "testadmin")
	}
}

// TestLoadConfigFromFile_SuperUserUpdatesPassword tests that superUser password is updated on restart.
func TestLoadConfigFromFile_SuperUserUpdatesPassword(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	oldSyncNow := rbac.SyncNow
	rbac.SyncNow = make(chan struct{}, 10)
	t.Cleanup(func() { rbac.SyncNow = oldSyncNow })

	if err := model.InitDefaultRole(); err != nil {
		t.Fatalf("InitDefaultRole: %v", err)
	}

	// First startup: create the super user
	configYAML := `superUser:
  username: "myadmin"
  password: "old-password"
`
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	LoadConfigFromFile(configPath)

	// Second startup: update the password
	configYAML2 := `superUser:
  username: "myadmin"
  password: "new-password"
`
	if err := os.WriteFile(configPath, []byte(configYAML2), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	LoadConfigFromFile(configPath)

	// Should still be only 1 user
	uc, _ := model.CountUsers()
	if uc != 1 {
		t.Fatalf("expected 1 user, got %d", uc)
	}

	// Verify the password was updated (can login with new password)
	user, err := model.GetUserByUsername("myadmin")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if !utils.CheckPasswordHash("new-password", user.Password) {
		t.Error("password should have been updated to new-password")
	}
}

// TestLoadConfigFromFile_SuperUserWithRBAC tests that superUser retains admin role
// even when RBAC roleMapping doesn't explicitly include the superUser.
func TestLoadConfigFromFile_SuperUserWithRBAC(t *testing.T) {
	setupTestDB(t)
	saveManagedSections(t)

	oldSyncNow := rbac.SyncNow
	rbac.SyncNow = make(chan struct{}, 10)
	t.Cleanup(func() { rbac.SyncNow = oldSyncNow })

	if err := model.InitDefaultRole(); err != nil {
		t.Fatalf("InitDefaultRole: %v", err)
	}

	// Config with superUser + RBAC, but roleMapping does NOT include the superUser
	configYAML := `superUser:
  username: "myadmin"
  password: "mypass"
rbac:
  roles:
    - name: admin
      description: "Full access"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["*"]
    - name: viewer
      description: "Read-only"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "log"]
  roleMapping:
    - name: viewer
      users: ["*"]
`
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	LoadConfigFromFile(configPath)

	// Verify the super user was created
	user, err := model.GetUserByUsername("myadmin")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if user.Username != "myadmin" {
		t.Errorf("username = %q", user.Username)
	}

	// Verify the super user has the admin role assignment
	// (superUser is applied AFTER RBAC, so it shouldn't be wiped)
	adminRole, err := model.GetRoleByName("admin")
	if err != nil {
		t.Fatalf("GetRoleByName(admin): %v", err)
	}

	var assignment model.RoleAssignment
	err = model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?",
		adminRole.ID, model.SubjectTypeUser, "myadmin").First(&assignment).Error
	if err != nil {
		t.Fatalf("super user should have admin role assignment, but got: %v", err)
	}

	// Simulate second startup: applyRBAC wipes all assignments, then applySuperUser
	// must re-create the admin role assignment.
	LoadConfigFromFile(configPath)

	var assignment2 model.RoleAssignment
	err = model.DB.Where("role_id = ? AND subject_type = ? AND subject = ?",
		adminRole.ID, model.SubjectTypeUser, "myadmin").First(&assignment2).Error
	if err != nil {
		t.Fatalf("after second startup, super user should still have admin role, but got: %v", err)
	}
}
