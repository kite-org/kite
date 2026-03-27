package auth

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

func (h *AuthHandler) ListOAuthProviders(c *gin.Context) {
	providers, err := model.GetAllOAuthProviders()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to retrieve OAuth providers",
		})
		return
	}

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

	dbID, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid provider ID",
		})
		return
	}
	provider.ID = uint(dbID)
	provider.Name = model.LowerCaseString(model.NormalizeOAuthProviderName(string(provider.Name)))

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
		"name":           provider.Name,
		"client_id":      provider.ClientID,
		"auth_url":       provider.AuthURL,
		"token_url":      provider.TokenURL,
		"user_info_url":  provider.UserInfoURL,
		"scopes":         provider.Scopes,
		"issuer":         provider.Issuer,
		"username_claim": provider.UsernameClaim,
		"groups_claim":   provider.GroupsClaim,
		"allowed_groups": provider.AllowedGroups,
		"enabled":        provider.Enabled,
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
