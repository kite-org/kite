package cluster

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/prometheus"
	"gorm.io/gorm"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
)

type ClientSet struct {
	Name       string
	Version    string // Kubernetes version
	K8sClient  *kube.K8sClient
	PromClient *prometheus.Client

	DiscoveredPrometheusURL string
	config                  string
	prometheusURL           string
}

type ClusterManager struct {
	mu             sync.RWMutex
	syncMu         sync.Mutex
	clusters       map[string]*ClientSet
	errors         map[string]string
	defaultContext string
}

const clusterStartupSyncTimeout = 10 * time.Second

func createClientSetInCluster(name, prometheusURL string) (*ClientSet, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		return nil, err
	}

	return newClientSet(name, config, prometheusURL)
}

func createClientSetFromConfig(name, content, prometheusURL string) (*ClientSet, error) {
	restConfig, err := clientcmd.RESTConfigFromKubeConfig([]byte(content))
	if err != nil {
		klog.Warningf("Failed to create REST config for cluster %s: %v", name, err)
		return nil, err
	}
	cs, err := newClientSet(name, restConfig, prometheusURL)
	if err != nil {
		return nil, err
	}
	cs.config = content

	return cs, nil
}

func newClientSet(name string, k8sConfig *rest.Config, prometheusURL string) (*ClientSet, error) {
	cs := &ClientSet{
		Name:          name,
		prometheusURL: prometheusURL,
	}
	var err error
	cs.K8sClient, err = kube.NewClient(k8sConfig)
	if err != nil {
		klog.Warningf("Failed to create k8s client for cluster %s: %v", name, err)
		return nil, err
	}
	if prometheusURL == "" {
		prometheusURL = discoveryPrometheusURL(cs.K8sClient)
		if prometheusURL != "" {
			cs.DiscoveredPrometheusURL = prometheusURL
			klog.Infof("Discovered Prometheus URL for cluster %s: %s", name, cs.DiscoveredPrometheusURL)
		}
	}
	if prometheusURL != "" {
		var rt = http.DefaultTransport
		var err error
		if isClusterLocalURL(prometheusURL) {
			rt, err = createK8sProxyTransport(k8sConfig, prometheusURL)
			if err != nil {
				klog.Warningf("Failed to create k8s proxy transport for cluster %s: %v, using direct connection", name, err)
			} else {
				klog.Infof("Using k8s API proxy for Prometheus in cluster %s", name)
			}
		}
		cs.PromClient, err = prometheus.NewClientWithRoundTripper(prometheusURL, rt)
		if err != nil {
			klog.Warningf("Failed to create Prometheus client for cluster %s, some features may not work as expected, err: %v", name, err)
		}
	}
	v, err := cs.K8sClient.ClientSet.Discovery().ServerVersion()
	if err != nil {
		klog.Warningf("Failed to get server version for cluster %s: %v", name, err)
	} else {
		cs.Version = v.String()
	}
	klog.Infof("Loaded K8s client for cluster: %s, version: %s", name, cs.Version)
	return cs, nil
}

func isClusterLocalURL(urlStr string) bool {
	return strings.Contains(urlStr, ".svc.cluster.local") || strings.Contains(urlStr, ".svc:")
}

func createK8sProxyTransport(k8sConfig *rest.Config, prometheusURL string) (*k8sProxyTransport, error) {
	parsedURL, err := url.Parse(prometheusURL)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(parsedURL.Host, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid cluster local URL format")
	}
	svcName := parts[0]
	namespace := parts[1]

	transport, err := rest.TransportFor(k8sConfig)
	if err != nil {
		return nil, err
	}

	transportWrapper := &k8sProxyTransport{
		transport:    transport,
		apiServerURL: k8sConfig.Host,
		namespace:    namespace,
		svcName:      svcName,
		scheme:       parsedURL.Scheme,
	}
	transportWrapper.port = parsedURL.Port()
	if transportWrapper.port == "" {
		if parsedURL.Scheme == "https" {
			transportWrapper.port = "443"
		} else {
			transportWrapper.port = "80"
		}
	}

	return transportWrapper, nil
}

type k8sProxyTransport struct {
	transport    http.RoundTripper
	apiServerURL string
	namespace    string
	svcName      string
	scheme       string
	port         string
}

func (t *k8sProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	proxyURL, err := url.Parse(t.apiServerURL)
	if err != nil {
		return nil, err
	}
	req.URL.Scheme = proxyURL.Scheme
	req.URL.Host = proxyURL.Host

	servicePath := fmt.Sprintf("/api/v1/namespaces/%s/services/%s:%s/proxy", t.namespace, t.svcName, t.port)
	req.URL.Path = servicePath + req.URL.Path

	return t.transport.RoundTrip(req)
}

func (cm *ClusterManager) GetClientSet(clusterName string) (*ClientSet, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if len(cm.clusters) == 0 {
		return nil, fmt.Errorf("no clusters available")
	}
	if clusterName == "" {
		clusterName = cm.defaultContext
		if clusterName == "" {
			// If no default context is set, return the first available cluster
			for _, cs := range cm.clusters {
				return cs, nil
			}
		}
	}
	if cluster, ok := cm.clusters[clusterName]; ok {
		return cluster, nil
	}
	return nil, fmt.Errorf("cluster not found: %s", clusterName)
}

func ImportClustersFromKubeconfig(kubeconfig *clientcmdapi.Config) int64 {
	if len(kubeconfig.Contexts) == 0 {
		return 0
	}

	importedCount := 0
	for contextName, context := range kubeconfig.Contexts {
		config := clientcmdapi.NewConfig()
		config.Contexts = map[string]*clientcmdapi.Context{
			contextName: context,
		}
		config.CurrentContext = contextName
		config.Clusters = map[string]*clientcmdapi.Cluster{
			context.Cluster: kubeconfig.Clusters[context.Cluster],
		}
		config.AuthInfos = map[string]*clientcmdapi.AuthInfo{
			context.AuthInfo: kubeconfig.AuthInfos[context.AuthInfo],
		}
		configStr, err := clientcmd.Write(*config)
		if err != nil {
			continue
		}
		cluster := model.Cluster{
			Name:      contextName,
			Config:    model.SecretString(configStr),
			IsDefault: contextName == kubeconfig.CurrentContext,
		}
		if _, err := model.GetClusterByName(contextName); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := model.AddCluster(&cluster); err != nil {
					continue
				}
				importedCount++
				klog.Infof("Imported cluster success: %s", contextName)
			}
			continue
		}
	}
	return int64(importedCount)
}

var (
	syncNow = make(chan struct{}, 1)
)

func triggerClusterSync() {
	select {
	case syncNow <- struct{}{}:
	default:
	}
}

func syncClusters(cm *ClusterManager, readyCh chan<- struct{}) error {
	if readyCh != nil {
		defer func() {
			select {
			case readyCh <- struct{}{}:
			default:
			}
		}()
	}

	clusters, err := model.ListClusters()
	if err != nil {
		klog.Warningf("list cluster err: %v", err)
		time.Sleep(5 * time.Second)
		return err
	}
	dbClusterMap := make(map[string]interface{})
	type buildResult struct {
		cluster   *model.Cluster
		clientSet *ClientSet
		err       error
	}
	buildQueue := make([]*model.Cluster, 0)
	for _, cluster := range clusters {
		dbClusterMap[cluster.Name] = cluster
		if cluster.IsDefault {
			cm.mu.Lock()
			cm.defaultContext = cluster.Name
			cm.mu.Unlock()
		}
		cm.mu.RLock()
		current, currentExist := cm.clusters[cluster.Name]
		cm.mu.RUnlock()
		if shouldUpdateCluster(current, cluster) {
			if currentExist {
				cm.mu.Lock()
				delete(cm.clusters, cluster.Name)
				cm.mu.Unlock()
				current.K8sClient.Stop(cluster.Name)
			}
			if cluster.Enable {
				buildQueue = append(buildQueue, cluster)
			} else {
				cm.mu.Lock()
				delete(cm.errors, cluster.Name)
				cm.mu.Unlock()
			}
		}
	}
	results := make(chan buildResult, len(buildQueue))
	var wg sync.WaitGroup
	for _, cluster := range buildQueue {
		wg.Add(1)
		go func(cluster *model.Cluster) {
			defer wg.Done()
			clientSet, err := buildClientSet(cluster)
			results <- buildResult{
				cluster:   cluster,
				clientSet: clientSet,
				err:       err,
			}
		}(cluster)
	}
	go func() {
		wg.Wait()
		close(results)
	}()
	for result := range results {
		if result.err != nil {
			klog.Errorf("Failed to build k8s client for cluster %s, in cluster: %t, err: %v", result.cluster.Name, result.cluster.InCluster, result.err)
			cm.mu.Lock()
			cm.errors[result.cluster.Name] = result.err.Error()
			cm.mu.Unlock()
			continue
		}
		cm.mu.Lock()
		delete(cm.errors, result.cluster.Name)
		cm.clusters[result.cluster.Name] = result.clientSet
		cm.mu.Unlock()
	}
	cm.mu.Lock()
	for name, clientSet := range cm.clusters {
		if _, ok := dbClusterMap[name]; !ok {
			delete(cm.clusters, name)
			clientSet.K8sClient.Stop(name)
		}
	}
	for name := range cm.errors {
		if _, ok := dbClusterMap[name]; !ok {
			delete(cm.errors, name)
		}
	}
	cm.mu.Unlock()

	return nil
}

// shouldUpdateCluster decides whether the cached ClientSet needs to be updated
// based on the desired state from the database.
func shouldUpdateCluster(cs *ClientSet, cluster *model.Cluster) bool {
	// enable/disable toggle
	if (cs == nil && cluster.Enable) || (cs != nil && !cluster.Enable) {
		klog.Infof("Cluster %s status changed, updating, enabled -> %v", cluster.Name, cluster.Enable)
		return true
	}
	if cs == nil && !cluster.Enable {
		return false
	}

	if cs == nil || cs.K8sClient == nil || cs.K8sClient.ClientSet == nil {
		return true
	}

	// kubeconfig change
	if cs.config != string(cluster.Config) {
		klog.Infof("Kubeconfig changed for cluster %s, updating", cluster.Name)
		return true
	}

	// prometheus URL change
	if cs.prometheusURL != cluster.PrometheusURL {
		klog.Infof("Prometheus URL changed for cluster %s, updating", cluster.Name)
		return true
	}

	// k8s version change
	// TODO: Replace direct ClientSet.Discovery() call with a small DiscoveryInterface.
	// current code depends on *kubernetes.Clientset, which is hard to mock in tests.
	version, err := cs.K8sClient.ClientSet.Discovery().ServerVersion()
	if err != nil {
		klog.Warningf("Failed to get server version for cluster %s: %v", cluster.Name, err)
	} else if version.String() != cs.Version {
		klog.Infof("Server version changed for cluster %s, updating, old: %s, new: %s", cluster.Name, cs.Version, version.String())
		return true
	}

	return false
}

func buildClientSet(cluster *model.Cluster) (*ClientSet, error) {
	if cluster.InCluster {
		return createClientSetInCluster(cluster.Name, cluster.PrometheusURL)
	}
	return createClientSetFromConfig(cluster.Name, string(cluster.Config), cluster.PrometheusURL)
}

func (cm *ClusterManager) syncClusters() error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, nil)
}

func (cm *ClusterManager) syncClustersUntilReady(readyCh chan<- struct{}) error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, readyCh)
}

func (cm *ClusterManager) snapshotState() (map[string]*ClientSet, map[string]string, string) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	clusters := make(map[string]*ClientSet, len(cm.clusters))
	maps.Copy(clusters, cm.clusters)

	errors := make(map[string]string, len(cm.errors))
	maps.Copy(errors, cm.errors)

	return clusters, errors, cm.defaultContext
}

func NewClusterManager() (*ClusterManager, error) {
	cm := new(ClusterManager)
	cm.clusters = make(map[string]*ClientSet)
	cm.errors = make(map[string]string)

	initialReady := make(chan struct{}, 1)
	go func() {
		if err := cm.syncClustersUntilReady(initialReady); err != nil {
			klog.Warningf("Failed to sync clusters: %v", err)
		}
	}()

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
			case <-syncNow:
			}
			if err := cm.syncClusters(); err != nil {
				klog.Warningf("Failed to sync clusters: %v", err)
			}
		}
	}()

	timer := time.NewTimer(clusterStartupSyncTimeout)
	defer timer.Stop()

	select {
	case <-initialReady:
	case <-timer.C:
		klog.Warningf("Timed out waiting for cluster readiness after %s, continuing startup", clusterStartupSyncTimeout)
	}
	return cm, nil
}
