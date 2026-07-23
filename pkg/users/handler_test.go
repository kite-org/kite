package users

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestChangeCurrentUserPasswordVerifiesCurrentPassword(t *testing.T) {
	user := setupUserHandlerTestDB(t)
	router := gin.New()
	router.PUT("/password", func(c *gin.Context) {
		c.Set("user", *user)
		ChangeCurrentUserPassword(c)
	})

	wrong := performUserRequest(router, http.MethodPut, "/password", `{"current_password":"wrong","new_password":"new-secret"}`)
	if wrong.Code != http.StatusBadRequest {
		t.Fatalf("wrong-password status = %d, want %d", wrong.Code, http.StatusBadRequest)
	}
	stored, err := model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading user after rejected change: %v", err)
	}
	if !model.CheckPassword(stored.Password, "old-secret") || model.CheckPassword(stored.Password, "new-secret") {
		t.Fatal("rejected password change modified the stored password")
	}

	success := performUserRequest(router, http.MethodPut, "/password", `{"current_password":"old-secret","new_password":"new-secret"}`)
	if success.Code != http.StatusOK {
		t.Fatalf("successful status = %d, want %d: %s", success.Code, http.StatusOK, success.Body.String())
	}
	stored, err = model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading user after password change: %v", err)
	}
	if !model.CheckPassword(stored.Password, "new-secret") || model.CheckPassword(stored.Password, "old-secret") {
		t.Fatal("successful password change did not replace the stored hash")
	}
}

func TestCurrentUserMFALifecycle(t *testing.T) {
	user := setupUserHandlerTestDB(t)
	router := gin.New()
	router.POST("/mfa/setup", func(c *gin.Context) {
		current, err := model.GetUserByID(uint64(user.ID))
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Set("user", *current)
		SetupCurrentUserMFA(c)
	})
	router.POST("/mfa/enable", func(c *gin.Context) {
		current, err := model.GetUserByID(uint64(user.ID))
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Set("user", *current)
		EnableCurrentUserMFA(c)
	})
	router.POST("/mfa/disable", func(c *gin.Context) {
		current, err := model.GetUserByID(uint64(user.ID))
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Set("user", *current)
		DisableCurrentUserMFA(c)
	})

	setup := performUserRequest(router, http.MethodPost, "/mfa/setup", `{"current_password":"old-secret"}`)
	if setup.Code != http.StatusOK {
		t.Fatalf("setup status = %d, want %d: %s", setup.Code, http.StatusOK, setup.Body.String())
	}
	var setupBody struct {
		Secret     string `json:"secret"`
		OTPAuthURL string `json:"otpauth_url"`
		QRCode     string `json:"qr_code"`
	}
	if err := json.Unmarshal(setup.Body.Bytes(), &setupBody); err != nil {
		t.Fatalf("decoding setup response: %v", err)
	}
	if setupBody.Secret == "" || !strings.Contains(setupBody.OTPAuthURL, setupBody.Secret) || !strings.HasPrefix(setupBody.QRCode, "data:image/png;base64,") {
		t.Fatalf("invalid MFA setup response: %#v", setupBody)
	}
	pending, err := model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading pending MFA user: %v", err)
	}
	if pending.MFAEnabled || string(pending.MFASecret) != setupBody.Secret {
		t.Fatalf("pending MFA state = enabled:%v secret:%q", pending.MFAEnabled, pending.MFASecret)
	}

	code := currentTOTPCode(t, setupBody.Secret)
	enable := performUserRequest(router, http.MethodPost, "/mfa/enable", fmt.Sprintf(`{"code":%q}`, code))
	if enable.Code != http.StatusOK {
		t.Fatalf("enable status = %d, want %d: %s", enable.Code, http.StatusOK, enable.Body.String())
	}
	enabled, err := model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading enabled MFA user: %v", err)
	}
	if !enabled.MFAEnabled || string(enabled.MFASecret) != setupBody.Secret {
		t.Fatalf("enabled MFA state = enabled:%v secret:%q", enabled.MFAEnabled, enabled.MFASecret)
	}

	disable := performUserRequest(router, http.MethodPost, "/mfa/disable", fmt.Sprintf(`{"code":%q}`, currentTOTPCode(t, setupBody.Secret)))
	if disable.Code != http.StatusOK {
		t.Fatalf("disable status = %d, want %d: %s", disable.Code, http.StatusOK, disable.Body.String())
	}
	disabled, err := model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading disabled MFA user: %v", err)
	}
	if disabled.MFAEnabled || disabled.MFASecret != "" {
		t.Fatalf("disabled MFA state = enabled:%v secret:%q", disabled.MFAEnabled, disabled.MFASecret)
	}
}

func TestSetupCurrentUserMFAHonorsGlobalSetting(t *testing.T) {
	user := setupUserHandlerTestDB(t)
	if err := model.DB.Model(&model.GeneralSetting{}).Where("id = ?", 1).Update("enable_mfa", false).Error; err != nil {
		t.Fatalf("disabling MFA setting: %v", err)
	}
	router := gin.New()
	router.POST("/mfa/setup", func(c *gin.Context) {
		c.Set("user", *user)
		SetupCurrentUserMFA(c)
	})

	response := performUserRequest(router, http.MethodPost, "/mfa/setup", `{"current_password":"old-secret"}`)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestUpdateSidebarPreferenceHonorsGlobalPolicy(t *testing.T) {
	user := setupUserHandlerTestDB(t)
	if _, err := model.UpdateGeneralSetting(map[string]interface{}{
		"global_sidebar_preference": `{"sections":["workloads"]}`,
	}); err != nil {
		t.Fatalf("setting global sidebar preference: %v", err)
	}

	user.Roles = []common.Role{}
	userRouter := gin.New()
	userRouter.PUT("/sidebar", func(c *gin.Context) {
		c.Set("user", *user)
		UpdateSidebarPreference(c)
	})
	blocked := performUserRequest(userRouter, http.MethodPut, "/sidebar", `{"sidebar_preference":"{\"sections\":[\"custom\"]}"}`)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d, want %d", blocked.Code, http.StatusForbidden)
	}
	stored, err := model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading blocked user: %v", err)
	}
	if stored.SidebarPreference != "" {
		t.Fatalf("blocked update stored preference %q", stored.SidebarPreference)
	}

	admin := *user
	admin.Roles = []common.Role{{Name: model.DefaultAdminRole.Name}}
	adminRouter := gin.New()
	adminRouter.PUT("/sidebar", func(c *gin.Context) {
		c.Set("user", admin)
		UpdateSidebarPreference(c)
	})
	allowed := performUserRequest(adminRouter, http.MethodPut, "/sidebar", `{"sidebar_preference":"{\"sections\":[\"admin\"]}"}`)
	if allowed.Code != http.StatusOK {
		t.Fatalf("admin status = %d, want %d: %s", allowed.Code, http.StatusOK, allowed.Body.String())
	}
	stored, err = model.GetUserByID(uint64(user.ID))
	if err != nil {
		t.Fatalf("loading admin user: %v", err)
	}
	if stored.SidebarPreference != `{"sections":["admin"]}` {
		t.Fatalf("admin preference = %q", stored.SidebarPreference)
	}
}

func setupUserHandlerTestDB(t *testing.T) *model.User {
	t.Helper()
	originalDB := model.DB
	originalEncryptKey := common.KiteEncryptKey
	originalJWTSecret := common.JwtSecret
	common.KiteEncryptKey = "users-handler-test-key"
	common.JwtSecret = "users-handler-test-jwt-secret"

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.GeneralSetting{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	setting := model.GeneralSetting{
		Model:              model.Model{ID: 1},
		AIProvider:         model.DefaultGeneralAIProvider,
		AIModel:            model.DefaultGeneralAIModel,
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
	user := &model.User{Username: "alice", Password: "old-secret", Provider: model.AuthProviderPassword, Enabled: true}
	if err := model.AddUser(user); err != nil {
		t.Fatalf("creating user: %v", err)
	}
	gin.SetMode(gin.TestMode)

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		common.KiteEncryptKey = originalEncryptKey
		common.JwtSecret = originalJWTSecret
	})
	return user
}

func performUserRequest(router *gin.Engine, method string, path string, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	return recorder
}

func currentTOTPCode(t *testing.T, secret string) string {
	t.Helper()
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatalf("decoding TOTP secret: %v", err)
	}
	var message [8]byte
	binary.BigEndian.PutUint64(message[:], uint64(time.Now().Unix()/30))
	hash := hmac.New(sha1.New, key)
	_, _ = hash.Write(message[:])
	sum := hash.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000)
}
