package auth

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/zxh326/kite/pkg/model"
)

var (
	ErrLDAPDisabled           = errors.New("ldap authentication is disabled")
	ErrLDAPInvalidCredentials = errors.New("invalid ldap credentials")
	ErrLDAPNotConfigured      = errors.New("ldap authentication is not configured")
)

type ldapConfig struct {
	ServerURL            string
	UseStartTLS          bool
	BindDN               string
	BindPassword         string
	UserBaseDN           string
	UserFilter           string
	UsernameAttribute    string
	DisplayNameAttribute string
	GroupBaseDN          string
	GroupFilter          string
	GroupNameAttribute   string
}

type LDAPAuthenticator struct{}

func NewLDAPAuthenticator() *LDAPAuthenticator {
	return &LDAPAuthenticator{}
}

func (a *LDAPAuthenticator) Authenticate(setting *model.LDAPSetting, username, password string) (*model.User, error) {
	cfg, err := newLDAPConfig(setting)
	if err != nil {
		return nil, err
	}
	if password == "" {
		return nil, ErrLDAPInvalidCredentials
	}

	conn, parsedURL, err := dialLDAP(cfg)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = conn.Close()
	}()

	if cfg.UseStartTLS && parsedURL.Scheme == "ldap" {
		if err := conn.StartTLS(&tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: parsedURL.Hostname(),
		}); err != nil {
			return nil, fmt.Errorf("failed to start ldap tls: %w", err)
		}
	}

	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		return nil, fmt.Errorf("failed to bind ldap service account: %w", err)
	}

	entry, err := findLDAPUser(conn, cfg, username)
	if err != nil {
		return nil, err
	}

	if err := conn.Bind(entry.DN, password); err != nil {
		return nil, ErrLDAPInvalidCredentials
	}

	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		return nil, fmt.Errorf("failed to rebind ldap service account: %w", err)
	}

	groups, err := findLDAPGroups(conn, cfg, entry.DN)
	if err != nil {
		return nil, err
	}

	canonicalUsername := strings.TrimSpace(entry.GetAttributeValue(cfg.UsernameAttribute))
	if canonicalUsername == "" {
		canonicalUsername = strings.TrimSpace(username)
	}

	displayName := strings.TrimSpace(entry.GetAttributeValue(cfg.DisplayNameAttribute))
	if displayName == "" {
		displayName = canonicalUsername
	}

	return &model.User{
		Username:   canonicalUsername,
		Name:       displayName,
		Provider:   model.AuthProviderLDAP,
		Password:   "",
		OIDCGroups: groups,
		Enabled:    true,
	}, nil
}

func newLDAPConfig(setting *model.LDAPSetting) (ldapConfig, error) {
	if setting == nil || !setting.Enabled {
		return ldapConfig{}, ErrLDAPDisabled
	}

	normalized := setting.Normalized()
	if err := normalized.Validate(); err != nil {
		return ldapConfig{}, ErrLDAPNotConfigured
	}

	return ldapConfig{
		ServerURL:            normalized.ServerURL,
		UseStartTLS:          normalized.UseStartTLS,
		BindDN:               normalized.BindDN,
		BindPassword:         string(normalized.BindPassword),
		UserBaseDN:           normalized.UserBaseDN,
		UserFilter:           normalized.UserFilter,
		UsernameAttribute:    normalized.UsernameAttribute,
		DisplayNameAttribute: normalized.DisplayNameAttribute,
		GroupBaseDN:          normalized.GroupBaseDN,
		GroupFilter:          normalized.GroupFilter,
		GroupNameAttribute:   normalized.GroupNameAttribute,
	}, nil
}

func dialLDAP(cfg ldapConfig) (*ldap.Conn, *url.URL, error) {
	parsedURL, err := url.Parse(cfg.ServerURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid ldap url: %w", err)
	}
	if parsedURL.Scheme != "ldap" && parsedURL.Scheme != "ldaps" {
		return nil, nil, fmt.Errorf("unsupported ldap scheme: %s", parsedURL.Scheme)
	}
	if parsedURL.Host == "" {
		return nil, nil, errors.New("ldap host is empty")
	}

	conn, err := ldap.DialURL(
		cfg.ServerURL,
		ldap.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to connect to ldap: %w", err)
	}

	return conn, parsedURL, nil
}

func findLDAPUser(conn *ldap.Conn, cfg ldapConfig, username string) (*ldap.Entry, error) {
	filter, err := formatLDAPFilter(cfg.UserFilter, ldap.EscapeFilter(strings.TrimSpace(username)))
	if err != nil {
		return nil, err
	}
	request := ldap.NewSearchRequest(
		cfg.UserBaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		2,
		0,
		false,
		filter,
		[]string{cfg.UsernameAttribute, cfg.DisplayNameAttribute},
		nil,
	)

	result, err := conn.Search(request)
	if err != nil {
		return nil, fmt.Errorf("failed to search ldap user: %w", err)
	}
	if len(result.Entries) != 1 {
		return nil, ErrLDAPInvalidCredentials
	}

	return result.Entries[0], nil
}

func findLDAPGroups(conn *ldap.Conn, cfg ldapConfig, userDN string) (model.SliceString, error) {
	filter, err := formatLDAPFilter(cfg.GroupFilter, ldap.EscapeFilter(strings.TrimSpace(userDN)))
	if err != nil {
		return nil, err
	}
	request := ldap.NewSearchRequest(
		cfg.GroupBaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		0,
		0,
		false,
		filter,
		[]string{cfg.GroupNameAttribute},
		nil,
	)

	result, err := conn.Search(request)
	if err != nil {
		return nil, fmt.Errorf("failed to search ldap groups: %w", err)
	}

	seen := make(map[string]struct{}, len(result.Entries))
	groups := make([]string, 0, len(result.Entries))
	for _, entry := range result.Entries {
		groupName := strings.TrimSpace(entry.GetAttributeValue(cfg.GroupNameAttribute))
		if groupName == "" {
			continue
		}
		if _, exists := seen[groupName]; exists {
			continue
		}
		seen[groupName] = struct{}{}
		groups = append(groups, groupName)
	}
	sort.Strings(groups)

	return model.SliceString(groups), nil
}

func formatLDAPFilter(template, value string) (string, error) {
	if !model.HasExactlyOneLDAPPlaceholder(template) {
		return "", ErrLDAPNotConfigured
	}
	return fmt.Sprintf(template, value), nil
}
