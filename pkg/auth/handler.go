package auth

import (
	"errors"

	"github.com/zxh326/kite/pkg/model"
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
