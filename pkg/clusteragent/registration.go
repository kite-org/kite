package clusteragent

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/zxh326/kite/pkg/version"
	"golang.org/x/crypto/nacl/box"
	"k8s.io/client-go/rest"
)

const registrationMaxBytes = 2 << 20

type clusterAgentRegistration struct {
	APIServer     string `json:"apiServer"`
	CAData        []byte `json:"caData,omitempty"`
	CertData      []byte `json:"certData,omitempty"`
	KeyData       []byte `json:"keyData,omitempty"`
	ServerName    string `json:"serverName,omitempty"`
	Insecure      bool   `json:"insecure,omitempty"`
	Authorization string `json:"authorization,omitempty"`
	AgentVersion  string `json:"agentVersion,omitempty"`
}

type registeredCluster struct {
	registration clusterAgentRegistration
	generation   uint64
}

type encryptedClusterAgentRegistration struct {
	Version    int    `json:"version"`
	Ciphertext string `json:"ciphertext"`
}

func NewRegistrationKeyPair() (string, string, error) {
	publicKey, privateKey, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	return base64.RawURLEncoding.EncodeToString(publicKey[:]),
		base64.RawURLEncoding.EncodeToString(privateKey[:]), nil
}

func decodeRegistrationKey(encoded string) ([32]byte, error) {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return [32]byte{}, err
	}
	if len(decoded) != 32 {
		return [32]byte{}, errors.New("invalid registration key")
	}
	var key [32]byte
	copy(key[:], decoded)
	return key, nil
}

func encryptClusterAgentRegistration(registration clusterAgentRegistration, encodedServerPublicKey string) ([]byte, error) {
	serverPublicKey, err := decodeRegistrationKey(encodedServerPublicKey)
	if err != nil {
		return nil, fmt.Errorf("decode registration public key: %w", err)
	}
	plaintext, err := json.Marshal(registration)
	if err != nil {
		return nil, fmt.Errorf("encode cluster agent registration: %w", err)
	}
	ciphertext, err := box.SealAnonymous(nil, plaintext, &serverPublicKey, rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("encrypt cluster agent registration: %w", err)
	}
	encrypted := encryptedClusterAgentRegistration{
		Version:    1,
		Ciphertext: base64.RawURLEncoding.EncodeToString(ciphertext),
	}
	return json.Marshal(encrypted)
}

func decryptClusterAgentRegistration(encrypted encryptedClusterAgentRegistration, encodedServerPublicKey, encodedServerPrivateKey string) (clusterAgentRegistration, error) {
	if encrypted.Version != 1 {
		return clusterAgentRegistration{}, errors.New("unsupported cluster agent registration version")
	}
	serverPublicKey, err := decodeRegistrationKey(encodedServerPublicKey)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("decode registration public key: %w", err)
	}
	serverPrivateKey, err := decodeRegistrationKey(encodedServerPrivateKey)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("decode registration private key: %w", err)
	}
	ciphertext, err := base64.RawURLEncoding.Strict().DecodeString(encrypted.Ciphertext)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("decode cluster agent registration: %w", err)
	}
	plaintext, ok := box.OpenAnonymous(nil, ciphertext, &serverPublicKey, &serverPrivateKey)
	if !ok {
		return clusterAgentRegistration{}, errors.New("decrypt cluster agent registration")
	}
	var registration clusterAgentRegistration
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&registration); err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("decode cluster agent registration: %w", err)
	}
	return registration, nil
}

type credentialCaptureRoundTripper struct{}

func (credentialCaptureRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return &http.Response{
		Status:     "200 OK",
		StatusCode: http.StatusOK,
		Body:       http.NoBody,
		Request:    req,
	}, nil
}

type authorizationRoundTripper struct {
	next      http.RoundTripper
	manager   *Manager
	clientKey string
}

func (t *authorizationRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	t.manager.mu.RLock()
	authorization := t.manager.registrations[t.clientKey].registration.Authorization
	t.manager.mu.RUnlock()
	request := req.Clone(req.Context())
	request.Header = req.Header.Clone()
	for name := range request.Header {
		if strings.HasPrefix(strings.ToLower(name), "impersonate-") {
			request.Header.Del(name)
		}
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	return t.next.RoundTrip(request)
}

func sameTransportConfig(a, b clusterAgentRegistration) bool {
	return a.APIServer == b.APIServer &&
		a.ServerName == b.ServerName &&
		a.Insecure == b.Insecure &&
		bytes.Equal(a.CAData, b.CAData) &&
		bytes.Equal(a.CertData, b.CertData) &&
		bytes.Equal(a.KeyData, b.KeyData)
}

func (m *Manager) Register(rw http.ResponseWriter, req *http.Request) {
	cluster, err := authenticateClusterAgent(req)
	if err != nil {
		http.Error(rw, "failed to validate cluster agent token", http.StatusInternalServerError)
		return
	}
	if cluster == nil {
		http.Error(rw, "unauthorized", http.StatusUnauthorized)
		return
	}

	req.Body = http.MaxBytesReader(rw, req.Body, registrationMaxBytes)
	var encrypted encryptedClusterAgentRegistration
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&encrypted); err != nil {
		http.Error(rw, "invalid cluster agent registration", http.StatusBadRequest)
		return
	}
	registration, err := decryptClusterAgentRegistration(encrypted, cluster.ClusterAgentPublicKey, string(cluster.ClusterAgentPrivateKey))
	if err != nil {
		http.Error(rw, "invalid encrypted cluster agent registration", http.StatusBadRequest)
		return
	}
	apiURL, err := url.Parse(registration.APIServer)
	if err != nil || apiURL.Host == "" || (apiURL.Scheme != "http" && apiURL.Scheme != "https") {
		http.Error(rw, "invalid Kubernetes API server URL", http.StatusBadRequest)
		return
	}
	if (len(registration.CertData) == 0) != (len(registration.KeyData) == 0) {
		http.Error(rw, "client certificate and key must be provided together", http.StatusBadRequest)
		return
	}
	if registration.Authorization == "" && len(registration.CertData) == 0 {
		http.Error(rw, "Kubernetes credentials are required", http.StatusBadRequest)
		return
	}

	clientKey := strconv.FormatUint(uint64(cluster.ID), 10)
	m.mu.Lock()
	current, exists := m.registrations[clientKey]
	configChanged := !exists || !sameTransportConfig(current.registration, registration)
	current.registration = registration
	if configChanged {
		current.generation++
	}
	m.registrations[clientKey] = current
	m.mu.Unlock()

	if configChanged && m.Connected(cluster.ID) {
		m.onChange()
	}
	rw.WriteHeader(http.StatusNoContent)
}

func (m *Manager) RESTConfig(clusterID uint) (*rest.Config, uint64, error) {
	clientKey := strconv.FormatUint(uint64(clusterID), 10)
	m.mu.RLock()
	registered, ok := m.registrations[clientKey]
	m.mu.RUnlock()
	if !ok {
		return nil, 0, errors.New("waiting for cluster agent registration")
	}
	registration := registered.registration
	config := &rest.Config{
		Host: registration.APIServer,
		TLSClientConfig: rest.TLSClientConfig{
			CAData:     append([]byte(nil), registration.CAData...),
			CertData:   append([]byte(nil), registration.CertData...),
			KeyData:    append([]byte(nil), registration.KeyData...),
			ServerName: registration.ServerName,
			Insecure:   registration.Insecure,
			NextProtos: []string{"http/1.1"},
		},
		Dial: m.Dialer(clusterID),
		// Always dial the registered API server through the tunnel; an
		// env-configured proxy would bypass it and could leak the cluster's
		// Authorization header.
		Proxy: func(*http.Request) (*url.URL, error) {
			return nil, nil
		},
	}
	config.WrapTransport = func(next http.RoundTripper) http.RoundTripper {
		return &authorizationRoundTripper{next: next, manager: m, clientKey: clientKey}
	}
	return config, registered.generation, nil
}

func (m *Manager) Generation(clusterID uint) uint64 {
	clientKey := strconv.FormatUint(uint64(clusterID), 10)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.registrations[clientKey].generation
}

func registerClusterAgent(ctx context.Context, client *http.Client, registrationURL, token, publicKey string, config *rest.Config) error {
	registration, err := registrationFromConfig(config)
	if err != nil {
		return err
	}
	body, err := encryptClusterAgentRegistration(registration, publicKey)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, registrationURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create cluster agent registration request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("register cluster agent: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusNoContent {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("register cluster agent: server returned %s: %s", resp.Status, strings.TrimSpace(string(message)))
	}
	return nil
}

func registrationFromConfig(config *rest.Config) (clusterAgentRegistration, error) {
	caData, err := loadTLSData(config.CAData, config.CAFile)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("load Kubernetes CA: %w", err)
	}
	certData, err := loadTLSData(config.CertData, config.CertFile)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("load Kubernetes client certificate: %w", err)
	}
	keyData, err := loadTLSData(config.KeyData, config.KeyFile)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("load Kubernetes client key: %w", err)
	}

	authConfig := rest.CopyConfig(config)
	// Run client-go's auth wrappers against a local transport to resolve the current token without dialing the API server.
	authConfig.WrapTransport = func(http.RoundTripper) http.RoundTripper {
		return credentialCaptureRoundTripper{}
	}
	authTransport, err := rest.TransportFor(authConfig)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("create Kubernetes authentication transport: %w", err)
	}
	authRequest, err := http.NewRequest(http.MethodGet, config.Host, nil)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("create Kubernetes authentication request: %w", err)
	}
	authResponse, err := authTransport.RoundTrip(authRequest)
	if err != nil {
		return clusterAgentRegistration{}, fmt.Errorf("resolve Kubernetes credentials: %w", err)
	}
	if authResponse.Body != nil {
		_ = authResponse.Body.Close()
	}
	authorization := authResponse.Request.Header.Get("Authorization")
	if authorization == "" && len(certData) == 0 {
		return clusterAgentRegistration{}, errors.New("kubernetes configuration must provide bearer/basic authentication or a client certificate")
	}

	return clusterAgentRegistration{
		APIServer:     config.Host,
		CAData:        caData,
		CertData:      certData,
		KeyData:       keyData,
		ServerName:    config.ServerName,
		Insecure:      config.Insecure,
		Authorization: authorization,
		AgentVersion:  version.Version,
	}, nil
}

func loadTLSData(data []byte, file string) ([]byte, error) {
	if len(data) != 0 {
		return append([]byte(nil), data...), nil
	}
	if file == "" {
		return nil, nil
	}
	return os.ReadFile(file)
}
