package passkey

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCredentialPersistenceEnforcesUserBinding(t *testing.T) {
	db := setupPasskeyTestDB(t)
	alice := model.User{Username: "alice", Provider: model.AuthProviderPassword, Enabled: true}
	bob := model.User{Username: "bob", Provider: model.AuthProviderPassword, Enabled: true}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatalf("creating alice: %v", err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatalf("creating bob: %v", err)
	}

	credential := webauthn.Credential{
		ID:        []byte("credential-id"),
		PublicKey: []byte("public-key"),
	}
	record, err := createCredential(alice.ID, " Laptop ", credential)
	if err != nil {
		t.Fatalf("createCredential() error = %v", err)
	}
	if record.Name != "Laptop" || record.CredentialID != credentialIDString(credential.ID) {
		t.Fatalf("created credential = %#v", record)
	}

	webUser, err := webAuthnUserFor(alice)
	if err != nil {
		t.Fatalf("webAuthnUserFor() error = %v", err)
	}
	if len(webUser.credentials) != 1 || string(webUser.credentials[0].PublicKey) != "public-key" {
		t.Fatalf("stored WebAuthn credentials = %#v", webUser.credentials)
	}

	resolved, resolvedRecord, err := userForCredential(credential.ID, userHandle(alice.ID))
	if err != nil {
		t.Fatalf("userForCredential() error = %v", err)
	}
	resolvedUser, ok := resolved.(webAuthnUser)
	if !ok || resolvedUser.user.ID != alice.ID || resolvedRecord.ID != record.ID {
		t.Fatalf("resolved credential owner = %#v, record = %#v", resolved, resolvedRecord)
	}
	if _, _, err := userForCredential(credential.ID, userHandle(bob.ID)); err == nil {
		t.Fatal("userForCredential() accepted another user's handle")
	}

	credential.Authenticator.SignCount = 7
	if err := updateCredential(record, credential); err != nil {
		t.Fatalf("updateCredential() error = %v", err)
	}
	if record.LastUsedAt == nil {
		t.Fatal("updateCredential() did not record last use")
	}
	webUser, err = webAuthnUserFor(alice)
	if err != nil {
		t.Fatalf("loading updated credential: %v", err)
	}
	if got := webUser.credentials[0].Authenticator.SignCount; got != 7 {
		t.Fatalf("stored sign count = %d, want 7", got)
	}

	if err := DeleteCredential(bob.ID, record.ID); err != nil {
		t.Fatalf("deleting credential as wrong owner: %v", err)
	}
	credentials, err := CredentialsForUser(alice.ID)
	if err != nil || len(credentials) != 1 {
		t.Fatalf("wrong-owner delete removed credential: credentials=%#v err=%v", credentials, err)
	}
	if err := DeleteCredential(alice.ID, record.ID); err != nil {
		t.Fatalf("deleting credential as owner: %v", err)
	}
	credentials, err = CredentialsForUser(alice.ID)
	if err != nil || len(credentials) != 0 {
		t.Fatalf("owner delete left credentials: credentials=%#v err=%v", credentials, err)
	}
}

func TestPasskeySessionIsSingleUse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalHost := common.Host
	common.Host = "https://kite.example.com"
	t.Cleanup(func() {
		common.Host = originalHost
	})

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	saveSession(ctx, session{Ceremony: "registration", Name: "Laptop"})

	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("saveSession() set %d cookies, want 1", len(cookies))
	}
	cookie := cookies[0]
	t.Cleanup(func() {
		sessionCache.Remove(cookie.Value)
	})
	if cookie.Name != sessionCookieName || cookie.Value == "" {
		t.Fatalf("session cookie = %#v", cookie)
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie security attributes = %#v", cookie)
	}

	loadRecorder := httptest.NewRecorder()
	loadContext, _ := gin.CreateTestContext(loadRecorder)
	loadContext.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	loadContext.Request.AddCookie(cookie)
	loaded, err := loadSession(loadContext, "registration")
	if err != nil {
		t.Fatalf("loadSession() error = %v", err)
	}
	if loaded.Name != "Laptop" || loaded.Ceremony != "registration" {
		t.Fatalf("loadSession() = %#v", loaded)
	}
	if cleared := loadRecorder.Result().Cookies()[0]; cleared.MaxAge >= 0 {
		t.Fatalf("loadSession() cookie MaxAge = %d, want negative", cleared.MaxAge)
	}

	replayRecorder := httptest.NewRecorder()
	replayContext, _ := gin.CreateTestContext(replayRecorder)
	replayContext.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	replayContext.Request.AddCookie(cookie)
	if _, err := loadSession(replayContext, "registration"); err == nil {
		t.Fatal("loadSession() accepted a replayed session")
	}
}

func TestPasskeySessionCannotCrossCeremonies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const token = "cross-ceremony-session"
	sessionCache.Add(token, session{Ceremony: "registration"})
	t.Cleanup(func() {
		sessionCache.Remove(token)
	})

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	ctx.Request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	if _, err := loadSession(ctx, "login"); err == nil {
		t.Fatal("loadSession() accepted a registration session for login")
	}
	if _, ok := sessionCache.Get(token); ok {
		t.Fatal("loadSession() retained a session after a ceremony mismatch")
	}
}

func TestWebAuthnForRequestValidatesOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalHost := common.Host
	common.Host = ""
	t.Cleanup(func() {
		common.Host = originalHost
	})

	validRecorder := httptest.NewRecorder()
	validContext, _ := gin.CreateTestContext(validRecorder)
	validContext.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	validContext.Request.Header.Set("Origin", "https://kite.example.com")
	if instance, err := webAuthnForRequest(validContext); err != nil || instance == nil {
		t.Fatalf("webAuthnForRequest() = %v, %v, want configured instance", instance, err)
	}

	invalidRecorder := httptest.NewRecorder()
	invalidContext, _ := gin.CreateTestContext(invalidRecorder)
	invalidContext.Request = httptest.NewRequest(http.MethodPost, "http://kite.example.com/passkeys", nil)
	invalidContext.Request.Host = ""
	if _, err := webAuthnForRequest(invalidContext); err == nil {
		t.Fatal("webAuthnForRequest() accepted an origin without a relying-party host")
	}
}

func TestRequestOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalHost := common.Host
	t.Cleanup(func() {
		common.Host = originalHost
	})

	tests := []struct {
		name           string
		configuredHost string
		origin         string
		forwardedHost  string
		forwardedProto string
		requestHost    string
		want           string
	}{
		{
			name:           "origin header wins",
			configuredHost: "https://configured.example.com",
			origin:         "https://origin.example.com",
			requestHost:    "request.example.com",
			want:           "https://origin.example.com",
		},
		{
			name:           "configured host",
			configuredHost: "https://configured.example.com/",
			requestHost:    "request.example.com",
			want:           "https://configured.example.com",
		},
		{
			name:           "forwarded host and scheme",
			forwardedHost:  "forwarded.example.com",
			forwardedProto: "https",
			requestHost:    "request.example.com",
			want:           "https://forwarded.example.com",
		},
		{
			name:        "request host",
			requestHost: "request.example.com",
			want:        "http://request.example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			common.Host = tt.configuredHost
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			req := httptest.NewRequest(http.MethodGet, "http://"+tt.requestHost, nil)
			req.Header.Set("Origin", tt.origin)
			req.Header.Set("X-Forwarded-Host", tt.forwardedHost)
			req.Header.Set("X-Forwarded-Proto", tt.forwardedProto)
			ctx.Request = req

			if got := requestOrigin(ctx); got != tt.want {
				t.Fatalf("requestOrigin() = %q, want %q", got, tt.want)
			}
		})
	}
}

func setupPasskeyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := model.DB
	originalEncryptKey := common.KiteEncryptKey
	common.KiteEncryptKey = "passkey-test-encryption-key"
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.PasskeyCredential{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
		common.KiteEncryptKey = originalEncryptKey
	})
	return db
}
