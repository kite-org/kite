package resources

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/scheduler"
	"gorm.io/gorm"
	"helm.sh/helm/v4/pkg/action"
	release "helm.sh/helm/v4/pkg/release/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/klog/v2"
)

const (
	helmActionTimeout = 5 * time.Minute
)

type HelmReleaseHandler struct{}

type helmReleaseRunResult struct {
	current *release.Release
	release *release.Release
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

func NewHelmReleaseHandler() *HelmReleaseHandler    { return &HelmReleaseHandler{} }
func (h *HelmReleaseHandler) IsClusterScoped() bool { return false }
func (h *HelmReleaseHandler) Searchable() bool      { return true }
func (h *HelmReleaseHandler) ListHistory(c *gin.Context) {
	cfg, err := h.actionConfig(c, c.Param("namespace"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items, err := helmutil.ReleaseHistoryItems(cfg, c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *HelmReleaseHandler) Create(c *gin.Context) {
	rel, status, err := h.runInstall(c, false)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	result := helmutil.ToHelmRelease(rel, true)
	c.JSON(http.StatusCreated, result)
}

func (h *HelmReleaseHandler) DryRunInstall(c *gin.Context) {
	rel, status, err := h.runInstall(c, true)
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, helmutil.ToHelmReleaseDryRunResponse(rel))
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

	repository, err := helmutil.ResolveChartRepository(req.RepositoryName, req.Source)
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

	rel, err = helmutil.InstallRelease(ctx, cfg, loadedChart, values, helmutil.InstallReleaseOptions{
		ReleaseName:     req.ReleaseName,
		Namespace:       namespace,
		Timeout:         helmActionTimeout,
		Description:     description,
		CreateNamespace: req.CreateNamespace,
		DryRun:          dryRun,
		Wait:            req.Wait,
	})
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
	group.GET("/:namespace/:name/auto-upgrade", h.GetAutoUpgrade)
	group.PUT("/:namespace/:name/auto-upgrade", h.UpdateAutoUpgrade)
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
			ResourceType: string(common.HelmReleases),
			CreatedAt:    item.CreationTimestamp.String(),
		})
		if limit > 0 && int64(len(results)) >= limit {
			break
		}
	}
	return results, nil
}

func (h *HelmReleaseHandler) Delete(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	cfg, err := h.actionConfig(c, c.Param("namespace"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	current, err := helmutil.GetRelease(cfg, c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	success := false
	var runErr error
	defer func() {
		h.recordHistory(c, "delete", c.Param("name"), c.Param("namespace"), current, nil, success, runErr)
	}()

	if err := helmutil.UninstallRelease(cfg, c.Param("name"), helmutil.UninstallReleaseOptions{
		Timeout:     helmActionTimeout,
		Description: "Deleted from Kite",
	}); err != nil {
		runErr = err
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := deleteHelmReleaseAutoUpgradeTask(cs.Name, current.Namespace, current.Name); err != nil {
		klog.Errorf("Failed to delete helm release auto upgrade task: %v", err)
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

	c.JSON(http.StatusOK, helmutil.ToHelmReleaseDryRunDiffResponse(result.current, result.release))
}

func (h *HelmReleaseHandler) runUpgrade(c *gin.Context, dryRun bool) (result helmReleaseRunResult, status int, err error) {
	ctx := c.Request.Context()
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseActionRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		return helmReleaseRunResult{}, http.StatusBadRequest, err
	}

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	current, err := helmutil.GetRelease(cfg, name)
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
		repository, err := helmutil.ResolveChartRepository(
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

	rel, err := helmutil.UpgradeRelease(ctx, cfg, name, chartToUpgrade, values, helmutil.UpgradeReleaseOptions{
		Namespace:         namespace,
		Timeout:           helmActionTimeout,
		ReuseValues:       req.Values == nil,
		Description:       description,
		ForceConflicts:    req.ForceConflicts,
		RollbackOnFailure: req.RollbackOnFailure,
		DryRun:            dryRun,
		Wait:              req.Wait,
	})
	if err != nil {
		return helmReleaseRunResult{}, http.StatusInternalServerError, err
	}
	result.release = rel
	return result, http.StatusOK, nil
}

func (h *HelmReleaseHandler) Rollback(c *gin.Context) {
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseActionRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cfg, err := h.actionConfig(c, namespace)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	current, err := helmutil.GetRelease(cfg, name)
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

	if err := helmutil.RollbackRelease(cfg, name, helmutil.RollbackReleaseOptions{
		Version: targetRevision,
		Timeout: helmActionTimeout,
	}); err != nil {
		runErr = err
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if next, err = helmutil.GetRelease(cfg, name); err != nil {
		klog.Errorf("Failed to read rolled back helm release: %v", err)
	}
	success = true
	c.JSON(http.StatusOK, gin.H{"message": "helm release rolled back", "revision": targetRevision})
}

func (h *HelmReleaseHandler) recordHistory(c *gin.Context, opType, name, namespace string, prev, curr *release.Release, success bool, err error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	helmutil.RecordReleaseHistory(cs.Name, user.ID, "manual", opType, name, namespace, prev, curr, success, err)
}

func (h *HelmReleaseHandler) list(c *gin.Context, namespace string, details bool) (*helmutil.HelmReleaseList, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	allNamespaces := namespace == "" || namespace == common.AllNamespaces
	cfg, err := h.actionConfigForClientSet(cs, helmutil.StorageNamespace(namespace))
	if err != nil {
		return nil, err
	}
	releases, err := helmutil.ListReleases(cfg, allNamespaces)
	if err != nil {
		return nil, err
	}

	items := make([]helmutil.HelmRelease, 0, len(releases))
	for _, rel := range releases {
		if allNamespaces && !rbac.CanAccessNamespace(user, cs.Name, rel.Namespace) {
			continue
		}
		items = append(items, helmutil.ToHelmRelease(rel, details))
	}
	return &helmutil.HelmReleaseList{TypeMeta: metav1.TypeMeta{Kind: "HelmReleaseList", APIVersion: "v1"}, Items: items}, nil
}

func (h *HelmReleaseHandler) get(c *gin.Context, namespace, name string, details bool) (*helmutil.HelmRelease, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	cfg, err := h.actionConfigForClientSet(cs, helmutil.StorageNamespace(namespace))
	if err != nil {
		return nil, err
	}
	rel, err := helmutil.GetRelease(cfg, name)
	if err != nil {
		return nil, err
	}
	hr := helmutil.ToHelmRelease(rel, details)
	return &hr, nil
}

func (h *HelmReleaseHandler) actionConfig(c *gin.Context, namespace string) (*action.Configuration, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	return h.actionConfigForClientSet(cs, helmutil.StorageNamespace(namespace))
}

func (h *HelmReleaseHandler) actionConfigForClientSet(cs *cluster.ClientSet, namespace string) (*action.Configuration, error) {
	return helmutil.NewActionConfig(cs.K8sClient.Configuration, namespace)
}

func helmReleaseID(release helmutil.HelmRelease) string {
	if release.UID != "" {
		return string(release.UID)
	}
	return release.Namespace + "/" + release.Name
}

const (
	helmReleaseAutoUpgradeDefaultScheduleType    = model.ScheduledTaskScheduleTypeInterval
	helmReleaseAutoUpgradeDefaultIntervalMinutes = 60
	helmReleaseAutoUpgradeDefaultScheduleTime    = "03:00"
	helmReleaseAutoUpgradeDefaultTimeoutMinutes  = 5
)

type helmReleaseAutoUpgradeRequest struct {
	Enabled           bool   `json:"enabled"`
	ScheduleType      string `json:"scheduleType"`
	IntervalMinutes   int    `json:"intervalMinutes"`
	ScheduleTime      string `json:"scheduleTime"`
	TimeoutMinutes    int    `json:"timeoutMinutes"`
	RollbackOnFailure bool   `json:"rollbackOnFailure"`
	Source            string `json:"source"`
	RepositoryName    string `json:"repositoryName"`
	ChartName         string `json:"chartName"`
}

type helmReleaseAutoUpgradeResponse struct {
	ClusterName       string     `json:"clusterName"`
	Namespace         string     `json:"namespace"`
	ReleaseName       string     `json:"releaseName"`
	Enabled           bool       `json:"enabled"`
	ScheduleType      string     `json:"scheduleType"`
	IntervalMinutes   int        `json:"intervalMinutes"`
	ScheduleTime      string     `json:"scheduleTime"`
	TimeoutMinutes    int        `json:"timeoutMinutes"`
	RollbackOnFailure bool       `json:"rollbackOnFailure"`
	Source            string     `json:"source,omitempty"`
	RepositoryName    string     `json:"repositoryName,omitempty"`
	ChartName         string     `json:"chartName,omitempty"`
	LastCheckedAt     *time.Time `json:"lastCheckedAt,omitempty"`
	LastUpgradedAt    *time.Time `json:"lastUpgradedAt,omitempty"`
	LastError         string     `json:"lastError,omitempty"`
}

func (h *HelmReleaseHandler) GetAutoUpgrade(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	namespace, name := c.Param("namespace"), c.Param("name")
	task, err := getHelmReleaseAutoUpgradeTask(cs.Name, namespace, name)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, helmReleaseAutoUpgradeResponse{
				ClusterName:       cs.Name,
				Namespace:         namespace,
				ReleaseName:       name,
				Enabled:           false,
				ScheduleType:      helmReleaseAutoUpgradeDefaultScheduleType,
				IntervalMinutes:   helmReleaseAutoUpgradeDefaultIntervalMinutes,
				ScheduleTime:      helmReleaseAutoUpgradeDefaultScheduleTime,
				TimeoutMinutes:    helmReleaseAutoUpgradeDefaultTimeoutMinutes,
				RollbackOnFailure: true,
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	response, err := toHelmReleaseAutoUpgradeResponse(task)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *HelmReleaseHandler) UpdateAutoUpgrade(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	namespace, name := c.Param("namespace"), c.Param("name")
	var req helmReleaseAutoUpgradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	normalizeHelmReleaseAutoUpgradeRequest(&req)
	if err := validateHelmReleaseAutoUpgradeRequest(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if status, err := h.ensureHelmReleaseAutoUpgradeTarget(cs, namespace, name, req); err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	payload := scheduler.HelmReleaseAutoUpgradePayload{
		Namespace:         namespace,
		ResourceType:      string(common.HelmReleases),
		ResourceName:      name,
		Source:            req.Source,
		RepositoryName:    req.RepositoryName,
		ChartName:         req.ChartName,
		TimeoutMinutes:    req.TimeoutMinutes,
		RollbackOnFailure: req.RollbackOnFailure,
	}
	key := scheduler.HelmReleaseAutoUpgradeTaskKey(namespace, name)
	taskName := scheduler.HelmReleaseAutoUpgradeTaskName(namespace, name)
	task, queryErr := getHelmReleaseAutoUpgradeTask(cs.Name, namespace, name)
	if queryErr == nil && task.Payload != "" {
		var existingPayload scheduler.HelmReleaseAutoUpgradePayload
		if err := json.Unmarshal([]byte(task.Payload), &existingPayload); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		payload.LastUpgradedAt = existingPayload.LastUpgradedAt
	}

	payloadData, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var nextRunAt *time.Time
	if req.Enabled {
		next, err := scheduler.NextRunAt(time.Now(), req.ScheduleType, req.IntervalMinutes, req.ScheduleTime)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		nextRunAt = &next
	}
	switch {
	case errors.Is(queryErr, gorm.ErrRecordNotFound):
		task = model.ScheduledTask{
			ClusterName: cs.Name,
			Type:        scheduler.HelmReleaseAutoUpgradeTaskType,
			Key:         key,
		}
	case queryErr != nil:
		err = queryErr
	default:
		task.ClusterName = cs.Name
		task.Type = scheduler.HelmReleaseAutoUpgradeTaskType
		task.Key = key
	}
	task.Name = taskName
	task.Enabled = req.Enabled
	task.ScheduleType = req.ScheduleType
	task.IntervalMinutes = req.IntervalMinutes
	task.ScheduleTime = req.ScheduleTime
	task.Payload = string(payloadData)
	task.LastError = ""
	task.NextRunAt = nextRunAt
	task.LockedAt = nil
	task.LockedBy = ""
	task.LockUntil = nil
	if err == nil {
		err = model.DB.Save(&task).Error
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	response, err := toHelmReleaseAutoUpgradeResponse(task)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, response)
}

func normalizeHelmReleaseAutoUpgradeRequest(req *helmReleaseAutoUpgradeRequest) {
	req.Source = strings.TrimSpace(req.Source)
	req.RepositoryName = strings.TrimSpace(req.RepositoryName)
	req.ChartName = strings.TrimSpace(req.ChartName)
	req.ScheduleType = strings.TrimSpace(req.ScheduleType)
	req.ScheduleTime = strings.TrimSpace(req.ScheduleTime)
	if req.ScheduleType == "" {
		req.ScheduleType = helmReleaseAutoUpgradeDefaultScheduleType
	}
	if req.IntervalMinutes == 0 {
		req.IntervalMinutes = helmReleaseAutoUpgradeDefaultIntervalMinutes
	}
	if req.ScheduleTime == "" {
		req.ScheduleTime = helmReleaseAutoUpgradeDefaultScheduleTime
	}
	if req.TimeoutMinutes == 0 {
		req.TimeoutMinutes = helmReleaseAutoUpgradeDefaultTimeoutMinutes
	}
	if req.Source == "" && (req.Enabled || req.RepositoryName != "" || req.ChartName != "") {
		req.Source = helmutil.ChartSourceRepository
	}
}

func validateHelmReleaseAutoUpgradeRequest(req helmReleaseAutoUpgradeRequest) error {
	if req.Source != "" && req.Source != helmutil.ChartSourceRepository && req.Source != helmutil.ChartSourceArtifactHub {
		return fmt.Errorf("unsupported chart source")
	}
	if req.ScheduleType != model.ScheduledTaskScheduleTypeInterval && req.ScheduleType != model.ScheduledTaskScheduleTypeDaily {
		return fmt.Errorf("unsupported scheduleType")
	}
	if req.ScheduleType == model.ScheduledTaskScheduleTypeInterval && req.IntervalMinutes < 1 {
		return fmt.Errorf("intervalMinutes must be at least 1")
	}
	if req.ScheduleType == model.ScheduledTaskScheduleTypeDaily {
		if _, err := scheduler.NextRunAt(time.Now(), req.ScheduleType, req.IntervalMinutes, req.ScheduleTime); err != nil {
			return err
		}
	}
	if req.TimeoutMinutes < 1 {
		return fmt.Errorf("timeoutMinutes must be at least 1")
	}
	if req.Enabled && (req.RepositoryName == "" || req.ChartName == "") {
		return fmt.Errorf("repositoryName and chartName are required")
	}
	return nil
}

func (h *HelmReleaseHandler) ensureHelmReleaseAutoUpgradeTarget(cs *cluster.ClientSet, namespace, name string, req helmReleaseAutoUpgradeRequest) (int, error) {
	if req.Enabled {
		cfg, err := h.actionConfigForClientSet(cs, helmutil.StorageNamespace(namespace))
		if err != nil {
			return http.StatusInternalServerError, err
		}
		if _, err := helmutil.GetRelease(cfg, name); err != nil {
			return http.StatusInternalServerError, err
		}
	}
	return http.StatusOK, nil
}

func getHelmReleaseAutoUpgradeTask(clusterName, namespace, releaseName string) (model.ScheduledTask, error) {
	var task model.ScheduledTask
	err := model.DB.
		Where("cluster_name = ? AND type = ? AND key = ?", clusterName, scheduler.HelmReleaseAutoUpgradeTaskType, scheduler.HelmReleaseAutoUpgradeTaskKey(namespace, releaseName)).
		First(&task).Error
	return task, err
}

func deleteHelmReleaseAutoUpgradeTask(clusterName, namespace, releaseName string) error {
	return model.DB.
		Where("cluster_name = ? AND type = ? AND key = ?", clusterName, scheduler.HelmReleaseAutoUpgradeTaskType, scheduler.HelmReleaseAutoUpgradeTaskKey(namespace, releaseName)).
		Delete(&model.ScheduledTask{}).Error
}

func toHelmReleaseAutoUpgradeResponse(task model.ScheduledTask) (helmReleaseAutoUpgradeResponse, error) {
	var payload scheduler.HelmReleaseAutoUpgradePayload
	if task.Payload != "" {
		if err := json.Unmarshal([]byte(task.Payload), &payload); err != nil {
			return helmReleaseAutoUpgradeResponse{}, err
		}
	}
	return helmReleaseAutoUpgradeResponse{
		ClusterName:       task.ClusterName,
		Namespace:         payload.Namespace,
		ReleaseName:       payload.ResourceName,
		Enabled:           task.Enabled,
		ScheduleType:      task.ScheduleType,
		IntervalMinutes:   task.IntervalMinutes,
		ScheduleTime:      task.ScheduleTime,
		TimeoutMinutes:    payload.TimeoutMinutes,
		RollbackOnFailure: payload.RollbackOnFailure,
		Source:            payload.Source,
		RepositoryName:    payload.RepositoryName,
		ChartName:         payload.ChartName,
		LastCheckedAt:     task.LastRunAt,
		LastUpgradedAt:    payload.LastUpgradedAt,
		LastError:         task.LastError,
	}, nil
}
