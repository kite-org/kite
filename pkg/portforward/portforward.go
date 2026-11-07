package portforward

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/auth"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/middleware"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/rest"
	clientforward "k8s.io/client-go/tools/portforward"
	clientspdy "k8s.io/client-go/transport/spdy"
	"k8s.io/streaming/pkg/httpstream"
	"k8s.io/streaming/pkg/httpstream/spdy"
)

type forwardRequest struct {
	Resource   string `json:"resource"`
	Namespace  string `json:"namespace"`
	Name       string `json:"name"`
	RemotePort int    `json:"remotePort"`
	LocalPort  int    `json:"localPort"`
}

type Forward struct {
	forwardRequest
	ID      string `json:"id"`
	Cluster string `json:"cluster"`
	Pod     string `json:"pod"`
	PodPort int    `json:"podPort"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

type session struct {
	Forward
	owner  uint
	cancel context.CancelFunc
	done   chan struct{}
}

type Manager struct {
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	sessions map[string]*session
	workers  sync.WaitGroup
	changed  chan struct{}
}

func New(ctx context.Context) *Manager {
	ctx, cancel := context.WithCancel(ctx)
	return &Manager{ctx: ctx, cancel: cancel, sessions: make(map[string]*session), changed: make(chan struct{}, 1)}
}

func (m *Manager) Changes() <-chan struct{} { return m.changed }

// Snapshot and StopLocal are used only by the native menu of this local app.
func (m *Manager) Snapshot() []Forward {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := make([]Forward, 0, len(m.sessions))
	for _, s := range m.sessions {
		items = append(items, s.Forward)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].LocalPort < items[j].LocalPort })
	return items
}

func (m *Manager) StopLocal(id string) {
	m.mu.Lock()
	s := m.sessions[id]
	if s != nil {
		s.cancel()
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if s != nil {
		<-s.done
	}
	select {
	case m.changed <- struct{}{}:
	default:
	}
}

func (m *Manager) RegisterRoutes(engine *gin.Engine, cm *cluster.ClusterManager) {
	api := engine.Group(common.Base+"/api/v1", auth.NewAuthHandler().RequireAuth())
	api.GET("/desktop/port-forwards", m.list)
	api.DELETE("/desktop/port-forwards/:id", m.stop)
	api.POST("/_clusters/:cluster/desktop/port-forwards", middleware.ClusterMiddleware(cm), m.start)
}

func (m *Manager) Close() {
	m.mu.Lock()
	m.cancel()
	m.mu.Unlock()
	m.workers.Wait()
}

func (m *Manager) list(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	items := make([]Forward, 0)
	m.mu.Lock()
	for _, s := range m.sessions {
		if s.owner == user.ID {
			items = append(items, s.Forward)
		}
	}
	m.mu.Unlock()
	sort.Slice(items, func(i, j int) bool { return items[i].LocalPort < items[j].LocalPort })
	c.JSON(http.StatusOK, items)
}

func (m *Manager) stop(c *gin.Context) {
	user := c.MustGet("user").(model.User)
	m.mu.Lock()
	s, ok := m.sessions[c.Param("id")]
	if !ok || s.owner != user.ID {
		m.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Port forward not found"})
		return
	}
	m.mu.Unlock()
	m.StopLocal(s.ID)
	c.Status(http.StatusNoContent)
}

func (m *Manager) start(c *gin.Context) {
	var input forwardRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid port forward request"})
		return
	}
	if (input.Resource != "pods" && input.Resource != "services") ||
		input.Namespace == "" || len(validation.IsDNS1123Label(input.Namespace)) != 0 ||
		input.Name == "" || len(validation.IsDNS1123Subdomain(input.Name)) != 0 ||
		input.LocalPort < 0 || input.LocalPort > 65535 || input.RemotePort < 1 || input.RemotePort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Specify a Pod or Service, namespace, remote port (1–65535), and local port (0–65535)"})
		return
	}
	user := c.MustGet("user").(model.User)
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	if !rbac.CanAccess(user, input.Resource, string(common.VerbGet), cs.Name, input.Namespace) ||
		!rbac.CanAccess(user, "pods", string(common.VerbPortForward), cs.Name, input.Namespace) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Port forwarding requires get access to the resource and portforward access to pods"})
		return
	}
	startup, stopStartup := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer stopStartup()
	pod, port, err := resolvePod(startup, cs, input)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithCancel(m.ctx)
	stopRequestWatch := context.AfterFunc(startup, cancel)
	defer stopRequestWatch()
	target := cs.K8sClient.ClientSet.CoreV1().RESTClient().Post().Resource("pods").
		Namespace(input.Namespace).Name(pod.Name).SubResource("portforward").URL()
	dialer, err := newDialer(ctx, cs.K8sClient.Configuration, target)
	if err != nil {
		cancel()
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	ready := make(chan struct{})
	pf, err := clientforward.NewOnAddressesForStreaming(dialer, []string{"127.0.0.1"},
		[]string{fmt.Sprintf("%d:%d", input.LocalPort, port)}, ctx.Done(), ready, io.Discard, io.Discard)
	if err != nil {
		cancel()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s := &session{
		Forward: Forward{forwardRequest: input, ID: rand.Text(), Cluster: cs.Name, Pod: pod.Name, PodPort: port, Status: "active"},
		owner:   user.ID, cancel: cancel, done: make(chan struct{}),
	}
	m.mu.Lock()
	if m.ctx.Err() != nil {
		m.mu.Unlock()
		cancel()
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Desktop is shutting down"})
		return
	}
	m.workers.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.workers.Done()
		defer close(s.done)
		defer cancel()
		err := pf.ForwardPorts()
		m.mu.Lock()
		s.Status = "disconnected"
		if err != nil {
			s.Error = err.Error()
		}
		m.mu.Unlock()
		select {
		case m.changed <- struct{}{}:
		default:
		}
	}()
	select {
	case <-ready:
		ports, err := pf.GetPorts()
		if err != nil {
			cancel()
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		m.mu.Lock()
		s.LocalPort = int(ports[0].Local)
		m.sessions[s.ID] = s
		result := s.Forward
		m.mu.Unlock()
		select {
		case m.changed <- struct{}{}:
		default:
		}
		c.JSON(http.StatusCreated, result)
	case <-s.done:
		m.mu.Lock()
		message := s.Error
		m.mu.Unlock()
		if message == "" {
			message = "Port forward stopped before connecting"
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": message})
	case <-startup.Done():
		cancel()
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Timed out starting port forward"})
	case <-m.ctx.Done():
		cancel()
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Desktop is shutting down"})
	}
}

func resolvePod(ctx context.Context, cs *cluster.ClientSet, input forwardRequest) (*v1.Pod, int, error) {
	client := cs.K8sClient.ClientSet.CoreV1()
	if input.Resource == "pods" {
		pod, err := client.Pods(input.Namespace).Get(ctx, input.Name, metav1.GetOptions{})
		if err != nil {
			return nil, 0, err
		}
		if pod.Status.Phase != v1.PodRunning || pod.DeletionTimestamp != nil {
			return nil, 0, fmt.Errorf("pod must be running and not terminating")
		}
		return pod, input.RemotePort, nil
	}
	svc, err := client.Services(input.Namespace).Get(ctx, input.Name, metav1.GetOptions{})
	if err != nil {
		return nil, 0, err
	}
	if len(svc.Spec.Selector) == 0 || svc.Spec.Type == v1.ServiceTypeExternalName {
		return nil, 0, fmt.Errorf("port forwarding requires a Service with a Pod selector")
	}
	var servicePort *v1.ServicePort
	for i := range svc.Spec.Ports {
		p := &svc.Spec.Ports[i]
		if int(p.Port) == input.RemotePort && p.Protocol == v1.ProtocolTCP {
			servicePort = p
			break
		}
	}
	if servicePort == nil {
		return nil, 0, fmt.Errorf("service does not expose TCP port %d", input.RemotePort)
	}
	pods, err := client.Pods(input.Namespace).List(ctx, metav1.ListOptions{LabelSelector: labels.SelectorFromSet(svc.Spec.Selector).String()})
	if err != nil {
		return nil, 0, err
	}
	var pod *v1.Pod
	for i := range pods.Items {
		candidate := &pods.Items[i]
		if candidate.Status.Phase != v1.PodRunning || candidate.DeletionTimestamp != nil {
			continue
		}
		pod = candidate
		ready := false
		for _, condition := range candidate.Status.Conditions {
			if condition.Type == v1.PodReady && condition.Status == v1.ConditionTrue {
				ready = true
			}
		}
		if ready {
			break
		}
	}
	if pod == nil {
		return nil, 0, fmt.Errorf("no running Pod matches this Service")
	}
	if servicePort.TargetPort.Type == intstr.String {
		for _, container := range append(pod.Spec.Containers, pod.Spec.InitContainers...) {
			for _, p := range container.Ports {
				if p.Name == servicePort.TargetPort.StrVal && p.Protocol == v1.ProtocolTCP {
					return pod, int(p.ContainerPort), nil
				}
			}
		}
		return nil, 0, fmt.Errorf("pod %s has no TCP port named %s", pod.Name, servicePort.TargetPort.StrVal)
	}
	port := int(servicePort.TargetPort.IntVal)
	if port == 0 {
		port = int(servicePort.Port)
	}
	return pod, port, nil
}

type contextTransport struct {
	ctx context.Context
	http.RoundTripper
}

func (t contextTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.RoundTripper.RoundTrip(req.WithContext(t.ctx))
}

func newDialer(ctx context.Context, config *rest.Config, target *url.URL) (httpstream.Dialer, error) {
	config = rest.CopyConfig(config)
	// client-go's port-forward dialers create requests without a context.
	config.Wrap(func(rt http.RoundTripper) http.RoundTripper { return contextTransport{ctx, rt} })
	tlsConfig, err := rest.TLSConfigFor(config)
	if err != nil {
		return nil, err
	}
	proxy := config.Proxy
	if proxy == nil {
		proxy = http.ProxyFromEnvironment
	}
	options := spdy.RoundTripperConfig{TLS: tlsConfig, Proxier: proxy, PingPeriod: 5 * time.Second}
	if config.Dial != nil {
		options.UpgradeTransport = &http.Transport{DialContext: config.Dial, TLSClientConfig: tlsConfig}
	}
	upgrade, err := spdy.NewRoundTripperWithConfig(options)
	if err != nil {
		return nil, err
	}
	transport, err := rest.HTTPWrappersForConfig(config, upgrade)
	if err != nil {
		return nil, err
	}
	dialer := clientspdy.NewDialerForStreaming(clientspdy.NewUpgraderForStreaming(upgrade), &http.Client{Transport: transport}, http.MethodPost, target)
	if config.Dial != nil {
		return dialer, nil
	}
	websocket, err := clientforward.NewSPDYOverWebsocketDialerForStreaming(target, config)
	if err != nil {
		return nil, err
	}
	return clientforward.NewFallbackDialerForStreaming(websocket, dialer, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	}), nil
}
