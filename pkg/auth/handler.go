package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
	"k8s.io/klog/v2"
)

type AuthHandler struct {
	manager *OAuthManager
	ldap    *LDAPAuthenticator
}

type credentialAuthenticator func(username, password string) (*model.User, error)

var errInvalidCredentials = errors.New("invalid credentials")

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{
		manager: NewOAuthManager(),
		ldap:    NewLDAPAuthenticator(),
	}
}

func (h *AuthHandler) GetProviders(c *gin.Context) {
	credentialProviders := []string{model.AuthProviderPassword}
	oauthProviders := uniqueStrings(h.manager.GetAvailableProviders())

	setting, err := model.GetLDAPSetting()
	if err != nil {
		klog.Warningf("Failed to load ldap setting for providers: %v", err)
	} else if setting.Enabled {
		credentialProviders = append(credentialProviders, model.AuthProviderLDAP)
	}

	credentialProviders = uniqueStrings(credentialProviders)
	providers := append(append([]string{}, credentialProviders...), oauthProviders...)

	c.JSON(http.StatusOK, gin.H{
		"providers":           providers,
		"credentialProviders": credentialProviders,
		"oauthProviders":      oauthProviders,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	provider := c.Query("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"message": "Provider parameter is required",
		})
		return
	}

	oauthProvider, err := h.manager.GetProvider(c, provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"message": err.Error(),
		})
		return
	}

	state := h.manager.GenerateState()

	klog.V(1).Infof("OAuth Login - Provider: %s, State: %s", provider, state)

	// Store state and provider in cookies with SameSite=Lax and Secure when appropriate
	setCookieSecure(c, "oauth_state", state, 600)
	setCookieSecure(c, "oauth_provider", provider, 600)

	authURL := oauthProvider.GetAuthURL(state)
	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
		"provider": provider,
	})
}

func (h *AuthHandler) PasswordLogin(c *gin.Context) {
	h.handleCredentialLogin(c, model.AuthProviderPassword, h.authenticatePasswordUser)
}

func (h *AuthHandler) LDAPLogin(c *gin.Context) {
	h.handleCredentialLogin(c, model.AuthProviderLDAP, h.authenticateAndSyncLDAPUser)
}

func (h *AuthHandler) handleCredentialLogin(c *gin.Context, provider string, authenticate credentialAuthenticator) {
	var req common.PasswordLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	username := strings.TrimSpace(req.Username)
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request payload"})
		return
	}

	user, err := authenticate(username, req.Password)
	if err != nil {
		errMsg := fmt.Sprintf("%s login failed for %s: %v", strings.ToUpper(provider), username, err)
		klog.Warning(errMsg)
		if isCredentialFailure(err) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": errMsg})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": errMsg})
		return
	}

	h.completePasswordLikeLogin(c, user)
}

func (h *AuthHandler) completePasswordLikeLogin(c *gin.Context, user *model.User) {
	if !user.Enabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		return
	}

	roles := rbac.GetUserRoles(*user)
	if len(roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		return
	}

	if err := model.LoginUser(user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed login"})
		return
	}

	jwtToken, err := h.manager.GenerateJWT(user, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate JWT"})
		return
	}

	setCookieSecure(c, "auth_token", jwtToken, common.CookieExpirationSeconds)

	c.Status(http.StatusNoContent)
}

func (h *AuthHandler) authenticateAndSyncLDAPUser(username, password string) (*model.User, error) {
	setting, err := model.GetLDAPSetting()
	if err != nil {
		return nil, err
	}

	ldapUser, err := h.ldap.Authenticate(setting, username, password)
	if err != nil {
		return nil, err
	}

	syncedUser, err := model.UpsertLDAPUser(ldapUser)
	if err != nil {
		if errors.Is(err, model.ErrUserProviderConflict) {
			return nil, ErrLDAPInvalidCredentials
		}
		return nil, err
	}

	return syncedUser, nil
}

func (h *AuthHandler) authenticatePasswordUser(username, password string) (*model.User, error) {
	user, err := model.GetUserByUsername(username)
	switch {
	case err == nil:
		if user.Provider != "" && user.Provider != model.AuthProviderPassword {
			return nil, errInvalidCredentials
		}
		if !model.CheckPassword(user.Password, password) {
			return nil, errInvalidCredentials
		}
		return user, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, errInvalidCredentials
	default:
		return nil, err
	}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func isCredentialFailure(err error) bool {
	return errors.Is(err, errInvalidCredentials) ||
		errors.Is(err, ErrLDAPInvalidCredentials) ||
		errors.Is(err, ErrLDAPDisabled) ||
		errors.Is(err, ErrLDAPNotConfigured)
}

func (h *AuthHandler) Callback(c *gin.Context) {
	base := common.Base
	code := c.Query("code")
	provider, err := c.Cookie("oauth_provider")
	if err != nil {
		klog.Error("OAuth Callback - No provider found in cookie: ", err)
		c.Redirect(http.StatusFound, base+"/login?error=missing_provider&reason=no_provider_in_cookie")
		return
	}

	stateParam := c.Query("state")
	cookieState, stateErr := c.Cookie("oauth_state")

	klog.V(1).Infof("OAuth Callback - Using provider: %s\n", provider)

	// Validate state to protect against CSRF and authorization code injection
	if stateErr != nil || stateParam == "" || cookieState == "" || stateParam != cookieState {
		klog.Warningf("OAuth Callback - state mismatch or missing (cookieState=%v, stateParam=%v, err=%v)", cookieState, stateParam, stateErr)
		// Clear oauth cookies
		setCookieSecure(c, "oauth_state", "", -1)
		setCookieSecure(c, "oauth_provider", "", -1)
		c.Redirect(http.StatusFound, base+"/login?error=invalid_state&reason=state_mismatch")
		return
	}

	// Clear oauth cookies now that state is validated
	setCookieSecure(c, "oauth_state", "", -1)
	setCookieSecure(c, "oauth_provider", "", -1)

	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Authorization code not provided",
		})
		return
	}

	// Get the OAuth provider
	oauthProvider, err := h.manager.GetProvider(c, provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Provider not found: " + provider,
		})
		return
	}

	klog.V(1).Infof("OAuth Callback - Exchanging code for token with provider: %s", provider)
	// Exchange code for token
	tokenResp, err := oauthProvider.ExchangeCodeForToken(code)
	if err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=token_exchange_failed&reason=token_exchange_failed&provider="+provider)
		return
	}

	klog.V(1).Infof("OAuth Callback - Getting user info with provider: %s", provider)
	// Get user info
	user, err := oauthProvider.GetUserInfo(tokenResp.AccessToken)
	if err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=user_info_failed&reason=user_info_failed&provider="+provider)
		return
	}

	if user.Sub == "" {
		c.Redirect(http.StatusFound, base+"/login?error=user_info_failed&reason=user_info_failed&provider="+provider)
		return
	}

	if err := model.FindWithSubOrUpsertUser(user); err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=user_upsert_failed&reason=user_upsert_failed&provider="+provider)
		return
	}
	klog.V(1).Infof("OAuth Callback - User details: Username=%s, Name=%s, Sub=%s, Email=%s, OIDCGroups=%v",
		user.Username, user.Name, user.Sub, user.Username, user.OIDCGroups)
	role := rbac.GetUserRoles(*user)
	if len(role) == 0 {
		klog.Warningf("OAuth Callback - Access denied for user: %s (provider: %s), Username: %s, Name: %s, Sub: %s, OIDCGroups: %v",
			user.Key(), provider, user.Username, user.Name, user.Sub, user.OIDCGroups)
		c.Redirect(http.StatusFound, base+"/login?error=insufficient_permissions&reason=insufficient_permissions&user="+user.Key()+"&provider="+provider)
		return
	}
	if !user.Enabled {
		c.Redirect(http.StatusFound, base+"/login?error=user_disabled&reason=user_disabled")
		return
	}

	// Generate JWT with refresh token support
	jwtToken, err := h.manager.GenerateJWT(user, tokenResp.RefreshToken)
	if err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=jwt_generation_failed&reason=jwt_generation_failed&user="+user.Key()+"&provider="+provider)
		return
	}

	// Set JWT as HTTP-only cookie with secure/samesite settings
	setCookieSecure(c, "auth_token", jwtToken, common.CookieExpirationSeconds)

	c.Redirect(http.StatusFound, base+"/")
}

func (h *AuthHandler) Logout(c *gin.Context) {
	setCookieSecure(c, "auth_token", "", -1)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Logged out successfully",
	})
}

func (h *AuthHandler) GetUser(c *gin.Context) {
	user, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Not authenticated",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": user,
	})
}

func (h *AuthHandler) RequireAPIKeyAuth(c *gin.Context, token string) {
	keyPart := strings.SplitN(token, "-", 2)
	if len(keyPart) < 2 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key",
		})
		c.Abort()
		return
	}
	id := keyPart[0]
	key := keyPart[1]
	dbID, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key",
		})
		c.Abort()
		return
	}
	apikey, err := model.GetUserByIDCached(dbID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key",
		})
		c.Abort()
		return
	}
	if key != string(apikey.APIKey) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key",
		})
		c.Abort()
		return
	}
	_ = model.LoginUser(apikey)
	apikey.Roles = rbac.GetUserRoles(*apikey)
	c.Set("user", *apikey)
}

func (h *AuthHandler) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if common.AnonymousUserEnabled {
			u := model.GetAnonymousUser()
			if u == nil {
				c.Set("user", model.AnonymousUser)
			} else {
				u.Roles = model.AnonymousUser.Roles
				c.Set("user", *u)
			}
			c.Next()
			return
		}
		authHeader := c.GetHeader("Authorization")
		// bot token
		if authHeader != "" {
			if after, ok := strings.CutPrefix(authHeader, "kite"); ok {
				h.RequireAPIKeyAuth(c, after)
				return
			}
		}
		// Try to read auth token cookie (if missing, tokenString will be empty)
		tokenString, _ := c.Cookie("auth_token")
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or expired token",
			})
			c.Abort()
			return
		}

		// Validate and potentially refresh the token
		claims, err := h.manager.ValidateJWT(tokenString)
		if err != nil {
			// Try to refresh the token if validation fails
			refreshedToken, refreshErr := h.manager.RefreshJWT(c, tokenString)
			if refreshErr != nil {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid or expired token",
				})
				setCookieSecure(c, "auth_token", "", -1)
				c.Abort()
				return
			}
			setCookieSecure(c, "auth_token", refreshedToken, common.CookieExpirationSeconds)
			// Validate the refreshed token
			claims, err = h.manager.ValidateJWT(refreshedToken)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Failed to validate refreshed token",
				})
				setCookieSecure(c, "auth_token", "", -1)
				c.Abort()
				return
			}
		}
		user, err := model.GetUserByIDCached(uint64(claims.UserID))
		if err != nil || !user.Enabled {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "user not found",
			})
			setCookieSecure(c, "auth_token", "", -1)
			c.Abort()
			return
		}
		user.Roles = rbac.GetUserRoles(*user)
		c.Set("user", *user)
		c.Next()
	}
}

func (h *AuthHandler) RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, exists := c.Get("user")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Not authenticated",
			})
			c.Abort()
			return
		}

		u := user.(model.User)
		if !rbac.UserHasRole(u, model.DefaultAdminRole.Name) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Admin role required",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	// Get token from cookie
	tokenString, err := c.Cookie("auth_token")
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No token found",
		})
		return
	}

	// Refresh the token
	newToken, err := h.manager.RefreshJWT(c, tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Failed to refresh token",
		})
		return
	}

	// Update the cookie with the new token
	setCookieSecure(c, "auth_token", newToken, common.CookieExpirationSeconds)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Token refreshed successfully",
	})
}

// OAuth Provider Management APIs

func (h *AuthHandler) ListOAuthProviders(c *gin.Context) {
	providers, err := model.GetAllOAuthProviders()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to retrieve OAuth providers",
		})
		return
	}

	// Don't expose client secrets in the response
	for i := range providers {
		providers[i].ClientSecret = "***"
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

func (h *AuthHandler) CreateOAuthProvider(c *gin.Context) {
	var provider model.OAuthProvider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request payload: " + err.Error(),
		})
		return
	}

	provider.Name = model.LowerCaseString(model.NormalizeOAuthProviderName(string(provider.Name)))

	// Validate required fields
	if provider.Name == "" || provider.ClientID == "" || string(provider.ClientSecret) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Name, ClientID, and ClientSecret are required",
		})
		return
	}
	if model.IsReservedOAuthProviderName(string(provider.Name)) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": model.ErrReservedOAuthProviderName.Error(),
		})
		return
	}

	if err := model.CreateOAuthProvider(&provider); err != nil {
		if errors.Is(err, model.ErrReservedOAuthProviderName) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create OAuth provider: " + err.Error(),
		})
		return
	}

	// Note: Providers are now loaded dynamically from database, no reload needed

	// Don't expose client secret in response
	provider.ClientSecret = "***"
	c.JSON(http.StatusCreated, gin.H{
		"provider": provider,
	})
}

func (h *AuthHandler) UpdateOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	var provider model.OAuthProvider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request payload: " + err.Error(),
		})
		return
	}

	// Parse ID and set it
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}
	provider.ID = uint(dbID)
	provider.Name = model.LowerCaseString(model.NormalizeOAuthProviderName(string(provider.Name)))

	// Validate required fields
	if provider.Name == "" || provider.ClientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Name and ClientID are required",
		})
		return
	}
	if model.IsReservedOAuthProviderName(string(provider.Name)) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": model.ErrReservedOAuthProviderName.Error(),
		})
		return
	}

	updates := map[string]interface{}{
		"name":          provider.Name,
		"client_id":     provider.ClientID,
		"auth_url":      provider.AuthURL,
		"token_url":     provider.TokenURL,
		"user_info_url": provider.UserInfoURL,
		"scopes":        provider.Scopes,
		"issuer":        provider.Issuer,
		"enabled":       provider.Enabled,
	}
	if provider.ClientSecret != "" {
		updates["client_secret"] = provider.ClientSecret
	}

	if err := model.UpdateOAuthProvider(&provider, updates); err != nil {
		if errors.Is(err, model.ErrReservedOAuthProviderName) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update OAuth provider: " + err.Error(),
		})
		return
	}
	// Don't expose client secret in response
	provider.ClientSecret = "***"
	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
	})
}

func (h *AuthHandler) DeleteOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}

	if err := model.DeleteOAuthProvider(uint(dbID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete OAuth provider: " + err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "OAuth provider deleted successfully",
	})
}

func (h *AuthHandler) GetOAuthProvider(c *gin.Context) {
	id := c.Param("id")
	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}

	var provider model.OAuthProvider
	if err := model.DB.First(&provider, uint(dbID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "OAuth provider not found",
		})
		return
	}

	provider.ClientSecret = "***"
	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
	})
}

// setCookieSecure sets a cookie with SameSite=Lax and HttpOnly=true. It marks Secure=true
// when the request is over TLS or X-Forwarded-Proto indicates https, or when
// common.Host appears to be an https scheme.
func setCookieSecure(c *gin.Context, name, value string, maxAge int) {
	// Determine if secure should be set
	secure := strings.HasPrefix(common.Host, "https://") || (c.Request != nil && (c.Request.TLS != nil || strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")))

	// Set SameSite to Lax for OAuth flows while still providing CSRF protection
	c.SetSameSite(http.SameSiteLaxMode)
	// The SetCookie function signature is (name, value string, maxAge int, path, domain string, secure, httpOnly bool)
	c.SetCookie(name, value, maxAge+60*60, "/", "", secure, true)
}
