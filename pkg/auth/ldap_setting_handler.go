package auth

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/model"
)

type UpdateLDAPSettingRequest struct {
	Enabled              *bool   `json:"enabled"`
	ServerURL            *string `json:"serverUrl"`
	UseStartTLS          *bool   `json:"useStartTLS"`
	BindDN               *string `json:"bindDn"`
	BindPassword         *string `json:"bindPassword"`
	UserBaseDN           *string `json:"userBaseDn"`
	UserFilter           *string `json:"userFilter"`
	UsernameAttribute    *string `json:"usernameAttribute"`
	DisplayNameAttribute *string `json:"displayNameAttribute"`
	GroupBaseDN          *string `json:"groupBaseDn"`
	GroupFilter          *string `json:"groupFilter"`
	GroupNameAttribute   *string `json:"groupNameAttribute"`
}

func (h *AuthHandler) GetLDAPSetting(c *gin.Context) {
	setting, err := model.GetLDAPSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load ldap setting: %v", err)})
		return
	}

	c.JSON(http.StatusOK, ldapSettingResponse(setting))
}

func (h *AuthHandler) UpdateLDAPSetting(c *gin.Context) {
	var req UpdateLDAPSettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}

	currentSetting, err := model.GetLDAPSetting()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to load ldap setting: %v", err)})
		return
	}

	updatedSetting := mergeLDAPSetting(currentSetting, req)
	if err := updatedSetting.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updated, err := model.UpdateLDAPSetting(&updatedSetting)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update ldap setting: %v", err)})
		return
	}

	c.JSON(http.StatusOK, ldapSettingResponse(updated))
}

func ldapSettingResponse(setting *model.LDAPSetting) gin.H {
	return gin.H{
		"enabled":                setting.Enabled,
		"serverUrl":              setting.ServerURL,
		"useStartTLS":            setting.UseStartTLS,
		"bindDn":                 setting.BindDN,
		"bindPassword":           "",
		"bindPasswordConfigured": setting.BindPasswordConfigured(),
		"userBaseDn":             setting.UserBaseDN,
		"userFilter":             setting.UserFilter,
		"usernameAttribute":      setting.UsernameAttribute,
		"displayNameAttribute":   setting.DisplayNameAttribute,
		"groupBaseDn":            setting.GroupBaseDN,
		"groupFilter":            setting.GroupFilter,
		"groupNameAttribute":     setting.GroupNameAttribute,
	}
}

func mergeLDAPSetting(current *model.LDAPSetting, req UpdateLDAPSettingRequest) model.LDAPSetting {
	merged := current.Normalized()
	if req.Enabled != nil {
		merged.Enabled = *req.Enabled
	}
	if req.ServerURL != nil {
		merged.ServerURL = strings.TrimSpace(*req.ServerURL)
	}
	if req.UseStartTLS != nil {
		merged.UseStartTLS = *req.UseStartTLS
	}
	if req.BindDN != nil {
		merged.BindDN = strings.TrimSpace(*req.BindDN)
	}
	if req.BindPassword != nil && *req.BindPassword != "" {
		merged.BindPassword = model.SecretString(*req.BindPassword)
	}
	if req.UserBaseDN != nil {
		merged.UserBaseDN = strings.TrimSpace(*req.UserBaseDN)
	}
	if req.UserFilter != nil {
		merged.UserFilter = strings.TrimSpace(*req.UserFilter)
	}
	if req.UsernameAttribute != nil {
		merged.UsernameAttribute = strings.TrimSpace(*req.UsernameAttribute)
	}
	if req.DisplayNameAttribute != nil {
		merged.DisplayNameAttribute = strings.TrimSpace(*req.DisplayNameAttribute)
	}
	if req.GroupBaseDN != nil {
		merged.GroupBaseDN = strings.TrimSpace(*req.GroupBaseDN)
	}
	if req.GroupFilter != nil {
		merged.GroupFilter = strings.TrimSpace(*req.GroupFilter)
	}
	if req.GroupNameAttribute != nil {
		merged.GroupNameAttribute = strings.TrimSpace(*req.GroupNameAttribute)
	}
	return merged.Normalized()
}
