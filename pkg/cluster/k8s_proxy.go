package cluster

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/statefultoken"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilnet "k8s.io/apimachinery/pkg/util/net"
	"k8s.io/apimachinery/pkg/util/proxy"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var discoveryPaths = map[string]bool{"/api": true, "/apis": true, "/version": true, "/openapi": true}
var subResourceVerbs = map[string]string{"exec": string(common.VerbExec), "attach": string(common.VerbExec), "log": string(common.VerbLog), "portforward": string(common.VerbExec)}

func (cm *ClusterManager) HandleK8sProxy(c *gin.Context) {
	user, ok := cm.authenticateKubeconfigToken(c)
	if !ok {
		return
	}
	clusterUUID := c.Param("clusterUUID")
	proxyPath, err := url.PathUnescape(c.Param("path"))
	if err != nil || strings.Contains(proxyPath, "..") {
		writeK8sStatus(c, http.StatusBadRequest, "invalid proxy path", metav1.StatusReasonBadRequest)
		return
	}
	cluster, err := model.GetClusterByUUID(clusterUUID)
	if err != nil || !cluster.Enable {
		writeK8sStatus(c, http.StatusNotFound, "cluster not found", metav1.StatusReasonNotFound)
		return
	}
	if !rbac.CanAccessClusterCurrent(user, cluster.Name) {
		writeK8sStatus(c, http.StatusForbidden, rbac.NoAccess(user.Key(), "access", "cluster", "", cluster.Name), metav1.StatusReasonForbidden)
		return
	}
	if !isDiscoveryPath(proxyPath) {
		resource, namespace, verb, subresource := parseK8sAPIPath(proxyPath, c.Request.Method)
		if resource == "" {
			writeK8sStatus(c, http.StatusForbidden, "unsupported Kubernetes API path", metav1.StatusReasonForbidden)
			return
		}
		if mapped, ok := subResourceVerbs[subresource]; ok {
			verb = mapped
		}
		if namespace == "" {
			namespace = common.AllNamespaces
		}
		if !rbac.CanAccessCurrent(user, resource, verb, cluster.Name, namespace) {
			writeK8sStatus(c, http.StatusForbidden, rbac.NoAccess(user.Key(), verb, resource, namespace, cluster.Name), metav1.StatusReasonForbidden)
			return
		}
	}
	if tokenID, ok := c.Get("kubeconfig_token_id"); ok {
		if service, err := newKubeconfigTokenService(); err == nil {
			_ = service.Touch(c.Request.Context(), tokenID.(uint))
		}
	}
	config, err := cm.getRestConfig(cluster)
	if err != nil {
		writeK8sStatus(c, http.StatusServiceUnavailable, "failed to connect to cluster", metav1.StatusReasonServiceUnavailable)
		return
	}
	target, err := buildK8sProxyURL(config.Host, proxyPath)
	if err != nil {
		writeK8sStatus(c, http.StatusBadRequest, "invalid proxy path", metav1.StatusReasonBadRequest)
		return
	}
	target.RawQuery = c.Request.URL.RawQuery
	forceHTTP1 := c.GetHeader("Upgrade") != ""
	proxyConfig := rest.CopyConfig(config)
	var transport http.RoundTripper
	if forceHTTP1 {
		transport, err = buildUpgradeConnectionTransport(proxyConfig)
	} else {
		transport, err = buildProxyTransport(proxyConfig, false)
	}
	if err != nil {
		writeK8sStatus(c, http.StatusInternalServerError, "failed to create transport", metav1.StatusReasonInternalError)
		return
	}
	c.Request.Header.Del("Authorization")
	c.Request.Header.Del("Cookie")
	for name := range c.Request.Header {
		if strings.HasPrefix(strings.ToLower(name), "impersonate-") {
			c.Request.Header.Del(name)
		}
	}
	handler := proxy.NewUpgradeAwareHandler(target, transport, false, false, &k8sProxyResponder{})
	// Preserve Cluster Agent WrapTransport (authorizationRoundTripper) outside
	// MirrorRequest so captured Upgrade requests contain target credentials.
	authConfig := rest.CopyConfig(config)
	originalWrap := authConfig.WrapTransport
	authConfig.WrapTransport = func(next http.RoundTripper) http.RoundTripper {
		wrapped := proxy.MirrorRequest
		if originalWrap != nil {
			wrapped = originalWrap(wrapped)
		}
		return wrapped
	}
	authTransport, err := rest.TransportFor(authConfig)
	if err != nil {
		writeK8sStatus(c, http.StatusInternalServerError, "failed to create transport", metav1.StatusReasonInternalError)
		return
	}
	handler.UpgradeTransport = proxy.NewUpgradeRequestRoundTripper(transport, authTransport)
	handler.FlushInterval = 200 * time.Millisecond
	handler.ServeHTTP(c.Writer, c.Request)
}

func (cm *ClusterManager) authenticateKubeconfigToken(c *gin.Context) (model.User, bool) {
	auth := c.GetHeader("Authorization")
	encoded, hasBearer := strings.CutPrefix(auth, "Bearer ")
	if !hasBearer || strings.Count(auth, "Bearer ") != 1 || strings.TrimSpace(encoded) == "" {
		writeK8sStatus(c, http.StatusUnauthorized, "invalid kubeconfig token", metav1.StatusReasonUnauthorized)
		return model.User{}, false
	}
	service, err := newKubeconfigTokenService()
	if err != nil {
		writeK8sStatus(c, http.StatusUnauthorized, "invalid kubeconfig token", metav1.StatusReasonUnauthorized)
		return model.User{}, false
	}
	principal, err := service.Authenticate(c.Request.Context(), strings.TrimSpace(encoded))
	if err != nil {
		message := "invalid kubeconfig token"
		if errors.Is(err, statefultoken.ErrExpired) {
			message = "Kubeconfig token has expired; please download a new kubeconfig"
		}
		writeK8sStatus(c, http.StatusUnauthorized, message, metav1.StatusReasonUnauthorized)
		return model.User{}, false
	}
	ownerID, err := strconv.ParseUint(principal.SubjectID, 10, 64)
	if err != nil {
		writeK8sStatus(c, http.StatusUnauthorized, "invalid kubeconfig token", metav1.StatusReasonUnauthorized)
		return model.User{}, false
	}
	owner, err := model.GetUserByIDCached(ownerID)
	if err != nil || !owner.Enabled {
		writeK8sStatus(c, http.StatusUnauthorized, "invalid kubeconfig token", metav1.StatusReasonUnauthorized)
		return model.User{}, false
	}
	owner.Roles = nil
	c.Set("kubeconfig_token_id", principal.TokenID)
	return *owner, true
}

func (cm *ClusterManager) getRestConfig(cluster *model.Cluster) (*rest.Config, error) {
	if cluster.InCluster {
		return rest.InClusterConfig()
	}
	if cluster.ClusterAgent {
		config, _, err := cm.clusterAgentManager.RESTConfig(cluster.ID)
		return config, err
	}
	return clientcmd.RESTConfigFromKubeConfig([]byte(cluster.Config))
}

func buildK8sProxyURL(host, proxyPath string) (*url.URL, error) {
	target, err := url.Parse(host)
	if err != nil {
		return nil, err
	}
	target.Path = path.Join(target.Path, "/"+strings.TrimPrefix(proxyPath, "/"))
	target.RawPath = ""
	return target, nil
}
func buildProxyTransport(config *rest.Config, forceHTTP1 bool) (http.RoundTripper, error) {
	cfg := rest.CopyConfig(config)
	if forceHTTP1 {
		cfg.NextProtos = []string{"http/1.1"}
	}
	return rest.TransportFor(cfg)
}

func buildUpgradeConnectionTransport(config *rest.Config) (*http.Transport, error) {
	cfg := rest.CopyConfig(config)
	cfg.WrapTransport = nil
	cfg.NextProtos = []string{"http/1.1"}

	transport, err := rest.TransportFor(cfg)
	if err != nil {
		return nil, err
	}
	dialer, err := utilnet.DialerFor(transport)
	if err != nil {
		return nil, fmt.Errorf("get upgrade connection dialer: %w", err)
	}
	if cfg.Dial != nil {
		dialer = cfg.Dial
	}
	if dialer == nil {
		return nil, fmt.Errorf("upgrade connection transport has no dialer")
	}
	tlsConfig, err := utilnet.TLSClientConfig(transport)
	if err != nil {
		return nil, fmt.Errorf("get upgrade TLS config: %w", err)
	}
	return &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		DialContext:       dialer,
		ForceAttemptHTTP2: false,
		TLSClientConfig:   tlsConfig,
	}, nil
}
func isDiscoveryPath(p string) bool {
	p = strings.TrimSuffix(p, "/")
	if discoveryPaths[p] {
		return true
	}
	if strings.HasPrefix(p, "/api/") {
		return len(strings.Split(strings.TrimPrefix(p, "/api/"), "/")) == 1
	}
	if strings.HasPrefix(p, "/apis/") {
		return len(strings.Split(strings.TrimPrefix(p, "/apis/"), "/")) <= 2
	}
	return strings.HasPrefix(p, "/openapi/")
}
func parseK8sAPIPath(p, method string) (string, string, string, string) {
	verb := methodToVerb(method)
	parts := strings.Split(strings.TrimPrefix(p, "/"), "/")
	var idx int
	switch {
	case len(parts) >= 2 && parts[0] == "api":
		idx = 2
	case len(parts) >= 3 && parts[0] == "apis":
		idx = 3
	default:
		return "", "", verb, ""
	}
	if idx >= len(parts) {
		return "", "", verb, ""
	}

	var resource, namespace, subresource string
	if parts[idx] == "namespaces" {
		if idx+2 >= len(parts) {
			return "namespaces", "", verb, ""
		}
		namespace, resource = parts[idx+1], parts[idx+2]
		if idx+4 < len(parts) {
			subresource = parts[idx+4]
		}
	} else {
		resource = parts[idx]
		if idx+2 < len(parts) {
			subresource = parts[idx+2]
		}
	}
	if _, ok := subResourceVerbs[subresource]; !ok {
		subresource = ""
	}
	return resource, namespace, verb, subresource
}
func methodToVerb(method string) string {
	switch method {
	case http.MethodPost:
		return string(common.VerbCreate)
	case http.MethodPut, http.MethodPatch:
		return string(common.VerbUpdate)
	case http.MethodDelete:
		return string(common.VerbDelete)
	default:
		return string(common.VerbGet)
	}
}

type k8sProxyResponder struct{}

func (*k8sProxyResponder) Error(w http.ResponseWriter, _ *http.Request, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadGateway)
	encoder := json.NewEncoder(w)
	err = encoder.Encode(metav1.Status{TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"}, Status: metav1.StatusFailure, Message: fmt.Sprintf("proxy error: %v", err), Reason: metav1.StatusReasonServiceUnavailable, Code: http.StatusBadGateway})
	if err != nil {
		return
	}
}
func writeK8sStatus(c *gin.Context, code int, message string, reason metav1.StatusReason) {
	c.JSON(code, metav1.Status{TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"}, Status: metav1.StatusFailure, Message: message, Reason: reason, Code: int32(code)})
}
