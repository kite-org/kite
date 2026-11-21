package auth

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

func TestGetRequestHost(t *testing.T) {
	originalHost := common.Host
	t.Cleanup(func() {
		common.Host = originalHost
	})

	t.Run("configured host overrides request", func(t *testing.T) {
		common.Host = "https://kite.example.com"
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "http://ignored.local", nil)

		if got := getRequestHost(c); got != common.Host {
			t.Fatalf("getRequestHost() = %q, want %q", got, common.Host)
		}
	})

	t.Run("forwarded headers", func(t *testing.T) {
		common.Host = ""
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		req := httptest.NewRequest(http.MethodGet, "http://internal.local", nil)
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", "kite.example.com")
		c.Request = req

		if got := getRequestHost(c); got != "https://kite.example.com" {
			t.Fatalf("getRequestHost() = %q, want %q", got, "https://kite.example.com")
		}
	})

	t.Run("request host and scheme", func(t *testing.T) {
		common.Host = ""
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		req := httptest.NewRequest(http.MethodGet, "http://kite.local", nil)
		c.Request = req

		if got := getRequestHost(c); got != "http://kite.local" {
			t.Fatalf("getRequestHost() = %q, want %q", got, "http://kite.local")
		}
	})

	t.Run("fallback", func(t *testing.T) {
		common.Host = ""
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "http://kite.local", nil)
		c.Request.Host = ""

		if got := getRequestHost(c); got != "http://localhost" {
			t.Fatalf("getRequestHost() = %q, want %q", got, "http://localhost")
		}
	})
}

func TestGenerateAndValidateJWT(t *testing.T) {
	originalSecret := common.JwtSecret
	common.JwtSecret = "test-secret"
	t.Cleanup(func() {
		common.JwtSecret = originalSecret
	})

	manager := NewOAuthManager()
	user := &model.User{
		Model:    model.Model{ID: 42},
		Username: "alice",
		Provider: model.AuthProviderLDAP,
	}

	tokenString, err := manager.GenerateJWT(user, "refresh-token")
	if err != nil {
		t.Fatalf("GenerateJWT() error = %v", err)
	}

	claims, err := manager.ValidateJWT(tokenString)
	if err != nil {
		t.Fatalf("ValidateJWT() error = %v", err)
	}
	if claims.UserID != user.ID || claims.Username != user.Username || claims.Provider != user.Provider {
		t.Fatalf("ValidateJWT() claims = %#v, want user fields from input", claims)
	}
	if claims.RefreshToken != "refresh-token" {
		t.Fatalf("ValidateJWT() refresh token = %q, want %q", claims.RefreshToken, "refresh-token")
	}
	if claims.Issuer != "Kite" {
		t.Fatalf("ValidateJWT() issuer = %q, want %q", claims.Issuer, "Kite")
	}
}

func TestGenerateJWTStripsLargeRefreshToken(t *testing.T) {
	originalSecret := common.JwtSecret
	common.JwtSecret = "test-secret"
	t.Cleanup(func() {
		common.JwtSecret = originalSecret
	})

	manager := NewOAuthManager()
	user := &model.User{
		Model:    model.Model{ID: 7},
		Username: "bob",
		Provider: "github",
	}
	largeRefreshToken := strings.Repeat("r", maxAuthTokenCookieValueLength+1)

	tokenString, err := manager.GenerateJWT(user, largeRefreshToken)
	if err != nil {
		t.Fatalf("GenerateJWT() error = %v", err)
	}

	claims, err := manager.ValidateJWT(tokenString)
	if err != nil {
		t.Fatalf("ValidateJWT() error = %v", err)
	}
	if claims.RefreshToken != "" {
		t.Fatalf("ValidateJWT() refresh token = %q, want empty string", claims.RefreshToken)
	}
}

func TestIDTokenForRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	originalSecret := common.JwtSecret
	originalEncryptKey := common.KiteEncryptKey
	t.Cleanup(func() {
		model.DB = originalDB
		common.JwtSecret = originalSecret
		common.KiteEncryptKey = originalEncryptKey
	})
	common.JwtSecret = "id-token-test-jwt-secret"
	common.KiteEncryptKey = "id-token-test-encrypt-key"

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.OAuthProvider{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db

	// mode selects the token endpoint behaviour: "ok", "rotate" or "no-id-token".
	var mode string
	var tokenRequests int
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenRequests++
		if err := r.ParseForm(); err != nil {
			t.Errorf("ParseForm() error = %v", err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "session-refresh" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		resp := TokenResponse{AccessToken: "access-token", IDToken: "fresh-id-token", TokenType: "Bearer"}
		switch mode {
		case "rotate":
			resp.RefreshToken = "rotated-refresh"
		case "no-id-token":
			resp.IDToken = ""
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(tokenServer.Close)

	if err := db.Create(&model.OAuthProvider{
		Name:         "keycloak",
		ClientID:     "kite",
		ClientSecret: "client-secret",
		AuthURL:      tokenServer.URL + "/auth",
		TokenURL:     tokenServer.URL + "/token",
		UserInfoURL:  tokenServer.URL + "/userinfo",
		Enabled:      true,
	}).Error; err != nil {
		t.Fatalf("creating provider: %v", err)
	}

	user := model.User{Model: model.Model{ID: 7}, Username: "bob", Provider: "keycloak"}
	newContext := func(refreshToken string) (*gin.Context, *httptest.ResponseRecorder) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
		c.Set("refresh_token", refreshToken)
		c.Set("user", user)
		return c, recorder
	}
	manager := NewOAuthManager()

	t.Run("returns ID token and keeps cookie when refresh token is not rotated", func(t *testing.T) {
		mode = "ok"
		c, recorder := newContext("session-refresh")

		idToken, err := manager.IDTokenForRequest(c)
		if err != nil {
			t.Fatalf("IDTokenForRequest() error = %v", err)
		}
		if idToken != "fresh-id-token" {
			t.Fatalf("IDTokenForRequest() = %q, want %q", idToken, "fresh-id-token")
		}
		if len(recorder.Result().Cookies()) != 0 {
			t.Fatalf("cookie written although refresh token was not rotated")
		}
	})

	t.Run("writes rotated refresh token back to session cookie", func(t *testing.T) {
		mode = "rotate"
		c, recorder := newContext("session-refresh")

		idToken, err := manager.IDTokenForRequest(c)
		if err != nil {
			t.Fatalf("IDTokenForRequest() error = %v", err)
		}
		if idToken != "fresh-id-token" {
			t.Fatalf("IDTokenForRequest() = %q, want %q", idToken, "fresh-id-token")
		}
		var authCookie *http.Cookie
		for _, cookie := range recorder.Result().Cookies() {
			if cookie.Name == "auth_token" {
				authCookie = cookie
			}
		}
		if authCookie == nil {
			t.Fatalf("no auth_token cookie written for rotated refresh token")
		}
		claims, err := manager.ValidateJWT(authCookie.Value)
		if err != nil {
			t.Fatalf("ValidateJWT() error = %v", err)
		}
		if claims.RefreshToken != "rotated-refresh" {
			t.Fatalf("cookie refresh token = %q, want %q", claims.RefreshToken, "rotated-refresh")
		}
	})

	t.Run("fails without calling provider when session has no refresh token", func(t *testing.T) {
		mode = "ok"
		before := tokenRequests
		c, _ := newContext("")

		if _, err := manager.IDTokenForRequest(c); err == nil {
			t.Fatalf("IDTokenForRequest() error = nil, want error")
		}
		if tokenRequests != before {
			t.Fatalf("provider called %d times for session without refresh token", tokenRequests-before)
		}
	})

	t.Run("fails when provider returns no ID token", func(t *testing.T) {
		mode = "no-id-token"
		c, _ := newContext("session-refresh")

		if _, err := manager.IDTokenForRequest(c); err == nil {
			t.Fatalf("IDTokenForRequest() error = nil, want error")
		}
	})
}
