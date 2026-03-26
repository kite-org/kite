package auth

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
)

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
		if authHeader != "" {
			if after, ok := strings.CutPrefix(authHeader, "kite"); ok {
				h.RequireAPIKeyAuth(c, after)
				return
			}
		}
		tokenString, _ := c.Cookie("auth_token")
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or expired token",
			})
			c.Abort()
			return
		}

		claims, err := h.manager.ValidateJWT(tokenString)
		if err != nil {
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
