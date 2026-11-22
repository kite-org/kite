package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/redis/go-redis/v9"
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

// newIDTokenTestEnv starts a fake token endpoint and a provider row for it. setMode selects the
// endpoint behaviour ("ok", "rotate" or "no-id-token"); requests counts refresh calls received.
func newIDTokenTestEnv(t *testing.T) (manager *OAuthManager, newContext func(string) (*gin.Context, *httptest.ResponseRecorder), setMode func(string), requests func() int) {
	t.Helper()
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

	var mode string
	var tokenRequests int
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenRequests++
		if err := r.ParseForm(); err != nil {
			t.Errorf("ParseForm() error = %v", err)
		}
		if mode == "slow" {
			// Widens the window in which concurrent refreshes overlap.
			time.Sleep(300 * time.Millisecond)
		}
		presented := r.Form.Get("refresh_token")
		if r.Form.Get("grant_type") != "refresh_token" || (!strings.HasPrefix(presented, "session-refresh") && !strings.HasPrefix(presented, "chain-")) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		resp := TokenResponse{AccessToken: "access-token", IDToken: "fresh-id-token", TokenType: "Bearer"}
		switch mode {
		case "rotate":
			resp.RefreshToken = "rotated-refresh"
		case "rotate-chain":
			resp.RefreshToken = fmt.Sprintf("chain-%d", tokenRequests)
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
	newContext = func(refreshToken string) (*gin.Context, *httptest.ResponseRecorder) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pods", nil)
		c.Set("refresh_token", refreshToken)
		c.Set("user", user)
		return c, recorder
	}
	setMode = func(m string) { mode = m }
	requests = func() int { return tokenRequests }
	return NewOAuthManager(), newContext, setMode, requests
}

func TestRefreshLockReleasedOnlyByOwner(t *testing.T) {
	cache := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: cache.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	store := &redisRefreshStore{client: client}
	ctx := context.Background()

	if acquired, err := store.acquire(ctx, "session", "owner-a", refreshLockTTL); err != nil || !acquired {
		t.Fatalf("owner-a acquire = %v, %v; want acquired", acquired, err)
	}
	// owner-a's lock expires while its refresh is still running; owner-b takes over.
	cache.FastForward(refreshLockTTL + time.Second)
	if acquired, err := store.acquire(ctx, "session", "owner-b", refreshLockTTL); err != nil || !acquired {
		t.Fatalf("owner-b acquire = %v, %v; want acquired after expiry", acquired, err)
	}
	// owner-a finishing late must not release owner-b's lock.
	if err := store.release(ctx, "session", "owner-a"); err != nil {
		t.Fatalf("owner-a release error = %v", err)
	}
	if acquired, err := store.acquire(ctx, "session", "owner-c", refreshLockTTL); err != nil || acquired {
		t.Fatalf("owner-c acquire = %v, %v; want still held by owner-b", acquired, err)
	}
}

func TestIDTokenForRequestAcrossReplicas(t *testing.T) {
	manager, newContext, setMode, requests := newIDTokenTestEnv(t)
	// Two replicas share one Valkey-compatible store and do not share memory.
	cache := miniredis.RunT(t)
	newReplica := func() *OAuthManager {
		client := redis.NewClient(&redis.Options{Addr: cache.Addr()})
		t.Cleanup(func() { _ = client.Close() })
		return &OAuthManager{jwtSecret: manager.jwtSecret, refreshStore: &redisRefreshStore{client: client}}
	}
	replicas := []*OAuthManager{newReplica(), newReplica()}

	t.Run("concurrent requests on both replicas refresh once", func(t *testing.T) {
		setMode("slow")
		before := requests()
		const perReplica = 4
		ids := make([]string, 0, len(replicas)*perReplica)
		errs := make([]error, 0, len(replicas)*perReplica)
		var mu sync.Mutex
		var wg sync.WaitGroup
		for _, replica := range replicas {
			for i := 0; i < perReplica; i++ {
				wg.Add(1)
				go func(replica *OAuthManager) {
					defer wg.Done()
					c, _ := newContext("session-refresh-replicas")
					id, err := replica.IDTokenForRequest(c)
					mu.Lock()
					ids, errs = append(ids, id), append(errs, err)
					mu.Unlock()
				}(replica)
			}
		}
		wg.Wait()
		for i := range ids {
			if errs[i] != nil || ids[i] != "fresh-id-token" {
				t.Fatalf("request %d: id = %q, error = %v", i, ids[i], errs[i])
			}
		}
		if got := requests() - before; got != 1 {
			t.Fatalf("provider refreshed %d times across replicas, want 1", got)
		}
	})

	t.Run("client disconnect after refresh still stores the rotated result", func(t *testing.T) {
		setMode("slow")
		before := requests()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		// The client goes away while the provider call is still in flight.
		time.AfterFunc(100*time.Millisecond, cancel)
		c, _ := newContext("session-refresh-disconnect")
		c.Request = c.Request.WithContext(ctx)

		if _, err := replicas[0].IDTokenForRequest(c); err != nil {
			t.Fatalf("IDTokenForRequest() error = %v, want the refresh to be stored despite the disconnect", err)
		}
		if got := requests() - before; got != 1 {
			t.Fatalf("provider refreshed %d times, want 1", got)
		}
		// A later request with the same token is served from the stored result.
		again, _ := newContext("session-refresh-disconnect")
		if _, err := replicas[1].IDTokenForRequest(again); err != nil {
			t.Fatalf("follow-up IDTokenForRequest() error = %v", err)
		}
		if got := requests() - before; got != 1 {
			t.Fatalf("follow-up refreshed again (%d total); the result was not stored", got)
		}
	})

	t.Run("cache outage fails with store-unavailable, not an auth failure", func(t *testing.T) {
		setMode("ok")
		before := requests()
		cache.Close()
		c, _ := newContext("session-refresh-outage")

		_, err := replicas[0].IDTokenForRequest(c)
		if !errors.Is(err, common.ErrSessionStoreUnavailable) {
			t.Fatalf("IDTokenForRequest() error = %v, want ErrSessionStoreUnavailable", err)
		}
		if requests() != before {
			t.Fatalf("provider called while the cache was unavailable")
		}
	})
}

// sessionRefreshToken returns the refresh token carried by the auth cookie written to recorder.
func sessionRefreshToken(t *testing.T, manager *OAuthManager, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == "auth_token" {
			claims, err := manager.ValidateJWT(cookie.Value)
			if err != nil {
				t.Fatalf("ValidateJWT() error = %v", err)
			}
			return claims.RefreshToken
		}
	}
	t.Fatalf("no auth_token cookie written")
	return ""
}

func TestIDTokenForRequest(t *testing.T) {
	manager, newContext, setMode, requests := newIDTokenTestEnv(t)

	t.Run("returns ID token and keeps cookie when refresh token is not rotated", func(t *testing.T) {
		setMode("ok")
		c, recorder := newContext("session-refresh-ok")

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
		setMode("rotate")
		c, recorder := newContext("session-refresh-rotate")

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
		setMode("ok")
		before := requests()
		c, _ := newContext("")

		if _, err := manager.IDTokenForRequest(c); err == nil {
			t.Fatalf("IDTokenForRequest() error = nil, want error")
		}
		if requests() != before {
			t.Fatalf("provider called %d times for session without refresh token", requests()-before)
		}
	})

	t.Run("fails when provider returns no ID token", func(t *testing.T) {
		setMode("no-id-token")
		c, _ := newContext("session-refresh-no-id")

		if _, err := manager.IDTokenForRequest(c); err == nil {
			t.Fatalf("IDTokenForRequest() error = nil, want error")
		}
	})

	t.Run("concurrent requests and stale cookies share one rotation", func(t *testing.T) {
		setMode("rotate")
		before := requests()
		const concurrent = 8
		ids := make([]string, concurrent)
		errs := make([]error, concurrent)
		var wg sync.WaitGroup
		for i := 0; i < concurrent; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				c, _ := newContext("session-refresh-concurrent")
				ids[i], errs[i] = manager.IDTokenForRequest(c)
			}(i)
		}
		wg.Wait()
		for i := range concurrent {
			if errs[i] != nil || ids[i] != "fresh-id-token" {
				t.Fatalf("request %d: id = %q, error = %v", i, ids[i], errs[i])
			}
		}

		// A request still carrying the replaced refresh token gets the rotated one from the reuse window.
		c, recorder := newContext("session-refresh-concurrent")
		if _, err := manager.IDTokenForRequest(c); err != nil {
			t.Fatalf("stale-cookie IDTokenForRequest() error = %v", err)
		}
		if requests()-before != 1 {
			t.Fatalf("provider refreshed %d times, want 1", requests()-before)
		}
		var authCookie *http.Cookie
		for _, cookie := range recorder.Result().Cookies() {
			if cookie.Name == "auth_token" {
				authCookie = cookie
			}
		}
		if authCookie == nil {
			t.Fatalf("stale-cookie request did not receive the rotated session cookie")
		}
		claims, err := manager.ValidateJWT(authCookie.Value)
		if err != nil || claims.RefreshToken != "rotated-refresh" {
			t.Fatalf("cookie refresh token = %q, error = %v, want %q", claims.RefreshToken, err, "rotated-refresh")
		}
	})

	t.Run("stale request is given the newest token in a rotation chain", func(t *testing.T) {
		setMode("rotate-chain")
		// A refreshes T0 into T1; B refreshes T1 into T2.
		ctxA, recorderA := newContext("session-refresh-chain")
		if _, err := manager.IDTokenForRequest(ctxA); err != nil {
			t.Fatalf("request A error = %v", err)
		}
		t1 := sessionRefreshToken(t, manager, recorderA)
		ctxB, recorderB := newContext(t1)
		if _, err := manager.IDTokenForRequest(ctxB); err != nil {
			t.Fatalf("request B error = %v", err)
		}
		t2Expected := sessionRefreshToken(t, manager, recorderB)
		before := requests()

		// C still holds T0, which A replaced; it must get T2, not T1.
		c, recorder := newContext("session-refresh-chain")
		if _, err := manager.IDTokenForRequest(c); err != nil {
			t.Fatalf("request C error = %v", err)
		}
		if requests() != before {
			t.Fatalf("request C refreshed again; want it served from the reuse window")
		}
		if t2 := sessionRefreshToken(t, manager, recorder); t2 != t2Expected {
			t.Fatalf("request C cookie refresh token = %q, want newest %q", t2, t2Expected)
		}
	})
}
