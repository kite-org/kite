package resources

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"
)

const (
	helmReleaseResourceName = "helmrelease"
	helmActionTimeout       = 5 * time.Minute
)

var helmClusterScopedKinds = map[string]struct{}{
	"apiservice":                       {},
	"certificatesigningrequest":        {},
	"clusterrole":                      {},
	"clusterrolebinding":               {},
	"customresourcedefinition":         {},
	"gatewayclass":                     {},
	"mutatingwebhookconfiguration":     {},
	"namespace":                        {},
	"node":                             {},
	"persistentvolume":                 {},
	"podsecuritypolicy":                {},
	"priorityclass":                    {},
	"storageclass":                     {},
	"validatingadmissionpolicy":        {},
	"validatingadmissionpolicybinding": {},
	"validatingwebhookconfiguration":   {},
	"volumesnapshotclass":              {},
	"volumesnapshotcontent":            {},
}

type HelmReleaseHandler struct{}

type HelmRelease struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata"`
	Spec              HelmReleaseSpec   `json:"spec"`
	Status            HelmReleaseStatus `json:"status"`
}

type HelmReleaseList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []HelmRelease `json:"items"`
}

type HelmReleaseSpec struct {
	ReleaseName  string                 `json:"releaseName"`
	Namespace    string                 `json:"namespace"`
	Chart        string                 `json:"chart"`
	ChartName    string                 `json:"chartName"`
	ChartVersion string                 `json:"chartVersion"`
	AppVersion   string                 `json:"appVersion,omitempty"`
	Revision     int                    `json:"revision"`
	Values       map[string]interface{} `json:"values,omitempty"`
	Manifest     string                 `json:"manifest,omitempty"`
	Notes        string                 `json:"notes,omitempty"`
	Description  string                 `json:"description,omitempty"`
	Hooks        []helmHook             `json:"hooks,omitempty"`
}

type HelmReleaseStatus struct {
	Status        string                `json:"status"`
	FirstDeployed *time.Time            `json:"firstDeployed,omitempty"`
	LastDeployed  *time.Time            `json:"lastDeployed,omitempty"`
	Deleted       *time.Time            `json:"deleted,omitempty"`
	Resources     []HelmReleaseResource `json:"resources,omitempty"`
}

type HelmReleaseResource struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace,omitempty"`
}

type HelmReleaseHistoryItem struct {
	Revision      int        `json:"revision"`
	Status        string     `json:"status"`
	Chart         string     `json:"chart"`
	ChartName     string     `json:"chartName"`
	ChartVersion  string     `json:"chartVersion"`
	AppVersion    string     `json:"appVersion,omitempty"`
	Description   string     `json:"description,omitempty"`
	FirstDeployed *time.Time `json:"firstDeployed,omitempty"`
	LastDeployed  *time.Time `json:"lastDeployed,omitempty"`
	Deleted       *time.Time `json:"deleted,omitempty"`
}

type helmHook struct {
	Name     string                 `json:"name"`
	Kind     string                 `json:"kind"`
	Path     string                 `json:"path"`
	Manifest string                 `json:"manifest"`
	Events   []string               `json:"events"`
	LastRun  map[string]interface{} `json:"last_run,omitempty"`
	Weight   int                    `json:"weight,omitempty"`
}

type helmRESTClientGetter struct {
	config    *rest.Config
	namespace string
}

func (g *helmRESTClientGetter) ToRESTConfig() (*rest.Config, error) {
	return rest.CopyConfig(g.config), nil
}

func (g *helmRESTClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(rest.CopyConfig(g.config))
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(discoveryClient), nil
}

func (g *helmRESTClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	discoveryClient, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(discoveryClient), nil
}

func (g *helmRESTClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
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

func NewHelmReleaseHandler() *HelmReleaseHandler    { return &HelmReleaseHandler{} }
func (h *HelmReleaseHandler) IsClusterScoped() bool { return false }
func (h *HelmReleaseHandler) Searchable() bool      { return true }
func (h *HelmReleaseHandler) ListHistory(c *gin.Context) {
	cfg, err := h.actionConfig(c, c.Param("namespace"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	releases, err := action.NewHistory(cfg).Run(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	sort.Slice(releases, func(i, j int) bool {
		return releases[i].Version > releases[j].Version
	})
	items := make([]HelmReleaseHistoryItem, 0, len(releases))
	for _, rel := range releases {
		items = append(items, toHelmReleaseHistoryItem(rel))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *HelmReleaseHandler) Create(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "installing Helm charts is not supported yet"})
}
func (h *HelmReleaseHandler) Update(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "helm release updates must use the upgrade action"})
}
func (h *HelmReleaseHandler) Patch(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "patching Helm releases is not supported"})
}
func (h *HelmReleaseHandler) Describe(c *gin.Context) {
	obj, err := h.get(c, c.Param("namespace"), c.Param("name"), true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"result": fmt.Sprintf(
			"Name: %s\nNamespace: %s\nRevision: %d\nStatus: %s\nChart: %s\nDescription: %s\n",
			obj.Name,
			obj.Namespace,
			obj.Spec.Revision,
			obj.Status.Status,
			obj.Spec.Chart,
			obj.Spec.Description,
		),
	})
}

func (h *HelmReleaseHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.POST("/:namespace/:name/upgrade", h.Upgrade)
	group.POST("/:namespace/:name/rollback", h.Rollback)
}

func (h *HelmReleaseHandler) List(c *gin.Context) {
	list, err := h.list(c, c.Param("namespace"), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}
func (h *HelmReleaseHandler) Get(c *gin.Context) {
	obj, err := h.get(c, c.Param("namespace"), c.Param("name"), true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, obj)
}
func (h *HelmReleaseHandler) GetResource(c *gin.Context, namespace, name string) (interface{}, error) {
	return h.get(c, namespace, name, true)
}

func (h *HelmReleaseHandler) Search(c *gin.Context, q string, limit int64) ([]common.SearchResult, error) {
	list, err := h.list(c, common.AllNamespaces, false)
	if err != nil {
		return nil, err
	}
	results := []common.SearchResult{}
	for _, item := range list.Items {
		if !strings.Contains(strings.ToLower(item.Name), strings.ToLower(q)) {
			continue
		}
		results = append(results, common.SearchResult{
			ID:           helmReleaseID(item),
			Name:         item.Name,
			Namespace:    item.Namespace,
			ResourceType: helmReleaseResourceName,
			CreatedAt:    item.CreationTimestamp.String(),
		})
		if limit > 0 && int64(len(results)) >= limit {
			break
		}
	}
	return results, nil
}

func (h *HelmReleaseHandler) Delete(c *gin.Context) {
	cfg, err := h.actionConfig(c, c.Param("namespace"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	uninstall := action.NewUninstall(cfg)
	uninstall.Timeout = helmActionTimeout
	uninstall.Description = "Deleted from Kite"
	if _, err := uninstall.Run(c.Param("name")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "helm release deleted"})
}

type helmReleaseActionRequest struct {
	Revision    int                    `json:"revision"`
	Manifest    string                 `json:"manifest"`
	Values      map[string]interface{} `json:"values"`
	Description string                 `json:"description"`
}

func (h *HelmReleaseHandler) Upgrade(c *gin.Context) {
	ctx := c.Request.Context()
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseActionRequest
	_ = c.ShouldBindJSON(&req)

	if req.Manifest != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "manifest override is not supported for Helm SDK upgrades"})
		return
	}

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	current, err := action.NewGet(cfg).Run(name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if current.Chart == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "helm release chart is missing"})
		return
	}

	values := req.Values
	if values == nil {
		values = map[string]interface{}{}
	}
	description := req.Description
	if description == "" {
		description = "Upgrade requested from Kite"
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = namespace
	upgrade.Timeout = helmActionTimeout
	upgrade.ReuseValues = req.Values == nil
	upgrade.Description = description
	if _, err := upgrade.RunWithContext(ctx, name, current.Chart, values); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "helm release upgraded"})
}

func (h *HelmReleaseHandler) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseActionRequest
	_ = c.ShouldBindJSON(&req)

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	targetRevision := req.Revision
	if targetRevision == 0 {
		current, err := action.NewGet(cfg).Run(name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		targetRevision = current.Version - 1
	}
	if targetRevision <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no previous helm release revision found"})
		return
	}

	rollback := action.NewRollback(cfg)
	rollback.Version = targetRevision
	rollback.Timeout = helmActionTimeout
	if err := rollback.Run(name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "helm release rolled back", "revision": targetRevision})
}

func (h *HelmReleaseHandler) list(c *gin.Context, namespace string, details bool) (*HelmReleaseList, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	allNamespaces := namespace == "" || namespace == common.AllNamespaces
	cfg, err := h.actionConfigForClientSet(cs, helmStorageNamespace(namespace))
	if err != nil {
		return nil, err
	}
	listAction := action.NewList(cfg)
	listAction.All = true
	listAction.AllNamespaces = allNamespaces
	listAction.StateMask = action.ListAll
	listAction.Sort = action.ByDateDesc
	releases, err := listAction.Run()
	if err != nil {
		return nil, err
	}

	items := make([]HelmRelease, 0, len(releases))
	for _, rel := range releases {
		if allNamespaces && !rbac.CanAccessNamespace(user, cs.Name, rel.Namespace) {
			continue
		}
		items = append(items, toHelmRelease(rel, details))
	}
	return &HelmReleaseList{TypeMeta: metav1.TypeMeta{Kind: "HelmReleaseList", APIVersion: "v1"}, Items: items}, nil
}

func (h *HelmReleaseHandler) get(c *gin.Context, namespace, name string, details bool) (*HelmRelease, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	cfg, err := h.actionConfigForClientSet(cs, helmStorageNamespace(namespace))
	if err != nil {
		return nil, err
	}
	rel, err := action.NewGet(cfg).Run(name)
	if err != nil {
		return nil, err
	}
	hr := toHelmRelease(rel, details)
	return &hr, nil
}

func (h *HelmReleaseHandler) actionConfig(c *gin.Context, namespace string) (*action.Configuration, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	return h.actionConfigForClientSet(cs, helmStorageNamespace(namespace))
}

func (h *HelmReleaseHandler) actionConfigForClientSet(cs *cluster.ClientSet, namespace string) (*action.Configuration, error) {
	cfg := new(action.Configuration)
	getter := &helmRESTClientGetter{config: cs.K8sClient.Configuration, namespace: namespace}
	if err := cfg.Init(getter, namespace, "secret", func(string, ...interface{}) {}); err != nil {
		return nil, err
	}
	return cfg, nil
}

func helmStorageNamespace(namespace string) string {
	if namespace == common.AllNamespaces {
		return ""
	}
	return namespace
}

func helmReleaseID(release HelmRelease) string {
	if release.UID != "" {
		return string(release.UID)
	}
	return release.Namespace + "/" + release.Name
}

func toHelmRelease(rel *release.Release, details bool) HelmRelease {
	chartName, chartVersion, appVersion := helmChartInfo(rel)
	chart := chartName
	if chart != "" && chartVersion != "" {
		chart += "-" + chartVersion
	}

	objectMeta := metav1.ObjectMeta{
		Name:      rel.Name,
		Namespace: rel.Namespace,
		Labels:    rel.Labels,
	}
	if rel.Info != nil && !rel.Info.FirstDeployed.IsZero() {
		objectMeta.CreationTimestamp = metav1.NewTime(rel.Info.FirstDeployed.Time)
	}

	hr := HelmRelease{
		TypeMeta:   metav1.TypeMeta{Kind: "HelmRelease", APIVersion: "v1"},
		ObjectMeta: objectMeta,
		Spec: HelmReleaseSpec{
			ReleaseName:  rel.Name,
			Namespace:    rel.Namespace,
			Chart:        chart,
			ChartName:    chartName,
			ChartVersion: chartVersion,
			AppVersion:   appVersion,
			Revision:     rel.Version,
			Values:       rel.Config,
			Manifest:     rel.Manifest,
			Hooks:        toHelmHooks(rel.Hooks),
		},
	}
	if rel.Info != nil {
		hr.Spec.Notes = rel.Info.Notes
		hr.Spec.Description = rel.Info.Description
		hr.Status.Status = rel.Info.Status.String()
		hr.Status.FirstDeployed = helmTimePtr(rel.Info.FirstDeployed)
		hr.Status.LastDeployed = helmTimePtr(rel.Info.LastDeployed)
		hr.Status.Deleted = helmTimePtr(rel.Info.Deleted)
	}
	if details {
		hr.Status.Resources = resolveManifestResources(rel.Manifest, rel.Namespace)
	}
	return hr
}

func helmChartInfo(rel *release.Release) (string, string, string) {
	if rel.Chart == nil || rel.Chart.Metadata == nil {
		return "", "", ""
	}
	return rel.Chart.Metadata.Name, rel.Chart.Metadata.Version, rel.Chart.Metadata.AppVersion
}

func toHelmReleaseHistoryItem(rel *release.Release) HelmReleaseHistoryItem {
	chartName, chartVersion, appVersion := helmChartInfo(rel)
	chart := chartName
	if chart != "" && chartVersion != "" {
		chart += "-" + chartVersion
	}
	item := HelmReleaseHistoryItem{
		Revision:     rel.Version,
		Chart:        chart,
		ChartName:    chartName,
		ChartVersion: chartVersion,
		AppVersion:   appVersion,
	}
	if rel.Info != nil {
		item.Status = rel.Info.Status.String()
		item.Description = rel.Info.Description
		item.FirstDeployed = helmTimePtr(rel.Info.FirstDeployed)
		item.LastDeployed = helmTimePtr(rel.Info.LastDeployed)
		item.Deleted = helmTimePtr(rel.Info.Deleted)
	}
	return item
}

func helmTimePtr(t helmtime.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	v := t.Time
	return &v
}

func toHelmHooks(hooks []*release.Hook) []helmHook {
	out := make([]helmHook, 0, len(hooks))
	for _, hook := range hooks {
		if hook == nil {
			continue
		}
		events := make([]string, 0, len(hook.Events))
		for _, event := range hook.Events {
			events = append(events, event.String())
		}
		out = append(out, helmHook{
			Name:     hook.Name,
			Kind:     hook.Kind,
			Path:     hook.Path,
			Manifest: hook.Manifest,
			Events:   events,
			LastRun:  helmHookLastRun(hook),
			Weight:   hook.Weight,
		})
	}
	return out
}

func helmHookLastRun(hook *release.Hook) map[string]interface{} {
	lastRun := map[string]interface{}{}
	if !hook.LastRun.StartedAt.IsZero() {
		lastRun["started_at"] = hook.LastRun.StartedAt.Time
	}
	if !hook.LastRun.CompletedAt.IsZero() {
		lastRun["completed_at"] = hook.LastRun.CompletedAt.Time
	}
	if hook.LastRun.Phase != "" {
		lastRun["phase"] = hook.LastRun.Phase.String()
	}
	if len(lastRun) == 0 {
		return nil
	}
	return lastRun
}

func resolveManifestResources(manifest, defaultNamespace string) []HelmReleaseResource {
	docs := strings.Split(manifest, "\n---")
	out := []HelmReleaseResource{}
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var u unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(doc), &u.Object); err != nil || u.GetKind() == "" || u.GetName() == "" {
			continue
		}
		ns := u.GetNamespace()
		_, clusterScoped := helmClusterScopedKinds[strings.ToLower(u.GetKind())]
		if ns == "" && !clusterScoped {
			ns = defaultNamespace
		}
		out = append(out, HelmReleaseResource{
			APIVersion: u.GetAPIVersion(),
			Kind:       u.GetKind(),
			Name:       u.GetName(),
			Namespace:  ns,
		})
	}
	return out
}
