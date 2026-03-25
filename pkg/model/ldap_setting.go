package model

import (
	"errors"
	"net/url"
	"strings"

	"gorm.io/gorm"
)

const DefaultLDAPUserFilter = "(uid=%s)"
const DefaultLDAPUsernameAttribute = "uid"
const DefaultLDAPDisplayNameAttribute = "cn"
const DefaultLDAPGroupFilter = "(member=%s)"
const DefaultLDAPGroupNameAttribute = "cn"

type LDAPSetting struct {
	Model
	Enabled              bool         `json:"enabled" gorm:"column:enabled;type:boolean;not null;default:false"`
	ServerURL            string       `json:"serverUrl" gorm:"column:server_url;type:varchar(500)"`
	UseStartTLS          bool         `json:"useStartTLS" gorm:"column:use_starttls;type:boolean;not null;default:false"`
	BindDN               string       `json:"bindDn" gorm:"column:bind_dn;type:varchar(500)"`
	BindPassword         SecretString `json:"bindPassword" gorm:"column:bind_password;type:text"`
	UserBaseDN           string       `json:"userBaseDn" gorm:"column:user_base_dn;type:varchar(500)"`
	UserFilter           string       `json:"userFilter" gorm:"column:user_filter;type:varchar(500);default:'(uid=%s)'"`
	UsernameAttribute    string       `json:"usernameAttribute" gorm:"column:username_attribute;type:varchar(100);default:'uid'"`
	DisplayNameAttribute string       `json:"displayNameAttribute" gorm:"column:display_name_attribute;type:varchar(100);default:'cn'"`
	GroupBaseDN          string       `json:"groupBaseDn" gorm:"column:group_base_dn;type:varchar(500)"`
	GroupFilter          string       `json:"groupFilter" gorm:"column:group_filter;type:varchar(500);default:'(member=%s)'"`
	GroupNameAttribute   string       `json:"groupNameAttribute" gorm:"column:group_name_attribute;type:varchar(100);default:'cn'"`
}

func DefaultLDAPSetting() LDAPSetting {
	return LDAPSetting{
		Model:                Model{ID: 1},
		Enabled:              false,
		UseStartTLS:          false,
		UserFilter:           DefaultLDAPUserFilter,
		UsernameAttribute:    DefaultLDAPUsernameAttribute,
		DisplayNameAttribute: DefaultLDAPDisplayNameAttribute,
		GroupFilter:          DefaultLDAPGroupFilter,
		GroupNameAttribute:   DefaultLDAPGroupNameAttribute,
	}
}

func (s LDAPSetting) Normalized() LDAPSetting {
	defaults := DefaultLDAPSetting()
	normalized := defaults
	normalized.Model = s.Model
	if normalized.ID == 0 {
		normalized.ID = defaults.ID
	}
	normalized.Enabled = s.Enabled
	normalized.ServerURL = strings.TrimSpace(s.ServerURL)
	normalized.UseStartTLS = s.UseStartTLS
	normalized.BindDN = strings.TrimSpace(s.BindDN)
	normalized.BindPassword = s.BindPassword
	normalized.UserBaseDN = strings.TrimSpace(s.UserBaseDN)
	normalized.UserFilter = normalizeLDAPTextWithDefault(s.UserFilter, DefaultLDAPUserFilter)
	normalized.UsernameAttribute = normalizeLDAPTextWithDefault(s.UsernameAttribute, DefaultLDAPUsernameAttribute)
	normalized.DisplayNameAttribute = normalizeLDAPTextWithDefault(s.DisplayNameAttribute, DefaultLDAPDisplayNameAttribute)
	normalized.GroupBaseDN = strings.TrimSpace(s.GroupBaseDN)
	normalized.GroupFilter = normalizeLDAPTextWithDefault(s.GroupFilter, DefaultLDAPGroupFilter)
	normalized.GroupNameAttribute = normalizeLDAPTextWithDefault(s.GroupNameAttribute, DefaultLDAPGroupNameAttribute)
	return normalized
}

func (s LDAPSetting) Validate() error {
	normalized := s.Normalized()
	if !normalized.Enabled {
		return nil
	}
	if normalized.ServerURL == "" {
		return errors.New("serverUrl is required when enabled is true")
	}
	if err := validateLDAPServerURL(normalized.ServerURL); err != nil {
		return err
	}
	if normalized.BindDN == "" {
		return errors.New("bindDn is required when enabled is true")
	}
	if string(normalized.BindPassword) == "" {
		return errors.New("bindPassword is required when enabled is true")
	}
	if normalized.UserBaseDN == "" {
		return errors.New("userBaseDn is required when enabled is true")
	}
	if !HasExactlyOneLDAPPlaceholder(normalized.UserFilter) {
		return errors.New("userFilter must contain exactly one %s")
	}
	if normalized.GroupBaseDN == "" {
		return errors.New("groupBaseDn is required when enabled is true")
	}
	if !HasExactlyOneLDAPPlaceholder(normalized.GroupFilter) {
		return errors.New("groupFilter must contain exactly one %s")
	}
	return nil
}

func GetLDAPSetting() (*LDAPSetting, error) {
	setting, err := getOrCreateLDAPSetting()
	if err != nil {
		return nil, err
	}
	normalized := setting.Normalized()
	return &normalized, nil
}

func UpdateLDAPSetting(setting *LDAPSetting) (*LDAPSetting, error) {
	if setting == nil {
		return nil, errors.New("ldap setting is nil")
	}
	current, err := getOrCreateLDAPSetting()
	if err != nil {
		return nil, err
	}
	normalized := setting.Normalized()
	current.Enabled = normalized.Enabled
	current.ServerURL = normalized.ServerURL
	current.UseStartTLS = normalized.UseStartTLS
	current.BindDN = normalized.BindDN
	current.BindPassword = normalized.BindPassword
	current.UserBaseDN = normalized.UserBaseDN
	current.UserFilter = normalized.UserFilter
	current.UsernameAttribute = normalized.UsernameAttribute
	current.DisplayNameAttribute = normalized.DisplayNameAttribute
	current.GroupBaseDN = normalized.GroupBaseDN
	current.GroupFilter = normalized.GroupFilter
	current.GroupNameAttribute = normalized.GroupNameAttribute
	if err := DB.Save(current).Error; err != nil {
		return nil, err
	}
	updated := current.Normalized()
	return &updated, nil
}

func (s *LDAPSetting) BindPasswordConfigured() bool {
	if s == nil {
		return false
	}
	return string(s.BindPassword) != ""
}

func HasExactlyOneLDAPPlaceholder(template string) bool {
	count := 0
	for i := 0; i < len(template); i++ {
		if template[i] != '%' {
			continue
		}
		if i+1 >= len(template) {
			return false
		}
		switch template[i+1] {
		case '%':
			i++
		case 's':
			count++
			i++
		default:
			return false
		}
	}
	return count == 1
}

func getOrCreateLDAPSetting() (*LDAPSetting, error) {
	var setting LDAPSetting
	err := DB.First(&setting, 1).Error
	if err == nil {
		return &setting, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	setting = DefaultLDAPSetting()
	if err := DB.Create(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func normalizeLDAPTextWithDefault(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func validateLDAPServerURL(serverURL string) error {
	parsedURL, err := url.Parse(serverURL)
	if err != nil || (parsedURL.Scheme != "ldap" && parsedURL.Scheme != "ldaps") || parsedURL.Host == "" {
		return errors.New("serverUrl must be a valid ldap:// or ldaps:// URL")
	}
	return nil
}
