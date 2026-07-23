package cluster

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestClusterConfigurationLifecyclePreservesSecretsAndDefault(t *testing.T) {
	setupClusterHandlerTestDB(t)
	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)
	router.GET("/clusters", manager.GetClusterList)
	router.PUT("/clusters/:id", manager.UpdateCluster)
	router.DELETE("/clusters/:id", manager.DeleteCluster)

	create := performClusterRequest(router, http.MethodPost, "/clusters", `{"name":"primary","description":"main","config":"secret-kubeconfig","isDefault":true}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", create.Code, http.StatusCreated, create.Body.String())
	}
	primary, err := model.GetClusterByName("primary")
	if err != nil {
		t.Fatalf("loading created cluster: %v", err)
	}
	if !primary.IsDefault || !primary.Enable || string(primary.Config) != "secret-kubeconfig" {
		t.Fatalf("created cluster = %#v", primary)
	}

	updateBody := `{"name":"renamed","description":"updated","config":"","prometheusURL":"https://prom.example.com","isDefault":true,"enabled":true}`
	update := performClusterRequest(router, http.MethodPut, fmt.Sprintf("/clusters/%d", primary.ID), updateBody)
	if update.Code != http.StatusOK {
		t.Fatalf("update status = %d, want %d: %s", update.Code, http.StatusOK, update.Body.String())
	}
	updated, err := model.GetClusterByID(primary.ID)
	if err != nil {
		t.Fatalf("loading updated cluster: %v", err)
	}
	if updated.Name != "renamed" || updated.Description != "updated" || updated.PrometheusURL != "https://prom.example.com" {
		t.Fatalf("updated cluster = %#v", updated)
	}
	if string(updated.Config) != "secret-kubeconfig" {
		t.Fatalf("blank update erased kubeconfig: %q", updated.Config)
	}

	manager.mu.Lock()
	manager.clusters["renamed"] = &ClientSet{Name: "renamed", Version: "v1.36.2"}
	manager.mu.Unlock()
	list := performClusterRequest(router, http.MethodGet, "/clusters", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d", list.Code, http.StatusOK)
	}
	var listed []map[string]any
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decoding list response: %v", err)
	}
	if len(listed) != 1 || listed[0]["config"] != "" || listed[0]["version"] != "v1.36.2" {
		t.Fatalf("listed clusters = %#v", listed)
	}
	if strings.Contains(list.Body.String(), "secret-kubeconfig") {
		t.Fatal("cluster list exposed kubeconfig")
	}

	deleteDefault := performClusterRequest(router, http.MethodDelete, fmt.Sprintf("/clusters/%d", primary.ID), "")
	if deleteDefault.Code != http.StatusBadRequest {
		t.Fatalf("default delete status = %d, want %d", deleteDefault.Code, http.StatusBadRequest)
	}

	secondary := &model.Cluster{Name: "secondary", Config: "secondary-config", Enable: true}
	if err := model.AddCluster(secondary); err != nil {
		t.Fatalf("creating secondary cluster: %v", err)
	}
	deleteSecondary := performClusterRequest(router, http.MethodDelete, fmt.Sprintf("/clusters/%d", secondary.ID), "")
	if deleteSecondary.Code != http.StatusOK {
		t.Fatalf("secondary delete status = %d, want %d: %s", deleteSecondary.Code, http.StatusOK, deleteSecondary.Body.String())
	}
	if _, err := model.GetClusterByID(secondary.ID); err == nil {
		t.Fatal("deleted secondary cluster still exists")
	}
}

func TestGetClustersFiltersByAccessAndSortsFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := &ClusterManager{
		clusters: map[string]*ClientSet{
			"secret": {Name: "secret", Version: "v1.35.0"},
			"public": {Name: "public", Version: "v1.36.0"},
		},
		errors:         map[string]string{"broken": "invalid kubeconfig", "hidden-error": "timeout"},
		defaultContext: "public",
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/clusters", nil)
	ctx.Set("user", model.User{Username: "alice", Roles: []common.Role{{
		Name:     "limited",
		Clusters: []string{"public", "broken"},
	}}})

	manager.GetClusters(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var result []common.ClusterInfo
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(result) != 2 || result[0].Name != "broken" || result[1].Name != "public" {
		t.Fatalf("clusters = %#v", result)
	}
	if result[0].Error != "invalid kubeconfig" || !result[1].IsDefault {
		t.Fatalf("cluster metadata = %#v", result)
	}
}

func TestClusterMutationsHonorManagedConfiguration(t *testing.T) {
	setupClusterHandlerTestDB(t)
	common.SetManagedSections(map[string]bool{"clusters": true})
	manager := &ClusterManager{clusters: map[string]*ClientSet{}, errors: map[string]string{}}
	router := gin.New()
	router.POST("/clusters", manager.CreateCluster)

	response := performClusterRequest(router, http.MethodPost, "/clusters", `{"name":"blocked","config":"secret"}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	var count int64
	if err := model.DB.Model(&model.Cluster{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("managed mutation persisted clusters: count=%d err=%v", count, err)
	}
}

func setupClusterHandlerTestDB(t *testing.T) {
	t.Helper()
	originalDB := model.DB
	originalEncryptKey := common.KiteEncryptKey
	originalManagedSections := make(map[string]bool, len(common.ManagedSections))
	for section, managed := range common.ManagedSections {
		originalManagedSections[section] = managed
	}
	common.KiteEncryptKey = "cluster-handler-test-key"
	common.SetManagedSections(nil)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.Cluster{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		select {
		case <-syncNow:
		default:
		}
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		common.KiteEncryptKey = originalEncryptKey
		common.SetManagedSections(originalManagedSections)
	})
}

func performClusterRequest(router *gin.Engine, method string, path string, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	router.ServeHTTP(recorder, request)
	return recorder
}
