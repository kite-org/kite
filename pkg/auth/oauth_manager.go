package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"golang.org/x/sync/singleflight"
	"k8s.io/klog/v2"
)

type OAuthManager struct {
	jwtSecret    string
	refreshGroup singleflight.Group
	refreshStore refreshStore
}

// refreshResult is the outcome of one refresh. It is stored under the hash of the refresh token it
// replaced, so requests that still carry that token are served the same result.
type refreshResult struct {
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
}

const (
	refreshReuseWindow = time.Minute
	// refreshLockTTL must outlast the leader's work: discovery and the token request each have a 10s
	// timeout. A lock that expires early lets a second instance refresh the same token.
	refreshLockTTL      = 30 * time.Second
	storeWriteTimeout   = 5 * time.Second
	refreshWaitTimeout  = 5 * time.Second
	refreshPollInterval = 50 * time.Millisecond
	maxRefreshChainHops = 8
)

// refreshStore shares refresh results and per-session refresh locks between Kite instances.
type refreshStore interface {
	get(ctx context.Context, key string) (string, bool, error)
	set(ctx context.Context, key, value string, ttl time.Duration) error
	// acquire takes the lock for key on behalf of owner and reports whether it was taken.
	acquire(ctx context.Context, key, owner string, ttl time.Duration) (bool, error)
	// release drops the lock for key only while owner still holds it.
	release(ctx context.Context, key, owner string) error
}

type memoryRefreshStore struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
}

type memoryEntry struct {
	value   string
	expires time.Time
}

func (s *memoryRefreshStore) get(_ context.Context, key string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[key]
	if !ok || !time.Now().Before(e.expires) {
		return "", false, nil
	}
	return e.value, true, nil
}

func (s *memoryRefreshStore) set(_ context.Context, key, value string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, e := range s.entries {
		if !now.Before(e.expires) {
			delete(s.entries, k)
		}
	}
	s.entries[key] = memoryEntry{value: value, expires: now.Add(ttl)}
	return nil
}

func (s *memoryRefreshStore) acquire(_ context.Context, key, owner string, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lockKey := "lock:" + key
	if e, ok := s.entries[lockKey]; ok && time.Now().Before(e.expires) {
		return false, nil
	}
	s.entries[lockKey] = memoryEntry{value: owner, expires: time.Now().Add(ttl)}
	return true, nil
}

func (s *memoryRefreshStore) release(_ context.Context, key, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	lockKey := "lock:" + key
	if e, ok := s.entries[lockKey]; ok && e.value == owner {
		delete(s.entries, lockKey)
	}
	return nil
}

const redisRefreshKeyPrefix = "kite:oidc-refresh:"

type redisRefreshStore struct {
	client *redis.Client
}

func (s *redisRefreshStore) get(ctx context.Context, key string) (string, bool, error) {
	value, err := s.client.Get(ctx, redisRefreshKeyPrefix+key).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (s *redisRefreshStore) set(ctx context.Context, key, value string, ttl time.Duration) error {
	return s.client.Set(ctx, redisRefreshKeyPrefix+key, value, ttl).Err()
}

func (s *redisRefreshStore) acquire(ctx context.Context, key, owner string, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, redisRefreshKeyPrefix+"lock:"+key, owner, ttl).Result()
}

// releaseLockScript deletes the lock only if it still holds the caller's owner value, atomically.
var releaseLockScript = redis.NewScript(`if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`)

func (s *redisRefreshStore) release(ctx context.Context, key, owner string) error {
	return releaseLockScript.Run(ctx, s.client, []string{redisRefreshKeyPrefix + "lock:" + key}, owner).Err()
}

// newRefreshStore returns the Valkey/Redis store when REFRESH_CACHE_URL is set and the in-process store
// otherwise. A misconfigured Valkey connection stops startup rather than running without shared state.
func newRefreshStore() refreshStore {
	if common.RefreshCacheURL == "" {
		return &memoryRefreshStore{entries: map[string]memoryEntry{}}
	}
	opts, err := redis.ParseURL(common.RefreshCacheURL)
	if err != nil {
		klog.Fatalf("invalid REFRESH_CACHE_URL: %v", err)
	}
	if !strings.HasPrefix(common.RefreshCacheURL, "rediss://") {
		klog.Fatalf("REFRESH_CACHE_URL must use rediss:// so the connection is TLS-verified")
	}
	opts.Password = common.RefreshCachePassword
	if common.RefreshCacheCAFile != "" {
		pem, err := os.ReadFile(common.RefreshCacheCAFile)
		if err != nil {
			klog.Fatalf("reading REFRESH_CACHE_CA_FILE: %v", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			klog.Fatalf("REFRESH_CACHE_CA_FILE contains no certificates")
		}
		opts.TLSConfig.RootCAs = pool
	}
	return &redisRefreshStore{client: redis.NewClient(opts)}
}

// Keep headroom for cookie name and attributes within common 4096-byte browser limits.
const maxAuthTokenCookieValueLength = 3800

func NewOAuthManager() *OAuthManager {
	return &OAuthManager{
		jwtSecret:    common.JwtSecret,
		refreshStore: newRefreshStore(),
	}
}

func getRequestHost(c *gin.Context) string {
	if common.Host != "" {
		return common.Host
	}
	proto := c.Request.Header.Get("X-Forwarded-Proto")
	host := c.Request.Header.Get("X-Forwarded-Host")
	if proto != "" && host != "" {
		return proto + "://" + host
	}
	if c.Request.Host != "" {
		scheme := "https"
		if c.Request.TLS == nil {
			scheme = "http"
		}
		return scheme + "://" + c.Request.Host
	}

	return "http://localhost"
}

func (om *OAuthManager) GetProvider(c *gin.Context, name string) (OAuthProvider, error) {
	dbProvider, err := model.GetOAuthProviderByName(name)
	if err != nil {
		return nil, err
	}
	dbProvider.RedirectURL, _ = url.JoinPath(getRequestHost(c), common.Base+"/api/auth/callback")
	return NewGenericProvider(dbProvider)
}

func (om *OAuthManager) GetAvailableProviders() []string {
	var providers []string
	dbProviders, err := model.GetEnabledOAuthProviders()
	if err != nil {
		klog.Warningf("Failed to load OAuth providers from database: %v", err)
	} else {
		for _, provider := range dbProviders {
			providers = append(providers, string(provider.Name))
		}
	}
	return providers
}

func (om *OAuthManager) GenerateState() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func (om *OAuthManager) GenerateJWT(user *model.User, refreshToken string) (string, error) {
	now := time.Now()
	expirationTime := now.Add(common.JWTExpirationSeconds * time.Second)

	claims := Claims{
		UserID:       user.ID,
		Username:     user.Username,
		Provider:     user.Provider,
		RefreshToken: refreshToken,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "Kite",
		},
	}

	tokenString, err := om.signJWT(claims)
	if err != nil {
		return "", err
	}
	if len(tokenString) > maxAuthTokenCookieValueLength {
		claims.RefreshToken = "" // Drop refresh token from JWT if it exceeds size limits
		return om.signJWT(claims)
	}
	return tokenString, nil
}

func (om *OAuthManager) signJWT(claims Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(om.jwtSecret))
}

// IDTokenForRequest exchanges the session's refresh token for a fresh ID token. The ID token is
// returned for this request only. A rotated refresh token is written back to the session cookie.
func (om *OAuthManager) IDTokenForRequest(c *gin.Context) (string, error) {
	refreshToken, _ := c.Get("refresh_token")
	rt, _ := refreshToken.(string)
	if rt == "" {
		return "", fmt.Errorf("session has no refresh token")
	}
	userValue, exists := c.Get("user")
	user, ok := userValue.(model.User)
	if !exists || !ok {
		return "", fmt.Errorf("session has no user")
	}
	ctx := c.Request.Context()
	sum := sha256.Sum256([]byte(rt))
	key := hex.EncodeToString(sum[:])
	result, err, _ := om.refreshGroup.Do(key, func() (any, error) {
		return om.refreshOnce(ctx, c, user, rt, key)
	})
	if err != nil {
		return "", err
	}
	res := result.(refreshResult)
	if res.RefreshToken != rt {
		jwtToken, err := om.GenerateJWT(&user, res.RefreshToken)
		if err != nil {
			return "", err
		}
		setCookieSecure(c, "auth_token", jwtToken, common.CookieExpirationSeconds)
	}
	return res.IDToken, nil
}

// refreshOnce returns the cached result for rt, or refreshes it while holding the session's refresh lock.
func (om *OAuthManager) refreshOnce(ctx context.Context, c *gin.Context, user model.User, rt, key string) (refreshResult, error) {
	if res, ok, err := om.latestRefresh(ctx, key); err != nil {
		return refreshResult{}, storeUnavailable(err)
	} else if ok {
		return res, nil
	}
	ownerRaw := make([]byte, 16)
	if _, err := rand.Read(ownerRaw); err != nil {
		return refreshResult{}, err
	}
	owner := hex.EncodeToString(ownerRaw)
	acquired, err := om.refreshStore.acquire(ctx, key, owner, refreshLockTTL)
	if err != nil {
		return refreshResult{}, storeUnavailable(err)
	}
	if !acquired {
		return om.awaitRefresh(ctx, key)
	}
	// The provider has already rotated the token once it answers, so the lock release and the result
	// write must complete even if the client has disconnected.
	storeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), storeWriteTimeout)
	defer cancel()
	defer func() {
		if err := om.refreshStore.release(storeCtx, key, owner); err != nil {
			klog.Warningf("failed to release refresh lock: %v", err)
		}
	}()
	// Another instance may have finished between our lookup and taking the lock.
	if res, ok, err := om.latestRefresh(ctx, key); err != nil {
		return refreshResult{}, storeUnavailable(err)
	} else if ok {
		return res, nil
	}

	provider, err := om.GetProvider(c, user.Provider)
	if err != nil {
		return refreshResult{}, err
	}
	tokenResp, err := provider.RefreshToken(rt)
	if err != nil {
		return refreshResult{}, err
	}
	if tokenResp.IDToken == "" {
		return refreshResult{}, fmt.Errorf("provider returned no id_token")
	}
	res := refreshResult{IDToken: tokenResp.IDToken, RefreshToken: rt}
	if tokenResp.RefreshToken != "" {
		res.RefreshToken = tokenResp.RefreshToken
	}
	payload, err := json.Marshal(res)
	if err != nil {
		return refreshResult{}, err
	}
	if err := om.refreshStore.set(storeCtx, key, string(payload), refreshReuseWindow); err != nil {
		return refreshResult{}, storeUnavailable(err)
	}
	return res, nil
}

// awaitRefresh waits for the instance holding the refresh lock to publish its result.
func (om *OAuthManager) awaitRefresh(ctx context.Context, key string) (refreshResult, error) {
	deadline := time.NewTimer(refreshWaitTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(refreshPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return refreshResult{}, storeUnavailable(ctx.Err())
		case <-deadline.C:
			return refreshResult{}, storeUnavailable(fmt.Errorf("timed out waiting for another instance to refresh"))
		case <-ticker.C:
			res, ok, err := om.latestRefresh(ctx, key)
			if err != nil {
				return refreshResult{}, storeUnavailable(err)
			}
			if ok {
				return res, nil
			}
		}
	}
}

// latestRefresh returns the newest stored result reachable from key, following the rotation chain so a
// request holding a replaced refresh token is not given that token back.
func (om *OAuthManager) latestRefresh(ctx context.Context, key string) (refreshResult, bool, error) {
	raw, ok, err := om.refreshStore.get(ctx, key)
	if err != nil || !ok {
		return refreshResult{}, false, err
	}
	var res refreshResult
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		return refreshResult{}, false, err
	}
	current := key
	for hop := 0; hop < maxRefreshChainHops; hop++ {
		sum := sha256.Sum256([]byte(res.RefreshToken))
		next := hex.EncodeToString(sum[:])
		if next == current {
			break
		}
		raw, ok, err := om.refreshStore.get(ctx, next)
		if err != nil {
			return refreshResult{}, false, err
		}
		if !ok {
			break
		}
		var newer refreshResult
		if err := json.Unmarshal([]byte(raw), &newer); err != nil {
			return refreshResult{}, false, err
		}
		res, current = newer, next
	}
	return res, true, nil
}

// storeUnavailable marks a refresh-cache failure so the request is answered with 503, not 401.
func storeUnavailable(err error) error {
	return fmt.Errorf("%w: %w", common.ErrSessionStoreUnavailable, err)
}

func (om *OAuthManager) ValidateJWT(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(om.jwtSecret), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func (om *OAuthManager) RefreshJWT(c *gin.Context, tokenString string) (string, error) {
	// We need to accept expired tokens here so we can extract claims and refresh using
	// the stored refresh token. Parse the token while skipping claims validation but
	// still validate the signature.
	var claims Claims
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(om.jwtSecret), nil
	}, jwt.WithoutClaimsValidation())
	if err != nil {
		return "", err
	}

	// Ensure signature was valid
	if token == nil || !token.Valid {
		return "", fmt.Errorf("invalid token signature")
	}

	if !time.Now().After(claims.ExpiresAt.Time) {
		user := &model.User{
			Model: model.Model{
				ID: claims.UserID,
			},
			Username: claims.Username,
			Provider: claims.Provider,
		}

		return om.GenerateJWT(user, claims.RefreshToken)
	}

	if claims.RefreshToken != "" {
		provider, err := om.GetProvider(c, claims.Provider)
		if err != nil {
			return "", err
		}

		tokenResp, err := provider.RefreshToken(claims.RefreshToken)
		if err != nil {
			return "", err
		}

		// Get updated user info with new access token
		user, err := provider.GetUserInfo(tokenResp.AccessToken)
		if err != nil {
			return "", err
		}
		user.ID = claims.UserID

		// Generate new JWT with refreshed token
		newRefreshToken := tokenResp.RefreshToken
		if newRefreshToken == "" {
			newRefreshToken = claims.RefreshToken // Keep the old refresh token if no new one provided
		}

		return om.GenerateJWT(user, newRefreshToken)
	}

	return "", fmt.Errorf("token expired")
}
