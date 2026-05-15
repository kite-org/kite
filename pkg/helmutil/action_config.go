package helmutil

import (
	"github.com/zxh326/kite/pkg/common"
	"helm.sh/helm/v4/pkg/action"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type restClientGetter struct {
	config    *rest.Config
	namespace string
}

func NewActionConfig(config *rest.Config, namespace string) (*action.Configuration, error) {
	cfg := action.NewConfiguration()
	getter := &restClientGetter{config: config, namespace: namespace}
	if err := cfg.Init(getter, namespace, "secret"); err != nil {
		return nil, err
	}
	return cfg, nil
}

func StorageNamespace(namespace string) string {
	if namespace == common.AllNamespaces {
		return ""
	}
	return namespace
}

func (g *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return rest.CopyConfig(g.config), nil
}

func (g *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(rest.CopyConfig(g.config))
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(discoveryClient), nil
}

func (g *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	discoveryClient, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(discoveryClient), nil
}

func (g *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	config := clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"kite": {Server: g.config.Host},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"kite": {},
		},
		Contexts: map[string]*clientcmdapi.Context{
			"kite": {
				Cluster:   "kite",
				AuthInfo:  "kite",
				Namespace: g.namespace,
			},
		},
		CurrentContext: "kite",
	}
	return clientcmd.NewDefaultClientConfig(config, &clientcmd.ConfigOverrides{
		CurrentContext: "kite",
		Context: clientcmdapi.Context{
			Namespace: g.namespace,
		},
	})
}
