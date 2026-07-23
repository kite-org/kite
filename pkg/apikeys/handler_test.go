package apikeys

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/auth"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestAPIKeyLifecycleControlsAuthentication(t *testing.T) {
	setupAPIKeyTestDB(t)
	passwordUser := model.User{Username: "person", Provider: model.AuthProviderPassword, Enabled: true}
	if err := model.DB.Create(&passwordUser).Error; err != nil {
		t.Fatalf("creating password user: %v", err)
	}

	router := gin.New()
	router.POST("/apikeys", CreateAPIKey)
	router.GET("/apikeys", ListAPIKeys)
	router.DELETE("/apikeys/:id", DeleteAPIKey)

	createResponse := performAPIKeyRequest(router, http.MethodPost, "/apikeys", `{"name":"ci-deploy"}`)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", createResponse.Code, http.StatusCreated, createResponse.Body.String())
	}
	var created struct {
		APIKey model.User `json:"apiKey"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatalf("decoding create response: %v", err)
	}
	if created.APIKey.ID == 0 || created.APIKey.Provider != common.APIKeyProvider || len(created.APIKey.APIKey) != 32 {
		t.Fatalf("created API key = %#v", created.APIKey)
	}

	listResponse := performAPIKeyRequest(router, http.MethodGet, "/apikeys", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d: %s", listResponse.Code, http.StatusOK, listResponse.Body.String())
	}
	var listed struct {
		APIKeys []model.User `json:"apiKeys"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decoding list response: %v", err)
	}
	if len(listed.APIKeys) != 1 || listed.APIKeys[0].ID != created.APIKey.ID {
		t.Fatalf("listed API keys = %#v", listed.APIKeys)
	}
	fullKey := string(listed.APIKeys[0].APIKey)
	wantPrefix := fmt.Sprintf("kite%d-", created.APIKey.ID)
	if !strings.HasPrefix(fullKey, wantPrefix) || !strings.HasSuffix(fullKey, string(created.APIKey.APIKey)) {
		t.Fatalf("listed API key = %q, want prefix %q and created secret", fullKey, wantPrefix)
	}

	authHandler := auth.NewAuthHandler()
	authRecorder := httptest.NewRecorder()
	authContext, _ := gin.CreateTestContext(authRecorder)
	authContext.Request = httptest.NewRequest(http.MethodGet, "/protected", nil)
	authHandler.RequireAPIKeyAuth(authContext, strings.TrimPrefix(fullKey, "kite"))
	if authContext.IsAborted() {
		t.Fatalf("created API key was rejected: %s", authRecorder.Body.String())
	}
	authenticated, exists := authContext.Get("user")
	if !exists || authenticated.(model.User).ID != created.APIKey.ID {
		t.Fatalf("authenticated user = %#v", authenticated)
	}

	deleteResponse := performAPIKeyRequest(router, http.MethodDelete, fmt.Sprintf("/apikeys/%d", created.APIKey.ID), "")
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d: %s", deleteResponse.Code, http.StatusOK, deleteResponse.Body.String())
	}

	rejectedRecorder := httptest.NewRecorder()
	rejectedContext, _ := gin.CreateTestContext(rejectedRecorder)
	rejectedContext.Request = httptest.NewRequest(http.MethodGet, "/protected", nil)
	authHandler.RequireAPIKeyAuth(rejectedContext, strings.TrimPrefix(fullKey, "kite"))
	if !rejectedContext.IsAborted() || rejectedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("deleted API key authentication status = %d, aborted=%v", rejectedRecorder.Code, rejectedContext.IsAborted())
	}
}

func TestDeleteAPIKeyRejectsInvalidID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.DELETE("/apikeys/:id", DeleteAPIKey)

	response := performAPIKeyRequest(router, http.MethodDelete, "/apikeys/not-a-number", "")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func setupAPIKeyTestDB(t *testing.T) {
	t.Helper()
	originalDB := model.DB
	originalEncryptKey := common.KiteEncryptKey
	common.KiteEncryptKey = "apikey-handler-test-key"
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.Role{}, &model.RoleAssignment{}, &model.ResourceHistory{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		common.KiteEncryptKey = originalEncryptKey
	})
}

func performAPIKeyRequest(router *gin.Engine, method string, path string, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	router.ServeHTTP(recorder, request)
	return recorder
}
