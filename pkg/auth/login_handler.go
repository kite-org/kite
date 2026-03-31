package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
	"k8s.io/klog/v2"
)

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

	if stateErr != nil || stateParam == "" || cookieState == "" || stateParam != cookieState {
		klog.Warningf("OAuth Callback - state mismatch or missing (cookieState=%v, stateParam=%v, err=%v)", cookieState, stateParam, stateErr)
		setCookieSecure(c, "oauth_state", "", -1)
		setCookieSecure(c, "oauth_provider", "", -1)
		c.Redirect(http.StatusFound, base+"/login?error=invalid_state&reason=state_mismatch")
		return
	}

	setCookieSecure(c, "oauth_state", "", -1)
	setCookieSecure(c, "oauth_provider", "", -1)

	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Authorization code not provided",
		})
		return
	}

	oauthProvider, err := h.manager.GetProvider(c, provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Provider not found: " + provider,
		})
		return
	}

	klog.V(1).Infof("OAuth Callback - Exchanging code for token with provider: %s", provider)
	tokenResp, err := oauthProvider.ExchangeCodeForToken(code)
	if err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=token_exchange_failed&reason=token_exchange_failed&provider="+provider)
		return
	}

	klog.V(1).Infof("OAuth Callback - Getting user info with provider: %s", provider)
	user, err := oauthProvider.GetUserInfo(tokenResp.AccessToken)
	if err != nil {
		if errors.Is(err, ErrNotInAllowedGroups) {
			c.Redirect(http.StatusFound, base+"/login?error=insufficient_permissions&reason=not_in_allowed_groups&provider="+provider)
			return
		}
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

	jwtToken, err := h.manager.GenerateJWT(user, tokenResp.RefreshToken)
	if err != nil {
		c.Redirect(http.StatusFound, base+"/login?error=jwt_generation_failed&reason=jwt_generation_failed&user="+user.Key()+"&provider="+provider)
		return
	}

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

	currentUser := user.(model.User)
	isAdmin := rbac.UserHasRole(currentUser, model.DefaultAdminRole.Name)
	setting, err := model.GetGeneralSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Failed to load general setting: %v", err),
		})
		return
	}

	globalSidebarPreference := strings.TrimSpace(setting.GlobalSidebarPreference)
	hasGlobalSidebarPreference := globalSidebarPreference != ""
	if hasGlobalSidebarPreference && (!isAdmin || strings.TrimSpace(currentUser.SidebarPreference) == "") {
		currentUser.SidebarPreference = globalSidebarPreference
	}

	c.JSON(http.StatusOK, gin.H{
		"user":                       currentUser,
		"hasGlobalSidebarPreference": hasGlobalSidebarPreference,
		"globalSidebarPreference":    globalSidebarPreference,
	})
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	tokenString, err := c.Cookie("auth_token")
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No token found",
		})
		return
	}

	newToken, err := h.manager.RefreshJWT(c, tokenString)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Failed to refresh token",
		})
		return
	}

	setCookieSecure(c, "auth_token", newToken, common.CookieExpirationSeconds)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Token refreshed successfully",
	})
}

func setCookieSecure(c *gin.Context, name, value string, maxAge int) {
	secure := strings.HasPrefix(common.Host, "https://") || (c.Request != nil && (c.Request.TLS != nil || strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")))

	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, maxAge+60*60, "/", "", secure, true)
}
