package model

import (
	"errors"
	"strings"
)

const AuthProviderPassword = "password"
const AuthProviderLDAP = "ldap"

const ReservedOAuthProviderNamePassword = AuthProviderPassword
const ReservedOAuthProviderNameLDAP = AuthProviderLDAP

var ErrReservedOAuthProviderName = errors.New("oauth provider names 'password' and 'ldap' are reserved for built-in credential providers")

func NormalizeOAuthProviderName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func IsReservedOAuthProviderName(name string) bool {
	switch NormalizeOAuthProviderName(name) {
	case ReservedOAuthProviderNamePassword, ReservedOAuthProviderNameLDAP:
		return true
	default:
		return false
	}
}

type OAuthProvider struct {
	Model
	Name          LowerCaseString `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	ClientID      string          `json:"clientId" gorm:"type:varchar(255);not null"`
	ClientSecret  SecretString    `json:"clientSecret" gorm:"type:text;not null"`
	AuthURL       string          `json:"authUrl" gorm:"type:varchar(255)"`
	TokenURL      string          `json:"tokenUrl" gorm:"type:varchar(255)"`
	UserInfoURL   string          `json:"userInfoUrl" gorm:"type:varchar(255)"`
	Scopes        string          `json:"scopes" gorm:"type:varchar(255);default:'openid,profile,email'"`
	Issuer        string          `json:"issuer" gorm:"type:varchar(255)"`
	Enabled       bool            `json:"enabled" gorm:"type:boolean;default:true"`
	UsernameClaim string          `json:"usernameClaim" gorm:"type:varchar(255)"`
	GroupsClaim   string          `json:"groupsClaim" gorm:"type:varchar(255)"`
	AllowedGroups string          `json:"allowedGroups" gorm:"type:text"`

	// Auto-generated redirect URL
	RedirectURL string `json:"-" gorm:"-"`
}

// GetAllOAuthProviders returns all OAuth providers from database
func GetAllOAuthProviders() ([]OAuthProvider, error) {
	var providers []OAuthProvider
	err := DB.Find(&providers).Error
	return providers, err
}

// GetEnabledOAuthProviders returns only enabled OAuth providers
func GetEnabledOAuthProviders() ([]OAuthProvider, error) {
	var providers []OAuthProvider
	err := DB.Where("enabled = ?", true).Find(&providers).Error
	return providers, err
}

// GetOAuthProviderByName returns an OAuth provider by name
func GetOAuthProviderByName(name string) (OAuthProvider, error) {
	var provider OAuthProvider
	name = NormalizeOAuthProviderName(name)
	err := DB.Where("name = ? AND enabled = ?", name, true).First(&provider).Error
	if err != nil {
		return OAuthProvider{}, err
	}
	return provider, nil
}

// CreateOAuthProvider creates a new OAuth provider
func CreateOAuthProvider(provider *OAuthProvider) error {
	if IsReservedOAuthProviderName(string(provider.Name)) {
		return ErrReservedOAuthProviderName
	}
	return DB.Create(provider).Error
}

// UpdateOAuthProvider updates an existing OAuth provider
func UpdateOAuthProvider(provider *OAuthProvider, updates map[string]interface{}) error {
	name := string(provider.Name)
	switch value := updates["name"].(type) {
	case string:
		name = value
	case LowerCaseString:
		name = string(value)
	}
	if IsReservedOAuthProviderName(name) {
		return ErrReservedOAuthProviderName
	}
	return DB.Model(provider).Updates(updates).Error
}

// DeleteOAuthProvider deletes an OAuth provider by ID
func DeleteOAuthProvider(id uint) error {
	return DB.Delete(&OAuthProvider{}, id).Error
}
