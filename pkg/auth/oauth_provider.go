package auth

import (
	"encoding/json"
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
	Config      OAuthConfig
	AuthURL     string
	TokenURL    string
	UserInfoURL string
	Name        string
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

func (g *GenericProvider) GetUserInfo(accessToken string) (*model.User, error) {
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

	klog.V(1).Infof("User info from %s: %v", g.Name, userInfo)

	// Map common fields - this might need customization per provider
	user := &model.User{
		Provider: g.Name,
	}

	user.Sub = ""
	if id, ok := userInfo["id"]; ok {
		user.Sub = fmt.Sprintf("%v", id)
	} else if sub, ok := userInfo["sub"]; ok {
		user.Sub = fmt.Sprintf("%v", sub)
	} else if oid, ok := userInfo["oid"]; ok {
		// Azure AD uses 'oid' (object ID) as the user identifier
		user.Sub = fmt.Sprintf("%v", oid)
	}
	if userid, ok := userInfo["userid"]; ok {
		user.Sub = fmt.Sprintf("%v", userid)
	}

	if g.UsernameClaim != "" {
		if usernameVal, ok := userInfo[g.UsernameClaim]; ok {
			user.Username = fmt.Sprintf("%v", usernameVal)
		}
	} else {
		if username, ok := userInfo["username"]; ok {
			user.Username = fmt.Sprintf("%v", username)
		} else if login, ok := userInfo["login"]; ok {
			user.Username = fmt.Sprintf("%v", login)
		} else if userPrincipalName, ok := userInfo["userPrincipalName"]; ok {
			// Azure AD Graph API uses 'userPrincipalName' for the user's email/UPN
			user.Username = fmt.Sprintf("%v", userPrincipalName)
		} else if preferredUsername, ok := userInfo["preferred_username"]; ok {
			// OIDC uses 'preferred_username' for the user's email/UPN
			user.Username = fmt.Sprintf("%v", preferredUsername)
		} else if upn, ok := userInfo["upn"]; ok {
			// Some providers use 'upn' (User Principal Name)
			user.Username = fmt.Sprintf("%v", upn)
		} else if email, ok := userInfo["email"]; ok {
			user.Username = fmt.Sprintf("%v", email)
		}
	}

	if name, ok := userInfo["name"]; ok {
		user.Name = fmt.Sprintf("%v", name)
	} else if displayName, ok := userInfo["displayName"]; ok {
		// Azure AD Graph API uses 'displayName' instead of 'name'
		user.Name = fmt.Sprintf("%v", displayName)
	}
	if nickname, ok := userInfo["nickname"]; ok {
		user.Name = fmt.Sprintf("%v", nickname)
	}
	if avatar, ok := userInfo["avatar_url"]; ok {
		user.AvatarURL = fmt.Sprintf("%v", avatar)
	} else if picture, ok := userInfo["picture"]; ok {
		user.AvatarURL = fmt.Sprintf("%v", picture)
	}

	var groups []interface{}
	if g.GroupsClaim != "" {
		if v, ok := userInfo[g.GroupsClaim]; ok {
			if arr, ok := v.([]interface{}); ok {
				groups = arr
			} else if str, ok := v.(string); ok {
				groups = []interface{}{str}
			}
		}
	} else {
		if v, ok := userInfo["groups"]; ok {
			if arr, ok := v.([]interface{}); ok {
				groups = arr
			}
		} else if roles, ok := userInfo["roles"]; ok {
			if arr, ok := roles.([]interface{}); ok {
				groups = arr
			}
		}
	}

	// If no groups found and this looks like Azure AD/Microsoft Graph, try fetching memberOf
	if len(groups) == 0 && strings.Contains(g.UserInfoURL, "graph.microsoft.com") {
		klog.V(1).Infof("No groups in user info, fetching from /me/memberOf for %s", g.Name)
		memberOfGroups, err := g.fetchAzureADGroups(accessToken)
		if err != nil {
			klog.Warningf("Failed to fetch groups from /me/memberOf: %v", err)
		} else {
			groups = memberOfGroups
		}
	}

	if len(groups) != 0 {
		user.OIDCGroups = make([]string, len(groups))
		for i, v := range groups {
			user.OIDCGroups[i] = fmt.Sprintf("%v", v)
		}
		klog.V(1).Infof("Extracted %d groups/roles from %s", len(groups), g.Name)
	} else {
		klog.V(1).Infof("No groups/roles found in user info from %s", g.Name)
	}

	if len(g.AllowedGroups) > 0 {
		allowed := false
		for _, userGroup := range user.OIDCGroups {
			for _, allowedGroup := range g.AllowedGroups {
				if userGroup == allowedGroup {
					allowed = true
					break
				}
			}
			if allowed {
				break
			}
		}
		if !allowed {
			klog.Warningf("User %s is not in any allowed groups %v (user groups: %v)", user.Username, g.AllowedGroups, user.OIDCGroups)
			return nil, fmt.Errorf("user is not in any of the allowed groups")
		}
	}

	return user, nil
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
