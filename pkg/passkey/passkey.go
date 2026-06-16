package passkey

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	expirable "github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
)

const (
	sessionCookieName = "passkey_session"
	sessionMaxAge     = 5 * time.Minute
)

type session struct {
	Ceremony string
	Name     string
	Data     webauthn.SessionData
}

type webAuthnUser struct {
	user        *model.User
	credentials []webauthn.Credential
}

var sessionCache = expirable.NewLRU[string, session](1024, nil, sessionMaxAge)

func Enabled() (bool, error) {
	setting, err := model.GetGeneralSetting()
	if err != nil {
		return false, err
	}
	return setting.EnablePasskeyLogin, nil
}

func (u webAuthnUser) WebAuthnID() []byte {
	return userHandle(u.user.ID)
}

func (u webAuthnUser) WebAuthnName() string {
	return u.user.Username
}

func (u webAuthnUser) WebAuthnDisplayName() string {
	if strings.TrimSpace(u.user.Name) != "" {
		return u.user.Name
	}
	return u.user.Username
}

func (u webAuthnUser) WebAuthnCredentials() []webauthn.Credential {
	return u.credentials
}

func BeginRegistration(c *gin.Context, user model.User, name string) (*protocol.CredentialCreation, error) {
	w, err := webAuthnForRequest(c)
	if err != nil {
		return nil, err
	}
	webUser, err := webAuthnUserFor(user)
	if err != nil {
		return nil, err
	}
	creation, data, err := w.BeginRegistration(
		webUser,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(webauthn.Credentials(webUser.WebAuthnCredentials()).CredentialDescriptors()),
		webauthn.WithExtensions(protocol.AuthenticationExtensions{"credProps": true}),
	)
	if err != nil {
		return nil, err
	}
	saveSession(c, session{
		Ceremony: "registration",
		Name:     passkeyName(name),
		Data:     *data,
	})
	return creation, nil
}

func FinishRegistration(c *gin.Context, user model.User) (*model.PasskeyCredential, error) {
	w, err := webAuthnForRequest(c)
	if err != nil {
		return nil, err
	}
	storedSession, err := loadSession(c, "registration")
	if err != nil {
		return nil, err
	}
	webUser, err := webAuthnUserFor(user)
	if err != nil {
		return nil, err
	}
	credential, err := w.FinishRegistration(webUser, storedSession.Data, c.Request)
	if err != nil {
		return nil, err
	}
	return createCredential(user.ID, storedSession.Name, *credential)
}

func BeginLogin(c *gin.Context) (*protocol.CredentialAssertion, error) {
	w, err := webAuthnForRequest(c)
	if err != nil {
		return nil, err
	}
	assertion, data, err := w.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return nil, err
	}
	saveSession(c, session{
		Ceremony: "login",
		Data:     *data,
	})
	return assertion, nil
}

func FinishLogin(c *gin.Context) (*model.User, error) {
	w, err := webAuthnForRequest(c)
	if err != nil {
		return nil, err
	}
	storedSession, err := loadSession(c, "login")
	if err != nil {
		return nil, err
	}
	var credentialRecord *model.PasskeyCredential
	user, credential, err := w.FinishPasskeyLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
		webUser, record, err := userForCredential(rawID, userHandle)
		if err != nil {
			return nil, err
		}
		credentialRecord = record
		return webUser, nil
	}, storedSession.Data, c.Request)
	if err != nil {
		return nil, err
	}
	webUser, ok := user.(webAuthnUser)
	if !ok {
		return nil, errors.New("invalid passkey user")
	}
	if credentialRecord != nil && credential != nil {
		if err := updateCredential(credentialRecord, *credential); err != nil {
			return nil, err
		}
	}
	return webUser.user, nil
}

func CredentialsForUser(userID uint) ([]model.PasskeyCredential, error) {
	return model.ListPasskeyCredentialsByUserID(userID)
}

func DeleteCredential(userID uint, id uint) error {
	return model.DeletePasskeyCredential(id, userID)
}

func createCredential(userID uint, name string, credential webauthn.Credential) (*model.PasskeyCredential, error) {
	data, err := json.Marshal(credential)
	if err != nil {
		return nil, err
	}
	record := &model.PasskeyCredential{
		UserID:       userID,
		Name:         passkeyName(name),
		CredentialID: credentialIDString(credential.ID),
		Credential:   model.SecretString(data),
	}
	if err := model.CreatePasskeyCredential(record); err != nil {
		return nil, err
	}
	return record, nil
}

func updateCredential(record *model.PasskeyCredential, credential webauthn.Credential) error {
	data, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	now := time.Now()
	record.Credential = model.SecretString(data)
	record.LastUsedAt = &now
	return model.UpdatePasskeyCredential(record)
}

func userForCredential(rawID []byte, handle []byte) (webauthn.User, *model.PasskeyCredential, error) {
	record, err := model.GetPasskeyCredentialByCredentialID(credentialIDString(rawID))
	if err != nil {
		return nil, nil, err
	}
	user, err := model.GetUserByID(uint64(record.UserID))
	if err != nil {
		return nil, nil, err
	}
	if string(handle) != string(userHandle(user.ID)) {
		return nil, nil, errors.New("passkey user handle mismatch")
	}
	webUser, err := webAuthnUserFor(*user)
	if err != nil {
		return nil, nil, err
	}
	return webUser, record, nil
}

func webAuthnUserFor(user model.User) (webAuthnUser, error) {
	records, err := model.ListPasskeyCredentialsByUserID(user.ID)
	if err != nil {
		return webAuthnUser{}, err
	}
	credentials := make([]webauthn.Credential, 0, len(records))
	for _, record := range records {
		var credential webauthn.Credential
		if err := json.Unmarshal([]byte(string(record.Credential)), &credential); err != nil {
			return webAuthnUser{}, err
		}
		credentials = append(credentials, credential)
	}
	return webAuthnUser{user: &user, credentials: credentials}, nil
}

func saveSession(c *gin.Context, data session) {
	token := randomToken()
	sessionCache.Add(token, data)
	setCookie(c, sessionCookieName, token, int(sessionMaxAge.Seconds()))
}

func loadSession(c *gin.Context, ceremony string) (session, error) {
	token, err := c.Cookie(sessionCookieName)
	if err != nil {
		return session{}, err
	}
	data, ok := sessionCache.Get(token)
	sessionCache.Remove(token)
	setCookie(c, sessionCookieName, "", -1)
	if !ok || data.Ceremony != ceremony {
		return session{}, errors.New("passkey session not found")
	}
	return data, nil
}

func webAuthnForRequest(c *gin.Context) (*webauthn.WebAuthn, error) {
	origin := requestOrigin(c)
	parsed, err := url.Parse(origin)
	if err != nil {
		return nil, err
	}
	rpID := parsed.Hostname()
	if rpID == "" {
		return nil, fmt.Errorf("invalid passkey origin")
	}
	return webauthn.New(&webauthn.Config{
		RPDisplayName: "Kite",
		RPID:          rpID,
		RPOrigins:     []string{origin},
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			UserVerification: protocol.VerificationRequired,
		},
		AttestationPreference: protocol.PreferNoAttestation,
	})
}

func requestOrigin(c *gin.Context) string {
	if origin := strings.TrimSpace(c.GetHeader("Origin")); origin != "" {
		return origin
	}
	scheme := "http"
	if c.Request != nil && (c.Request.TLS != nil || strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")) {
		scheme = "https"
	}
	host := strings.TrimSpace(common.Host)
	if host == "" && c.Request != nil {
		host = strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Host"))
		if host == "" {
			host = c.Request.Host
		}
	}
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return strings.TrimRight(host, "/")
	}
	return scheme + "://" + host
}

func setCookie(c *gin.Context, name string, value string, maxAge int) {
	secure := strings.HasPrefix(common.Host, "https://") || (c.Request != nil && (c.Request.TLS != nil || strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")))
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, maxAge, "/", "", secure, true)
}

func passkeyName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Passkey"
	}
	return name
}

func randomToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func userHandle(id uint) []byte {
	return []byte(fmt.Sprintf("user:%d", id))
}

func credentialIDString(id []byte) string {
	return base64.RawURLEncoding.EncodeToString(id)
}
