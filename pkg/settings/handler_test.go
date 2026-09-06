package settings

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

func TestGeneralSettingHandlersDoNotExposeOrEraseSMTPPassword(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	if err := model.DB.Model(&model.GeneralSetting{}).Where("id = ?", 1).Updates(map[string]interface{}{
		"smtp_password": model.SecretString("existing-smtp-password"),
	}).Error; err != nil {
		t.Fatalf("storing SMTP password: %v", err)
	}
	router := generalSettingTestRouter()

	getResponse := performGeneralSettingRequest(t, router, http.MethodGet, "")
	if getResponse.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d: %s", getResponse.Code, http.StatusOK, getResponse.Body.String())
	}
	getBody := decodeGeneralSettingResponse(t, getResponse)
	if _, ok := getBody["smtpPassword"]; ok || getBody["smtpPasswordConfigured"] != true {
		t.Fatalf("GET SMTP password fields = %#v", getBody)
	}
	if getBody["smtpSkipTLSVerify"] != false {
		t.Fatalf("GET smtpSkipTLSVerify = %#v, want false", getBody["smtpSkipTLSVerify"])
	}
	if _, ok := getBody["smtpSkipTlsVerify"]; ok {
		t.Fatalf("GET response has deprecated smtpSkipTlsVerify field = %#v", getBody)
	}
	if strings.Contains(getResponse.Body.String(), "existing-smtp-password") {
		t.Fatal("GET response exposed the stored SMTP password")
	}

	updateResponse := performGeneralSettingRequest(t, router, http.MethodPut, `{"smtpPassword":"  ","smtpSkipTLSVerify":true}`)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d: %s", updateResponse.Code, http.StatusOK, updateResponse.Body.String())
	}
	if strings.Contains(updateResponse.Body.String(), "existing-smtp-password") {
		t.Fatal("PUT response exposed the stored SMTP password")
	}
	var stored model.GeneralSetting
	if err := model.DB.First(&stored, 1).Error; err != nil {
		t.Fatalf("loading stored setting: %v", err)
	}
	if stored.SMTPPassword != model.SecretString("existing-smtp-password") {
		t.Fatalf("stored SMTP password = %q, want preserved value", stored.SMTPPassword)
	}
	if !stored.SMTPSkipTLSVerify {
		t.Fatal("stored SMTPSkipTLSVerify = false, want true")
	}
}

func TestHandleUpdateGeneralSettingRejectsManagedSMTP(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	originalManagedSections := common.ManagedSections
	common.SetManagedSections(map[string]bool{"smtp": true})
	t.Cleanup(func() { common.ManagedSections = originalManagedSections })

	response := performGeneralSettingRequest(t, generalSettingTestRouter(), http.MethodPut, `{"smtpClearPassword":true}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	body := decodeGeneralSettingResponse(t, response)
	if body["error"] != common.ManagedSectionError {
		t.Fatalf("error = %q, want %q", body["error"], common.ManagedSectionError)
	}
}

func TestHandleUpdateGeneralSettingValidatesEnabledSMTPConfiguration(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	response := performGeneralSettingRequest(t, generalSettingTestRouter(), http.MethodPut, `{"smtpEnabled":true,"smtpHost":" ","smtpPort":0,"smtpFromEmail":"not-an-email","smtpEncryption":"invalid"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	body := decodeGeneralSettingResponse(t, response)
	if body["error"] != "smtpHost is required when smtpEnabled is true" {
		t.Fatalf("error = %q", body["error"])
	}
}

func TestHandleTestSMTPRejectsWhenDisabled(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	response := performGeneralSettingRequest(t, generalSettingTestRouter(), http.MethodPost, `{"recipient":"recipient@example.com"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	body := decodeGeneralSettingResponse(t, response)
	if body["error"] != "SMTP is not enabled" {
		t.Fatalf("error = %q", body["error"])
	}
}

func TestHandleTestSMTPUsesTemporaryOverrideWithoutPersisting(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	server := newFakeSMTPServer(t, false, false)
	setting := server.setting()
	if err := model.DB.Model(&model.GeneralSetting{}).Where("id = ?", 1).Updates(map[string]interface{}{
		"smtp_password": model.SecretString("stored-password"),
		"smtp_host":     "stored.example.com",
	}).Error; err != nil {
		t.Fatalf("storing SMTP setting: %v", err)
	}

	body := fmt.Sprintf(`{"recipient":"recipient@example.com","smtpEnabled":true,"smtpHost":"%s","smtpPort":%d,"smtpUsername":"temporary-user","smtpPassword":"temporary-password","smtpFromEmail":"%s","smtpFromName":"Temporary Sender","smtpEncryption":"none","smtpSkipTLSVerify":false,"smtpTimeoutSeconds":1}`,
		setting.SMTPHost, setting.SMTPPort, setting.SMTPFromEmail)
	response := performGeneralSettingRequest(t, generalSettingTestRouter(), http.MethodPost, body)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}

	server.mu.Lock()
	received := server.message
	server.mu.Unlock()
	if received == "" {
		t.Fatal("temporary SMTP configuration did not send an email")
	}
	var stored model.GeneralSetting
	if err := model.DB.First(&stored, 1).Error; err != nil {
		t.Fatalf("loading stored setting: %v", err)
	}
	if stored.SMTPHost != "stored.example.com" || stored.SMTPPassword != model.SecretString("stored-password") {
		t.Fatalf("SMTP test persisted temporary configuration: %#v", stored)
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
	router.POST("/settings", HandleTestSMTP)
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
