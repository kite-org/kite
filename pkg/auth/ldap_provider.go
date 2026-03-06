package auth

import (
	"fmt"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

// LDAPProvider implements OAuthProvider interface for LDAP authentication
type LDAPProvider struct {
	Config LDAPConfig
	Name   string
}

// LDAPConfig holds LDAP configuration
type LDAPConfig struct {
	ServerURL    string
	BindDN       string
	BindPassword string
	BaseDN       string
	UserFilter   string
	GroupFilter  string
	UsernameAttr string
	EmailAttr    string
	NameAttr     string
}

// NewLDAPProvider creates a new LDAP provider
func NewLDAPProvider(op model.OAuthProvider) (*LDAPProvider, error) {
	// Parse LDAP configuration from the OAuth provider fields
	// We'll use the following mapping:
	// - ClientID: LDAP Server URL
	// - ClientSecret: Bind Password
	// - Scopes: Bind DN
	// - AuthURL: Base DN
	// - TokenURL: User Filter
	// - UserInfoURL: Group Filter
	// - Issuer: Username Attribute

	config := LDAPConfig{
		ServerURL:    op.ClientID,
		BindPassword: string(op.ClientSecret),
		BindDN:       op.Scopes,
		BaseDN:       op.AuthURL,
		UserFilter:   op.TokenURL,
		GroupFilter:  op.UserInfoURL,
		UsernameAttr: op.Issuer,
	}

	// Set default values if not provided
	if config.UsernameAttr == "" {
		config.UsernameAttr = "uid"
	}
	if config.EmailAttr == "" {
		config.EmailAttr = "mail"
	}
	if config.NameAttr == "" {
		config.NameAttr = "cn"
	}
	if config.UserFilter == "" {
		config.UserFilter = "(uid=%s)"
	}

	return &LDAPProvider{
		Config: config,
		Name:   string(op.Name),
	}, nil
}

func (l *LDAPProvider) GetProviderName() string {
	return l.Name
}

func (l *LDAPProvider) GetAuthURL(state string) string {
	// LDAP doesn't use OAuth flow, so this is not used
	return ""
}

func (l *LDAPProvider) ExchangeCodeForToken(code string) (*TokenResponse, error) {
	// LDAP doesn't use OAuth flow, so this is not used
	return nil, fmt.Errorf("LDAP doesn't support token exchange")
}

func (l *LDAPProvider) RefreshToken(refreshToken string) (*TokenResponse, error) {
	// LDAP doesn't use OAuth flow, so this is not used
	return nil, fmt.Errorf("LDAP doesn't support token refresh")
}

// TestConnection tests the LDAP connection and returns the connection object
func (l *LDAPProvider) TestConnection() (*ldap.Conn, error) {
	// Connect to LDAP server
	conn, err := ldap.DialURL(l.Config.ServerURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to LDAP server: %w", err)
	}

	// Set timeout
	conn.SetTimeout(10 * time.Second)

	// Bind with service account
	if l.Config.BindDN != "" && l.Config.BindPassword != "" {
		err = conn.Bind(l.Config.BindDN, l.Config.BindPassword)
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("failed to bind with service account: %w", err)
		}
	} else {
		// Anonymous bind if no service account provided
		err = conn.Bind("", "")
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("failed to bind anonymously: %w", err)
		}
	}

	return conn, nil
}

func (l *LDAPProvider) GetUserInfo(accessToken string) (*model.User, error) {
	// For LDAP, the accessToken is actually the username:password
	parts := strings.SplitN(accessToken, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid LDAP credentials format")
	}

	username := parts[0]
	password := parts[1]

	// Connect to LDAP server
	conn, err := ldap.DialURL(l.Config.ServerURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to LDAP server: %w", err)
	}
	defer conn.Close()

	// Set timeout
	conn.SetTimeout(10 * time.Second)

	// Bind with service account
	if l.Config.BindDN != "" && l.Config.BindPassword != "" {
		err = conn.Bind(l.Config.BindDN, l.Config.BindPassword)
		if err != nil {
			return nil, fmt.Errorf("failed to bind with service account: %w", err)
		}
	} else {
		// Anonymous bind if no service account provided
		err = conn.Bind("", "")
		if err != nil {
			return nil, fmt.Errorf("failed to bind anonymously: %w", err)
		}
	}

	// Search for user
	userFilter := fmt.Sprintf(l.Config.UserFilter, ldap.EscapeFilter(username))
	searchRequest := ldap.NewSearchRequest(
		l.Config.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		0,
		0,
		false,
		userFilter,
		[]string{l.Config.UsernameAttr, l.Config.EmailAttr, l.Config.NameAttr, "dn"},
		nil,
	)

	searchResult, err := conn.Search(searchRequest)
	if err != nil {
		return nil, fmt.Errorf("failed to search for user: %w", err)
	}

	if len(searchResult.Entries) == 0 {
		return nil, fmt.Errorf("user not found")
	}

	userEntry := searchResult.Entries[0]
	userDN := userEntry.DN

	// Bind with user credentials to verify
	err = conn.Bind(userDN, password)
	if err != nil {
		return nil, fmt.Errorf("invalid credentials: %w", err)
	}

	// Get user attributes
	user := &model.User{
		Provider: l.Name,
	}

	// Set username
	if attr := userEntry.GetAttributeValue(l.Config.UsernameAttr); attr != "" {
		user.Username = attr
	} else {
		user.Username = username
	}

	// Set name
	if attr := userEntry.GetAttributeValue(l.Config.NameAttr); attr != "" {
		user.Name = attr
	} else {
		user.Name = username
	}

	// Set sub (unique identifier)
	user.Sub = userDN

	// Get groups if group filter is provided
	if l.Config.GroupFilter != "" {
		groupFilter := fmt.Sprintf(l.Config.GroupFilter, ldap.EscapeFilter(userDN))
		groupSearchRequest := ldap.NewSearchRequest(
			l.Config.BaseDN,
			ldap.ScopeWholeSubtree,
			ldap.NeverDerefAliases,
			0,
			0,
			false,
			groupFilter,
			[]string{"cn"},
			nil,
		)

		groupSearchResult, err := conn.Search(groupSearchRequest)
		if err != nil {
			klog.Warningf("Failed to search for groups: %v", err)
		} else {
			groups := make([]string, 0, len(groupSearchResult.Entries))
			for _, entry := range groupSearchResult.Entries {
				if cn := entry.GetAttributeValue("cn"); cn != "" {
					groups = append(groups, cn)
				}
			}
			if len(groups) > 0 {
				user.OIDCGroups = groups
				klog.V(1).Infof("Extracted %d groups from LDAP for user %s", len(groups), user.Username)
			}
		}
	}

	return user, nil
}
