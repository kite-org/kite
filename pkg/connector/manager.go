package connector

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rancher/remotedialer"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

const (
	kubernetesAPITarget = "kubernetes-api"
	connectorTokenSize  = 32
)

type requestStateKey struct{}

type requestState struct {
	authenticated bool
}

type Manager struct {
	server    *remotedialer.Server
	onChange  func()
	mu        sync.Mutex
	listeners map[string]net.Listener
}

func NewManager(onChange func()) *Manager {
	m := &Manager{
		onChange:  onChange,
		listeners: make(map[string]net.Listener),
	}
	m.server = remotedialer.New(m.authorize, remotedialer.DefaultErrorWriter)
	return m
}

func NewToken() (string, string, error) {
	value := make([]byte, connectorTokenSize)
	if _, err := rand.Read(value); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(value)
	hash := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(hash[:]), nil
}

func validToken(token string) bool {
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(token)
	return err == nil && len(decoded) == connectorTokenSize
}

func (m *Manager) authorize(req *http.Request) (string, bool, error) {
	authorization := req.Header.Get("Authorization")
	token, found := strings.CutPrefix(authorization, "Bearer ")
	if !found || token == "" {
		return "", false, nil
	}
	if !validToken(token) {
		return "", false, nil
	}
	hash := sha256.Sum256([]byte(token))
	cluster, _ := model.GetClusterByConnectorTokenHash(hex.EncodeToString(hash[:]))
	if cluster == nil || !cluster.Connector || !cluster.Enable {
		return "", false, nil
	}
	if state, ok := req.Context().Value(requestStateKey{}).(*requestState); ok {
		state.authenticated = true
	}
	clientKey := strconv.FormatUint(uint64(cluster.ID), 10)
	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			if m.server.HasSession(clientKey) {
				m.onChange()
				return
			}
			select {
			case <-req.Context().Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return clientKey, true, nil
}

func (m *Manager) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	state := &requestState{}
	req = req.WithContext(context.WithValue(req.Context(), requestStateKey{}, state))
	m.server.ServeHTTP(rw, req)
	if state.authenticated {
		m.onChange()
	}
}

func (m *Manager) Connected(clusterID uint) bool {
	return m.server.HasSession(strconv.FormatUint(uint64(clusterID), 10))
}

func (m *Manager) Listen(clusterID uint) (string, error) {
	clientKey := strconv.FormatUint(uint64(clusterID), 10)
	m.mu.Lock()
	defer m.mu.Unlock()
	if listener, ok := m.listeners[clientKey]; ok {
		return listener.Addr().String(), nil
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	m.listeners[clientKey] = listener
	go m.serveListener(clientKey, listener)
	return listener.Addr().String(), nil
}

func (m *Manager) Remove(clusterID uint) {
	clientKey := strconv.FormatUint(uint64(clusterID), 10)
	m.mu.Lock()
	listener := m.listeners[clientKey]
	delete(m.listeners, clientKey)
	m.mu.Unlock()
	if listener != nil {
		_ = listener.Close()
	}
}

func (m *Manager) serveListener(clientKey string, listener net.Listener) {
	for {
		localConn, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			remoteConn, err := m.server.Dialer(clientKey)(context.Background(), "tcp", kubernetesAPITarget)
			if err != nil {
				_ = localConn.Close()
				klog.V(2).Infof("Failed to open connector tunnel for cluster %s: %v", clientKey, err)
				return
			}
			defer func() { _ = localConn.Close() }()
			defer func() { _ = remoteConn.Close() }()
			go func() {
				_, _ = io.Copy(remoteConn, localConn)
				_ = remoteConn.Close()
			}()
			_, _ = io.Copy(localConn, remoteConn)
		}()
	}
}
