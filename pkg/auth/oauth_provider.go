package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

const (
	// Microsoft Graph API endpoints
	graphAPIBaseURL  = "https://graph.microsoft.com/v1.0"
	graphAPIMemberOf = graphAPIBaseURL + "/me/memberOf"
)

// OAuthProvider defines the interface for OAuth providers
type OAuthProvider interface {
	GetAuthURL(state string) string
	ExchangeCodeForToken(code string) (*TokenResponse, error)
	GetUserInfo(accessToken string) (*model.User, error)
	RefreshToken(refreshToken string) (*TokenResponse, error)
	GetProviderName() string
}

// OAuthConfig holds common OAuth configuration
type OAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       string
}

// TokenResponse represents OAuth token response with refresh token support
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	Scope        string `json:"scope"`
}

// Claims represents JWT claims with refresh token support
type Claims struct {
	UserID       uint   `json:"user_id"`
	Username     string `json:"username"`
	Provider     string `json:"provider"`
	RefreshToken string `json:"refresh_token,omitempty"`
	jwt.RegisteredClaims
}

type GenericProvider struct {
	Config        OAuthConfig
	AuthURL       string
	TokenURL      string
	UserInfoURL   string
	Name          string
	UsernameClaim string
	GroupsClaim   string
	AllowedGroups []string
}

// discoverOAuthEndpoints discovers OAuth endpoints from issuer's well-known configuration
// TODO: cache well-known configuration
func discoverOAuthEndpoints(issuer, providerName string) (*struct {
	AuthURL     string
	TokenURL    string
	UserInfoURL string
}, error) {
	wellKnown := issuer
	var err error
	if !strings.HasSuffix(issuer, "/.well-known/openid-configuration") {
		wellKnown, err = url.JoinPath(issuer, ".well-known", "openid-configuration")
		if err != nil {
			return nil, fmt.Errorf("failed to construct well-known URL: %w", err)
		}
	}

	resp, err := http.Get(wellKnown)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch well-known configuration: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to fetch well-known configuration: HTTP %d", resp.StatusCode)
	}

	var meta struct {
		AuthorizationEndpoint string `json:"authorization_endpoint"`
		TokenEndpoint         string `json:"token_endpoint"`
		UserinfoEndpoint      string `json:"userinfo_endpoint"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		klog.Warningf("Failed to parse well-known configuration for %s: %v", providerName, err)
		return nil, fmt.Errorf("failed to parse well-known configuration: %w", err)
	}

	klog.V(1).Infof("Discovered %s openid configuration", providerName)
	return &struct {
		AuthURL     string
		TokenURL    string
		UserInfoURL string
	}{
		AuthURL:     meta.AuthorizationEndpoint,
		TokenURL:    meta.TokenEndpoint,
		UserInfoURL: meta.UserinfoEndpoint,
	}, nil
}

func NewGenericProvider(op model.OAuthProvider) (*GenericProvider, error) {
	if op.Issuer != "" && (op.AuthURL == "" || op.TokenURL == "" || op.UserInfoURL == "") {
		meta, err := discoverOAuthEndpoints(op.Issuer, string(op.Name))
		if err != nil {
			klog.Errorf("Failed to discover OAuth endpoints for %s: %v", op.Name, err)
			return nil, err
		}
		op.AuthURL = meta.AuthURL
		op.TokenURL = meta.TokenURL
		op.UserInfoURL = meta.UserInfoURL
	}
	if op.AuthURL == "" || op.TokenURL == "" || op.UserInfoURL == "" {
		return nil, fmt.Errorf("provider %s is missing required URLs", op.Name)
	}

	scopes := []string{}
	if op.Scopes != "" {
		scopes = strings.Split(op.Scopes, ",")
	}

	allowedGroups := []string{}
	if op.AllowedGroups != "" {
		for _, g := range strings.Split(op.AllowedGroups, ",") {
			g = strings.TrimSpace(g)
			if g != "" {
				allowedGroups = append(allowedGroups, g)
			}
		}
	}

	gp := &GenericProvider{
		Config: OAuthConfig{
			ClientID:     op.ClientID,
			ClientSecret: string(op.ClientSecret),
			RedirectURL:  op.RedirectURL,
			Scopes:       strings.Join(scopes, " "),
		},
		AuthURL:       op.AuthURL,
		TokenURL:      op.TokenURL,
		UserInfoURL:   op.UserInfoURL,
		Name:          string(op.Name),
		UsernameClaim: op.UsernameClaim,
		GroupsClaim:   op.GroupsClaim,
		AllowedGroups: allowedGroups,
	}
	return gp, nil
}

func (g *GenericProvider) GetProviderName() string {
	return g.Name
}

func (g *GenericProvider) GetAuthURL(state string) string {
	params := url.Values{}
	params.Add("client_id", g.Config.ClientID)
	params.Add("redirect_uri", g.Config.RedirectURL)
	// TODO: fix me
	params.Add("scope", g.Config.Scopes)
	params.Add("state", state)
	params.Add("response_type", "code")

	return g.AuthURL + "?" + params.Encode()
}

func (g *GenericProvider) ExchangeCodeForToken(code string) (*TokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", g.Config.ClientID)
	data.Set("client_secret", g.Config.ClientSecret)
	data.Set("code", code)
	data.Set("grant_type", "authorization_code")
	data.Set("redirect_uri", g.Config.RedirectURL)

	req, err := http.NewRequest("POST", g.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	return &tokenResp, nil
}

func (g *GenericProvider) RefreshToken(refreshToken string) (*TokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", g.Config.ClientID)
	data.Set("client_secret", g.Config.ClientSecret)
	data.Set("refresh_token", refreshToken)
	data.Set("grant_type", "refresh_token")

	req, err := http.NewRequest("POST", g.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	return &tokenResp, nil
}

// ErrNotInAllowedGroups is returned when a user successfully authenticates but does not belong to any specified AllowedGroups.
var ErrNotInAllowedGroups = errors.New("user is not in any of the allowed groups")

func (g *GenericProvider) GetUserInfo(accessToken string) (*model.User, error) {
	userInfo, err := g.fetchUserInfo(accessToken)
	if err != nil {
		return nil, err
	}

	klog.V(1).Infof("User info from %s: %v", g.Name, userInfo)

	user := &model.User{
		Provider:   g.Name,
		Sub:        extractSub(userInfo),
		Username:   extractUsername(userInfo, g.UsernameClaim),
		Name:       extractName(userInfo),
		AvatarURL:  extractAvatarURL(userInfo),
		OIDCGroups: g.extractOIDCGroups(userInfo, accessToken),
	}
	if !isAllowedGroup(user.OIDCGroups, g.AllowedGroups) {
		klog.Warningf("User %s is not in any allowed groups %v (user groups: %v)", user.Username, g.AllowedGroups, user.OIDCGroups)
		return nil, ErrNotInAllowedGroups
	}

	return user, nil
}

func (g *GenericProvider) fetchUserInfo(accessToken string) (map[string]interface{}, error) {
	req, err := http.NewRequest("GET", g.UserInfoURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	var userInfo map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}

	return userInfo, nil
}

func extractSub(userInfo map[string]interface{}) string {
	if userid, ok := userInfo["userid"]; ok {
		return fmt.Sprintf("%v", userid)
	}
	return firstClaimValue(userInfo, "id", "sub", "oid")
}

func extractUsername(userInfo map[string]interface{}, customClaim string) string {
	if value := customClaimValue(userInfo, customClaim); value != "" {
		return value
	}
	return firstClaimValue(userInfo, "username", "login", "userPrincipalName", "preferred_username", "upn", "email")
}

func extractName(userInfo map[string]interface{}) string {
	name := firstClaimValue(userInfo, "name", "displayName")
	if nickname, ok := userInfo["nickname"]; ok {
		return fmt.Sprintf("%v", nickname)
	}
	return name
}

func extractAvatarURL(userInfo map[string]interface{}) string {
	return firstClaimValue(userInfo, "avatar_url", "picture")
}

func customClaimValue(userInfo map[string]interface{}, claim string) string {
	if claim == "" {
		return ""
	}
	if value, ok := userInfo[claim]; ok && value != "" {
		return fmt.Sprintf("%v", value)
	}
	return ""
}

func firstClaimValue(userInfo map[string]interface{}, claims ...string) string {
	for _, claim := range claims {
		if value, ok := userInfo[claim]; ok {
			return fmt.Sprintf("%v", value)
		}
	}
	return ""
}

func (g *GenericProvider) extractOIDCGroups(userInfo map[string]interface{}, accessToken string) []string {
	groups := extractClaimGroups(userInfo, g.GroupsClaim)
	if len(groups) == 0 {
		groups = extractClaimGroups(userInfo, "groups", "roles")
	}

	if len(groups) == 0 && strings.Contains(g.UserInfoURL, "graph.microsoft.com") {
		klog.V(1).Infof("No groups in user info, fetching from /me/memberOf for %s", g.Name)
		memberOfGroups, err := g.fetchAzureADGroups(accessToken)
		if err != nil {
			klog.Warningf("Failed to fetch groups from /me/memberOf: %v", err)
		} else {
			groups = memberOfGroups
		}
	}

	if len(groups) == 0 {
		klog.V(1).Infof("No groups/roles found in user info from %s", g.Name)
		return nil
	}

	oidcGroups := make([]string, len(groups))
	for i, value := range groups {
		oidcGroups[i] = fmt.Sprintf("%v", value)
	}
	klog.V(1).Infof("Extracted %d groups/roles from %s", len(oidcGroups), g.Name)
	return oidcGroups
}

func extractClaimGroups(userInfo map[string]interface{}, claims ...string) []interface{} {
	for _, claim := range claims {
		value, ok := userInfo[claim]
		if !ok {
			continue
		}
		if arr, ok := value.([]interface{}); ok {
			return arr
		}
		if str, ok := value.(string); ok && str != "" {
			return []interface{}{str}
		}
	}
	return nil
}

func isAllowedGroup(userGroups, allowedGroups []string) bool {
	if len(allowedGroups) == 0 {
		return true
	}
	for _, userGroup := range userGroups {
		for _, allowedGroup := range allowedGroups {
			if userGroup == allowedGroup {
				return true
			}
		}
	}
	return false
}

// fetchAzureADGroups fetches group memberships from Azure AD Graph API /me/memberOf endpoint
// Handles pagination to retrieve all groups (Azure AD returns max 100 per page)
func (g *GenericProvider) fetchAzureADGroups(accessToken string) ([]interface{}, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	groups := make([]interface{}, 0)
	nextLink := graphAPIMemberOf
	totalFetched := 0

	// Follow pagination links until all groups are retrieved
	for nextLink != "" {
		req, err := http.NewRequest("GET", nextLink, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch memberOf: %w", err)
		}

		if resp.StatusCode != 200 {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("failed to fetch memberOf: HTTP %d", resp.StatusCode)
		}

		var memberOfResp struct {
			Value    []map[string]interface{} `json:"value"`
			NextLink string                   `json:"@odata.nextLink,omitempty"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&memberOfResp); err != nil {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("failed to decode memberOf response: %w", err)
		}
		_ = resp.Body.Close()

		// Extract group IDs from the current page
		// Note: Only extracting groups, not directory roles. Directory roles have @odata.type of
		// "#microsoft.graph.directoryRole" and require different handling.
		for _, item := range memberOfResp.Value {
			if itemType, ok := item["@odata.type"].(string); ok && itemType == "#microsoft.graph.group" {
				if groupID, ok := item["id"].(string); ok {
					groups = append(groups, groupID)
					klog.V(2).Infof("Found group: %s (%s)", groupID, item["displayName"])
				}
			}
		}

		totalFetched += len(memberOfResp.Value)
		nextLink = memberOfResp.NextLink

		if nextLink != "" {
			klog.V(2).Infof("Fetching next page of groups (total so far: %d)", len(groups))
		}
	}

	klog.V(1).Infof("Fetched %d groups from /me/memberOf across %d total memberships", len(groups), totalFetched)
	return groups, nil
}
