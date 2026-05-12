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
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/kube"
	helmrelease "helm.sh/helm/v4/pkg/release"
	release "helm.sh/helm/v4/pkg/release/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
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
	ReleaseName   string                 `json:"releaseName"`
	Namespace     string                 `json:"namespace"`
	Chart         string                 `json:"chart"`
	ChartName     string                 `json:"chartName"`
	ChartVersion  string                 `json:"chartVersion"`
	AppVersion    string                 `json:"appVersion,omitempty"`
	Icon          string                 `json:"icon,omitempty"`
	Revision      int                    `json:"revision"`
	Values        map[string]interface{} `json:"values,omitempty"`
	DefaultValues map[string]interface{} `json:"defaultValues,omitempty"`
	Manifest      string                 `json:"manifest,omitempty"`
	Notes         string                 `json:"notes,omitempty"`
	Description   string                 `json:"description,omitempty"`
	Hooks         []helmHook             `json:"hooks,omitempty"`
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

type HelmReleaseDryRunResource struct {
	HelmReleaseResource
	Path            string `json:"path"`
	Content         string `json:"content"`
	OriginalContent string `json:"originalContent,omitempty"`
	ModifiedContent string `json:"modifiedContent,omitempty"`
	Status          string `json:"status,omitempty"`
}

type HelmReleaseDryRunResponse struct {
	Resources []HelmReleaseDryRunResource `json:"resources"`
}

type helmReleaseRunResult struct {
	current *release.Release
	release *release.Release
}

type HelmReleaseHistoryItem struct {
	Revision      int                    `json:"revision"`
	Status        string                 `json:"status"`
	Chart         string                 `json:"chart"`
	ChartName     string                 `json:"chartName"`
	ChartVersion  string                 `json:"chartVersion"`
	AppVersion    string                 `json:"appVersion,omitempty"`
	Values        map[string]interface{} `json:"values,omitempty"`
	Description   string                 `json:"description,omitempty"`
	FirstDeployed *time.Time             `json:"firstDeployed,omitempty"`
	LastDeployed  *time.Time             `json:"lastDeployed,omitempty"`
	Deleted       *time.Time             `json:"deleted,omitempty"`
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

type helmReleaseInstallRequest struct {
	ReleaseName     string                 `json:"releaseName" binding:"required"`
	Namespace       string                 `json:"namespace"`
	ChartURL        string                 `json:"chartUrl" binding:"required"`
	RepositoryName  string                 `json:"repositoryName"`
	Source          string                 `json:"source"`
	Values          map[string]interface{} `json:"values"`
	Description     string                 `json:"description"`
	CreateNamespace bool                   `json:"createNamespace"`
	Wait            bool                   `json:"wait"`
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
	releasers, err := action.NewHistory(cfg).Run(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	releases, err := helmReleasesFromReleasers(releasers)
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
	rel, status, err := h.runInstall(c, false)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	result := toHelmRelease(rel, true)
	c.JSON(http.StatusCreated, result)
}

func (h *HelmReleaseHandler) DryRunInstall(c *gin.Context) {
	rel, status, err := h.runInstall(c, true)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toHelmReleaseDryRunResponse(rel))
}

func (h *HelmReleaseHandler) runInstall(c *gin.Context, dryRun bool) (rel *release.Release, status int, err error) {
	ctx := c.Request.Context()
	namespace := strings.TrimSpace(c.Param("namespace"))
	if namespace == "" || namespace == common.AllNamespaces {
		return nil, http.StatusBadRequest, fmt.Errorf("namespace is required")
	}

	var req helmReleaseInstallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, http.StatusBadRequest, err
	}
	req.ReleaseName = strings.TrimSpace(req.ReleaseName)
	req.Namespace = strings.TrimSpace(req.Namespace)
	req.ChartURL = strings.TrimSpace(req.ChartURL)
	req.RepositoryName = strings.TrimSpace(req.RepositoryName)
	req.Source = strings.TrimSpace(req.Source)
	if req.ReleaseName == "" {
		return nil, http.StatusBadRequest, fmt.Errorf("releaseName is required")
	}
	if req.Namespace != "" && req.Namespace != namespace {
		return nil, http.StatusBadRequest, fmt.Errorf("request namespace does not match URL namespace")
	}
	if !dryRun {
		defer func() {
			h.recordHistory(c, "install", req.ReleaseName, namespace, nil, rel, err == nil, err)
		}()
	}

	repository, err := helmChartRepository(req.RepositoryName, req.Source)
	if err != nil {
		return nil, http.StatusBadRequest, fmt.Errorf("repository not found")
	}
	loadedChart, err := helmutil.LoadArchive(req.ChartURL, repository)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	values := req.Values
	if values == nil {
		values = map[string]interface{}{}
	}
	description := req.Description
	if description == "" {
		description = "Install requested from Kite"
		if dryRun {
			description = "Dry run install requested from Kite"
		}
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = req.ReleaseName
	install.Namespace = namespace
	install.Timeout = helmActionTimeout
	install.Description = description
	install.CreateNamespace = req.CreateNamespace
	if dryRun {
		install.DryRunStrategy = action.DryRunClient
	}
	install.WaitStrategy = kube.HookOnlyStrategy
	if req.Wait {
		install.WaitStrategy = kube.StatusWatcherStrategy
	}
	releaser, err := install.RunWithContext(ctx, loadedChart, values)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	rel, err = helmReleaseFromReleaser(releaser)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	return rel, http.StatusOK, nil
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
	group.POST("/:namespace/dry-run", h.DryRunInstall)
	group.PUT("/:namespace/:name/upgrade", h.Upgrade)
	group.PUT("/:namespace/:name/upgrade/dry-run", h.DryRunUpgrade)
	group.PUT("/:namespace/:name/rollback", h.Rollback)
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
	currentReleaser, err := action.NewGet(cfg).Run(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	current, err := helmReleaseFromReleaser(currentReleaser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	success := false
	var runErr error
	defer func() {
		h.recordHistory(c, "delete", c.Param("name"), c.Param("namespace"), current, nil, success, runErr)
	}()

	uninstall := action.NewUninstall(cfg)
	uninstall.Timeout = helmActionTimeout
	uninstall.Description = "Deleted from Kite"
	uninstall.WaitStrategy = kube.HookOnlyStrategy
	if _, err := uninstall.Run(c.Param("name")); err != nil {
		runErr = err
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	success = true
	c.JSON(http.StatusOK, gin.H{"message": "helm release deleted"})
}

type helmReleaseActionRequest struct {
	Revision          int                    `json:"revision"`
	ChartURL          string                 `json:"chartUrl"`
	RepositoryName    string                 `json:"repositoryName"`
	Source            string                 `json:"source"`
	Values            map[string]interface{} `json:"values"`
	Description       string                 `json:"description"`
	ForceConflicts    bool                   `json:"forceConflicts"`
	Wait              bool                   `json:"wait"`
	RollbackOnFailure bool                   `json:"rollbackOnFailure"`
}

func (h *HelmReleaseHandler) Upgrade(c *gin.Context) {
	_, status, err := h.runUpgrade(c, false)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "helm release upgraded"})
}

func (h *HelmReleaseHandler) DryRunUpgrade(c *gin.Context) {
	result, status, err := h.runUpgrade(c, true)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toHelmReleaseDryRunDiffResponse(result.current, result.release))
}

func (h *HelmReleaseHandler) runUpgrade(c *gin.Context, dryRun bool) (result helmReleaseRunResult, status int, err error) {
	ctx := c.Request.Context()
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseActionRequest
	_ = c.ShouldBindJSON(&req)

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	currentReleaser, err := action.NewGet(cfg).Run(name)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	current, err := helmReleaseFromReleaser(currentReleaser)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	if current.Chart == nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, fmt.Errorf("helm release chart is missing")
	}
	result.current = current
	if !dryRun {
		defer func() {
			h.recordHistory(c, "upgrade", name, namespace, current, result.release, err == nil, err)
		}()
	}

	chartToUpgrade := current.Chart
	if strings.TrimSpace(req.ChartURL) != "" {
		req.ChartURL = strings.TrimSpace(req.ChartURL)
		repository, err := helmChartRepository(
			strings.TrimSpace(req.RepositoryName),
			strings.TrimSpace(req.Source),
		)
		if err != nil {
			return helmReleaseRunResult{}, http.StatusBadRequest, fmt.Errorf("repository not found")
		}
		chartToUpgrade, err = helmutil.LoadArchive(req.ChartURL, repository)
		if err != nil {
			return helmReleaseRunResult{}, http.StatusBadRequest, err
		}
	}

	values := req.Values
	if values == nil {
		values = map[string]interface{}{}
	}
	description := req.Description
	if description == "" {
		description = "Dry run upgrade requested from Kite"
		if !dryRun {
			description = "Upgrade requested from Kite"
		}
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = namespace
	upgrade.Timeout = helmActionTimeout
	upgrade.ReuseValues = req.Values == nil
	upgrade.Description = description
	upgrade.ForceConflicts = req.ForceConflicts
	upgrade.RollbackOnFailure = req.RollbackOnFailure
	if dryRun {
		upgrade.DryRunStrategy = action.DryRunClient
	}
	upgrade.WaitStrategy = kube.HookOnlyStrategy
	if req.Wait {
		upgrade.WaitStrategy = kube.StatusWatcherStrategy
	}
	releaser, err := upgrade.RunWithContext(ctx, name, chartToUpgrade, values)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	rel, err := helmReleaseFromReleaser(releaser)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	result.release = rel
	return result, http.StatusOK, nil
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
	currentReleaser, err := action.NewGet(cfg).Run(name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	current, err := helmReleaseFromReleaser(currentReleaser)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	success := false
	var next *release.Release
	var runErr error
	defer func() {
		h.recordHistory(c, "rollback", name, namespace, current, next, success, runErr)
	}()

	targetRevision := req.Revision
	if targetRevision == 0 {
		targetRevision = current.Version - 1
	}
	if targetRevision <= 0 {
		runErr = fmt.Errorf("no previous helm release revision found")
		c.JSON(http.StatusBadRequest, gin.H{"error": "no previous helm release revision found"})
		return
	}

	rollback := action.NewRollback(cfg)
	rollback.Version = targetRevision
	rollback.Timeout = helmActionTimeout
	rollback.WaitStrategy = kube.HookOnlyStrategy
	if err := rollback.Run(name); err != nil {
		runErr = err
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if nextReleaser, err := action.NewGet(cfg).Run(name); err == nil {
		next, err = helmReleaseFromReleaser(nextReleaser)
		if err != nil {
			klog.Errorf("Failed to read rolled back helm release: %v", err)
		}
	} else {
		klog.Errorf("Failed to read rolled back helm release: %v", err)
	}
	success = true
	c.JSON(http.StatusOK, gin.H{"message": "helm release rolled back", "revision": targetRevision})
}

func (h *HelmReleaseHandler) recordHistory(c *gin.Context, opType, name, namespace string, prev, curr *release.Release, success bool, err error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if curr != nil {
		name = curr.Name
		namespace = curr.Namespace
	} else if prev != nil {
		name = prev.Name
		namespace = prev.Namespace
	}

	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	resourceYAML := helmReleaseToYAML(curr)
	if opType == "delete" {
		resourceYAML = ""
	}
	history := model.ResourceHistory{
		ClusterName:   cs.Name,
		ResourceType:  helmReleaseResourceName,
		ResourceName:  name,
		Namespace:     namespace,
		OperationType: opType,
		ResourceYAML:  resourceYAML,
		PreviousYAML:  helmReleaseToYAML(prev),
		Success:       success,
		ErrorMessage:  errMsg,
		OperatorID:    user.ID,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("Failed to create helm release history: %v", err)
	}
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
	releasers, err := listAction.Run()
	if err != nil {
		return nil, err
	}
	releases, err := helmReleasesFromReleasers(releasers)
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
	releaser, err := action.NewGet(cfg).Run(name)
	if err != nil {
		return nil, err
	}
	rel, err := helmReleaseFromReleaser(releaser)
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
	cfg := action.NewConfiguration()
	getter := &helmRESTClientGetter{config: cs.K8sClient.Configuration, namespace: namespace}
	if err := cfg.Init(getter, namespace, "secret"); err != nil {
		return nil, err
	}
	return cfg, nil
}

func helmChartRepository(repositoryName, source string) (*model.HelmRepository, error) {
	if repositoryName == "" || source == "artifacthub" {
		return nil, nil
	}
	var repository model.HelmRepository
	if err := model.DB.Where("name = ?", repositoryName).First(&repository).Error; err != nil {
		return nil, err
	}
	return &repository, nil
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

func helmReleaseFromReleaser(releaser helmrelease.Releaser) (*release.Release, error) {
	rel, ok := releaser.(*release.Release)
	if !ok {
		return nil, fmt.Errorf("unsupported helm release type %T", releaser)
	}
	return rel, nil
}

func helmReleasesFromReleasers(releasers []helmrelease.Releaser) ([]*release.Release, error) {
	releases := make([]*release.Release, 0, len(releasers))
	for _, releaser := range releasers {
		rel, err := helmReleaseFromReleaser(releaser)
		if err != nil {
			return nil, err
		}
		releases = append(releases, rel)
	}
	return releases, nil
}

func helmReleaseToYAML(rel *release.Release) string {
	if rel == nil {
		return ""
	}
	helmRelease := toHelmRelease(rel, true)
	helmRelease.Spec.DefaultValues = nil
	helmRelease.Spec.Manifest = ""
	helmRelease.Spec.Notes = ""
	data, err := yaml.Marshal(helmRelease)
	if err != nil {
		return ""
	}
	return string(data)
}

func toHelmRelease(rel *release.Release, details bool) HelmRelease {
	chartName, chartVersion, appVersion := helmChartInfo(rel)
	chartIcon := ""
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		chartIcon = rel.Chart.Metadata.Icon
	}
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
		objectMeta.CreationTimestamp = metav1.NewTime(rel.Info.FirstDeployed)
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
			Icon:         chartIcon,
			Revision:     rel.Version,
			Values:       rel.Config,
			Manifest:     rel.Manifest,
			Hooks:        toHelmHooks(rel.Hooks),
		},
	}
	if details && rel.Chart != nil {
		hr.Spec.DefaultValues = rel.Chart.Values
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

func toHelmReleaseDryRunResponse(rel *release.Release) HelmReleaseDryRunResponse {
	return HelmReleaseDryRunResponse{
		Resources: resolveManifestPreviewResources(rel.Manifest, rel.Namespace),
	}
}

func toHelmReleaseDryRunDiffResponse(current, next *release.Release) HelmReleaseDryRunResponse {
	return HelmReleaseDryRunResponse{
		Resources: diffManifestPreviewResources(
			current.Manifest,
			current.Namespace,
			next.Manifest,
			next.Namespace,
		),
	}
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
		Values:       rel.Config,
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

func helmTimePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	v := t
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
		lastRun["started_at"] = hook.LastRun.StartedAt
	}
	if !hook.LastRun.CompletedAt.IsZero() {
		lastRun["completed_at"] = hook.LastRun.CompletedAt
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
	out := []HelmReleaseResource{}
	for _, doc := range splitManifestDocuments(manifest) {
		if isCommentOnlyManifestDocument(doc) {
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

func resolveManifestPreviewResources(manifest, defaultNamespace string) []HelmReleaseDryRunResource {
	out := []HelmReleaseDryRunResource{}
	for i, doc := range splitManifestDocuments(manifest) {
		if isCommentOnlyManifestDocument(doc) {
			continue
		}
		content := trimHelmSourceComment(doc)
		var u unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(doc), &u.Object); err != nil || u.GetKind() == "" || u.GetName() == "" {
			out = append(out, HelmReleaseDryRunResource{
				Path:    fmt.Sprintf("manifest-%d.yaml", i+1),
				Content: content,
			})
			continue
		}
		ns := u.GetNamespace()
		_, clusterScoped := helmClusterScopedKinds[strings.ToLower(u.GetKind())]
		if ns == "" && !clusterScoped {
			ns = defaultNamespace
		}
		resource := HelmReleaseResource{
			APIVersion: u.GetAPIVersion(),
			Kind:       u.GetKind(),
			Name:       u.GetName(),
			Namespace:  ns,
		}
		out = append(out, HelmReleaseDryRunResource{
			HelmReleaseResource: resource,
			Path:                manifestPreviewPath(resource, i),
			Content:             content,
		})
	}
	return out
}

func diffManifestPreviewResources(currentManifest, currentNamespace, nextManifest, nextNamespace string) []HelmReleaseDryRunResource {
	currentResources := resolveManifestPreviewResources(currentManifest, currentNamespace)
	nextResources := resolveManifestPreviewResources(nextManifest, nextNamespace)
	currentByPath := make(map[string]HelmReleaseDryRunResource, len(currentResources))
	nextByPath := make(map[string]HelmReleaseDryRunResource, len(nextResources))
	for _, resource := range currentResources {
		currentByPath[resource.Path] = resource
	}
	for _, resource := range nextResources {
		nextByPath[resource.Path] = resource
	}

	out := make([]HelmReleaseDryRunResource, 0, len(currentResources)+len(nextResources))
	seen := make(map[string]struct{}, len(currentResources)+len(nextResources))
	for _, resource := range nextResources {
		if _, ok := seen[resource.Path]; ok {
			continue
		}
		seen[resource.Path] = struct{}{}
		nextResource := nextByPath[resource.Path]
		currentResource, exists := currentByPath[resource.Path]
		nextResource.OriginalContent = currentResource.Content
		nextResource.ModifiedContent = nextResource.Content
		switch {
		case !exists:
			nextResource.Status = "added"
		case currentResource.Content == nextResource.Content:
			nextResource.Status = "unchanged"
		default:
			nextResource.Status = "changed"
		}
		out = append(out, nextResource)
	}

	for _, resource := range currentResources {
		if _, ok := seen[resource.Path]; ok {
			continue
		}
		if _, exists := nextByPath[resource.Path]; exists {
			continue
		}
		resource.OriginalContent = resource.Content
		resource.ModifiedContent = ""
		resource.Status = "deleted"
		out = append(out, resource)
	}
	return out
}

func splitManifestDocuments(manifest string) []string {
	docs := []string{}
	lines := []string{}
	for _, line := range strings.Split(manifest, "\n") {
		marker := strings.TrimRight(line, " \t\r")
		if marker == "---" || strings.HasPrefix(marker, "--- #") {
			doc := strings.TrimSpace(strings.Join(lines, "\n"))
			if doc != "" {
				docs = append(docs, doc)
			}
			lines = lines[:0]
			continue
		}
		lines = append(lines, line)
	}

	doc := strings.TrimSpace(strings.Join(lines, "\n"))
	if doc != "" {
		docs = append(docs, doc)
	}
	return docs
}

func isCommentOnlyManifestDocument(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			return false
		}
	}
	return true
}

func trimHelmSourceComment(content string) string {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || !strings.HasPrefix(strings.TrimSpace(lines[0]), "# Source:") {
		return content
	}
	return strings.TrimSpace(strings.Join(lines[1:], "\n"))
}

func manifestPreviewPath(resource HelmReleaseResource, index int) string {
	scope := resource.Namespace
	if scope == "" {
		scope = "cluster"
	}
	kind := resource.Kind
	if kind == "" {
		kind = "Resource"
	}
	name := resource.Name
	if name == "" {
		name = fmt.Sprintf("manifest-%d", index+1)
	}
	return scope + "/" + kind + "/" + name + ".yaml"
}
