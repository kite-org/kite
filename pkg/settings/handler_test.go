package settings

import (
	"encoding/json"
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

func TestGeneralSettingHandlersDoNotExposeOrEraseAPIKey(t *testing.T) {
	setupGeneralSettingTestDB(t, "existing-secret")
	router := generalSettingTestRouter()

	getResponse := performGeneralSettingRequest(t, router, http.MethodGet, "")
	if getResponse.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d: %s", getResponse.Code, http.StatusOK, getResponse.Body.String())
	}
	getBody := decodeGeneralSettingResponse(t, getResponse)
	if getBody["aiApiKey"] != "" || getBody["aiApiKeyConfigured"] != true {
		t.Fatalf("GET API key fields = %#v", getBody)
	}
	if strings.Contains(getResponse.Body.String(), "existing-secret") {
		t.Fatal("GET response exposed the stored API key")
	}

	updateBody := `{"aiAgentEnabled":true,"aiProvider":" Anthropic ","aiModel":"","aiApiKey":"  "}`
	updateResponse := performGeneralSettingRequest(t, router, http.MethodPut, updateBody)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d: %s", updateResponse.Code, http.StatusOK, updateResponse.Body.String())
	}
	responseBody := decodeGeneralSettingResponse(t, updateResponse)
	if responseBody["aiApiKey"] != "" || responseBody["aiApiKeyConfigured"] != true {
		t.Fatalf("PUT API key fields = %#v", responseBody)
	}
	if responseBody["aiProvider"] != model.GeneralAIProviderAnthropic {
		t.Fatalf("aiProvider = %q, want %q", responseBody["aiProvider"], model.GeneralAIProviderAnthropic)
	}
	if responseBody["aiModel"] != model.DefaultGeneralAnthropicModel {
		t.Fatalf("aiModel = %q, want %q", responseBody["aiModel"], model.DefaultGeneralAnthropicModel)
	}
	if strings.Contains(updateResponse.Body.String(), "existing-secret") {
		t.Fatal("PUT response exposed the stored API key")
	}

	var stored model.GeneralSetting
	if err := model.DB.First(&stored, 1).Error; err != nil {
		t.Fatalf("loading stored setting: %v", err)
	}
	if stored.AIAPIKey != model.SecretString("existing-secret") {
		t.Fatalf("stored API key = %q, want preserved value", stored.AIAPIKey)
	}
}

func TestHandleUpdateGeneralSettingRejectsUnsafeAIConfiguration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name      string
		apiKey    string
		body      string
		wantError string
	}{
		{
			name:      "unsupported provider",
			apiKey:    "existing-secret",
			body:      `{"aiProvider":"gemini"}`,
			wantError: "Unsupported aiProvider",
		},
		{
			name:      "agent without API key",
			body:      `{"aiAgentEnabled":true}`,
			wantError: "aiApiKey is required when aiAgentEnabled is true",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupGeneralSettingTestDB(t, tt.apiKey)
			response := performGeneralSettingRequest(t, generalSettingTestRouter(), http.MethodPut, tt.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			body := decodeGeneralSettingResponse(t, response)
			if body["error"] != tt.wantError {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
			}
		})
	}
}

func setupGeneralSettingTestDB(t *testing.T, apiKey string) {
	t.Helper()
	originalDB := model.DB
	originalEncryptKey := common.KiteEncryptKey
	originalJWTSecret := common.JwtSecret
	originalAnalytics := common.EnableAnalytics
	originalVersionCheck := common.EnableVersionCheck

	common.KiteEncryptKey = "settings-handler-test-key"
	common.JwtSecret = "settings-handler-test-jwt-secret"
	common.EnableAnalytics = false
	common.EnableVersionCheck = true

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.GeneralSetting{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	setting := model.GeneralSetting{
		Model:              model.Model{ID: 1},
		AIProvider:         model.DefaultGeneralAIProvider,
		AIModel:            model.DefaultGeneralAIModel,
		AIAPIKey:           model.SecretString(apiKey),
		AIMaxTokens:        4096,
		KubectlEnabled:     true,
		KubectlImage:       model.DefaultGeneralKubectlImage,
		NodeTerminalImage:  model.DefaultGeneralNodeTerminalImage,
		EnableVersionCheck: true,
		EnableMFA:          true,
		EnablePasskeyLogin: true,
		JWTSecret:          model.SecretString(common.JwtSecret),
	}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatalf("creating general setting: %v", err)
	}

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		common.KiteEncryptKey = originalEncryptKey
		common.JwtSecret = originalJWTSecret
		common.EnableAnalytics = originalAnalytics
		common.EnableVersionCheck = originalVersionCheck
	})
}

func generalSettingTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/settings", HandleGetGeneralSetting)
	router.PUT("/settings", HandleUpdateGeneralSetting)
	return router
}

func performGeneralSettingRequest(t *testing.T, router *gin.Engine, method string, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, "/settings", strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func decodeGeneralSettingResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	return body
}
