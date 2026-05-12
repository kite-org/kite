package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

type OAuthManager struct {
	jwtSecret string
}

// Keep headroom for cookie name and attributes within common 4096-byte browser limits.
const maxAuthTokenCookieValueLength = 3800

func NewOAuthManager() *OAuthManager {
	return &OAuthManager{
		jwtSecret: common.JwtSecret,
	}
}

func getRequestHost(c *gin.Context) string {
	if common.Host != "" {
		return common.Host
	}
	proto := c.Request.Header.Get("X-Forwarded-Proto")
	host := c.Request.Header.Get("X-Forwarded-Host")
	if proto != "" && host != "" {
		return proto + "://" + host
	}
	if c.Request.Host != "" {
		scheme := "https"
		if c.Request.TLS == nil {
			scheme = "http"
		}
		return scheme + "://" + c.Request.Host
	}

	return "http://localhost"
}

func (om *OAuthManager) GetProvider(c *gin.Context, name string) (OAuthProvider, error) {
	dbProvider, err := model.GetOAuthProviderByName(name)
	if err != nil {
		return nil, err
	}
	dbProvider.RedirectURL, _ = url.JoinPath(getRequestHost(c), common.Base+"/api/auth/callback")
	return NewGenericProvider(dbProvider)
}

func (om *OAuthManager) GetAvailableProviders() []string {
	var providers []string
	dbProviders, err := model.GetEnabledOAuthProviders()
	if err != nil {
		klog.Warningf("Failed to load OAuth providers from database: %v", err)
	} else {
		for _, provider := range dbProviders {
			providers = append(providers, string(provider.Name))
		}
	}
	return providers
}

func (om *OAuthManager) GenerateState() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func (om *OAuthManager) GenerateJWT(user *model.User, refreshToken string) (string, error) {
	now := time.Now()
	expirationTime := now.Add(common.JWTExpirationSeconds * time.Second)

	claims := Claims{
		UserID:       user.ID,
		Username:     user.Username,
		Provider:     user.Provider,
		RefreshToken: refreshToken,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "Kite",
		},
	}

	tokenString, err := om.signJWT(claims)
	if err != nil {
		return "", err
	}
	if len(tokenString) > maxAuthTokenCookieValueLength {
		claims.RefreshToken = "" // Drop refresh token from JWT if it exceeds size limits
	}
	return om.signJWT(claims)
}

func (om *OAuthManager) signJWT(claims Claims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(om.jwtSecret))
}

func (om *OAuthManager) ValidateJWT(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(om.jwtSecret), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func (om *OAuthManager) RefreshJWT(c *gin.Context, tokenString string) (string, error) {
	// We need to accept expired tokens here so we can extract claims and refresh using
	// the stored refresh token. Parse the token while skipping claims validation but
	// still validate the signature.
	var claims Claims
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(om.jwtSecret), nil
	}, jwt.WithoutClaimsValidation())
	if err != nil {
		return "", err
	}

	// Ensure signature was valid
	if token == nil || !token.Valid {
		return "", fmt.Errorf("invalid token signature")
	}

	if !time.Now().After(claims.ExpiresAt.Time) {
		user := &model.User{
			Model: model.Model{
				ID: claims.UserID,
			},
			Username: claims.Username,
			Provider: claims.Provider,
		}

		return om.GenerateJWT(user, claims.RefreshToken)
	}

	if claims.RefreshToken != "" {
		provider, err := om.GetProvider(c, claims.Provider)
		if err != nil {
			return "", err
		}

		tokenResp, err := provider.RefreshToken(claims.RefreshToken)
		if err != nil {
			return "", err
		}

		// Get updated user info with new access token
		user, err := provider.GetUserInfo(tokenResp.AccessToken)
		if err != nil {
			return "", err
		}
		user.ID = claims.UserID

		// Generate new JWT with refreshed token
		newRefreshToken := tokenResp.RefreshToken
		if newRefreshToken == "" {
			newRefreshToken = claims.RefreshToken // Keep the old refresh token if no new one provided
		}

		return om.GenerateJWT(user, newRefreshToken)
	}

	return "", fmt.Errorf("token expired")
}
