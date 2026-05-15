package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/action"
	"helm.sh/helm/v4/pkg/kube"
	helmrelease "helm.sh/helm/v4/pkg/release"
	release "helm.sh/helm/v4/pkg/release/v1"
	"k8s.io/klog/v2"
	"sigs.k8s.io/yaml"
)

const (
	HelmReleaseAutoUpgradeTaskType = "helm_release_auto_upgrade"
	helmReleaseResourceName        = "helmrelease"
)

type HelmReleaseAutoUpgradePayload struct {
	Namespace         string     `json:"namespace"`
	ResourceType      string     `json:"resourceType"`
	ResourceName      string     `json:"resourceName"`
	Source            string     `json:"source"`
	RepositoryName    string     `json:"repositoryName"`
	ChartName         string     `json:"chartName"`
	TimeoutMinutes    int        `json:"timeoutMinutes"`
	RollbackOnFailure bool       `json:"rollbackOnFailure"`
	LastUpgradedAt    *time.Time `json:"lastUpgradedAt,omitempty"`
}

type helmReleaseAutoUpgradeExecutor struct {
	cm *cluster.ClusterManager
}

func registerHelmReleaseAutoUpgradeExecutor(manager *Manager, cm *cluster.ClusterManager) {
	manager.Register(HelmReleaseAutoUpgradeTaskType, &helmReleaseAutoUpgradeExecutor{cm: cm})
}

func (e *helmReleaseAutoUpgradeExecutor) Run(ctx context.Context, task model.ScheduledTask) error {
	var payload HelmReleaseAutoUpgradePayload
	if err := json.Unmarshal([]byte(task.Payload), &payload); err != nil {
		return err
	}
	systemUser, err := model.EnsureSystemUser()
	if err != nil {
		return err
	}
	releaseName := payload.ResourceName
	cs, err := e.cm.GetClientSet(task.ClusterName)
	if err != nil {
		return err
	}
	cfg, err := helmutil.NewActionConfig(cs.K8sClient.Configuration, helmStorageNamespace(payload.Namespace))
	if err != nil {
		return err
	}
	currentReleaser, err := action.NewGet(cfg).Run(releaseName)
	if err != nil {
		return err
	}
	current, err := helmReleaseFromReleaser(currentReleaser)
	if err != nil {
		return err
	}
	if current.Chart == nil {
		return fmt.Errorf("helm release chart is missing")
	}

	_, currentVersion, _ := helmChartInfo(current)
	nextChart, err := helmutil.LatestChartPackage(ctx, payload.Source, payload.RepositoryName, payload.ChartName)
	if err != nil {
		return err
	}
	if !helmutil.IsChartVersionNewer(nextChart.Version, currentVersion) {
		return nil
	}

	loadedChart, err := helmutil.LoadArchive(nextChart.URL, nextChart.Repository)
	if err != nil {
		return err
	}

	var next *release.Release
	var runErr error
	success := false
	defer func() {
		recordHelmReleaseHistoryForUser(
			cs,
			*systemUser,
			"auto",
			"upgrade",
			releaseName,
			payload.Namespace,
			current,
			next,
			success,
			runErr,
		)
	}()

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = payload.Namespace
	upgrade.Timeout = time.Duration(payload.TimeoutMinutes) * time.Minute
	upgrade.ReuseValues = true
	upgrade.RollbackOnFailure = payload.RollbackOnFailure
	upgrade.Description = "Auto upgrade requested from Kite"
	upgrade.WaitStrategy = kube.HookOnlyStrategy
	releaser, err := upgrade.RunWithContext(ctx, releaseName, loadedChart, map[string]interface{}{})
	if err != nil {
		runErr = err
		return err
	}
	next, err = helmReleaseFromReleaser(releaser)
	if err != nil {
		runErr = err
		return err
	}
	success = true
	upgradedAt := time.Now()
	payload.LastUpgradedAt = &upgradedAt
	return saveHelmAutoUpgradePayload(task.ID, payload)
}

func saveHelmAutoUpgradePayload(taskID uint, payload HelmReleaseAutoUpgradePayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return model.DB.Model(&model.ScheduledTask{}).Where("id = ?", taskID).Update("payload", string(data)).Error
}

func HelmReleaseAutoUpgradeTaskKey(namespace, releaseName string) string {
	return namespace + "/" + releaseName
}

func HelmReleaseAutoUpgradeTaskName(namespace, releaseName string) string {
	return fmt.Sprintf("Helm release auto upgrade %s/%s", namespace, releaseName)
}

func helmStorageNamespace(namespace string) string {
	if namespace == common.AllNamespaces {
		return ""
	}
	return namespace
}

func helmReleaseFromReleaser(releaser helmrelease.Releaser) (*release.Release, error) {
	rel, ok := releaser.(*release.Release)
	if !ok {
		return nil, fmt.Errorf("unsupported helm release type %T", releaser)
	}
	return rel, nil
}

func helmChartInfo(rel *release.Release) (string, string, string) {
	if rel.Chart == nil || rel.Chart.Metadata == nil {
		return "", "", ""
	}
	return rel.Chart.Metadata.Name, rel.Chart.Metadata.Version, rel.Chart.Metadata.AppVersion
}

func recordHelmReleaseHistoryForUser(cs *cluster.ClientSet, user model.User, source, opType, name, namespace string, prev, curr *release.Release, success bool, err error) {
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
	history := model.ResourceHistory{
		ClusterName:     cs.Name,
		ResourceType:    helmReleaseResourceName,
		ResourceName:    name,
		Namespace:       namespace,
		OperationType:   opType,
		OperationSource: source,
		ResourceYAML:    helmReleaseToYAML(curr),
		PreviousYAML:    helmReleaseToYAML(prev),
		Success:         success,
		ErrorMessage:    errMsg,
		OperatorID:      user.ID,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("Failed to create helm release history: %v", err)
	}
}

func helmReleaseToYAML(rel *release.Release) string {
	if rel == nil {
		return ""
	}
	chartName, chartVersion, appVersion := helmChartInfo(rel)
	chart := chartName
	if chart != "" && chartVersion != "" {
		chart += "-" + chartVersion
	}
	resource := map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "HelmRelease",
		"metadata": map[string]interface{}{
			"name":      rel.Name,
			"namespace": rel.Namespace,
			"labels":    rel.Labels,
		},
		"spec": map[string]interface{}{
			"releaseName":  rel.Name,
			"namespace":    rel.Namespace,
			"chart":        chart,
			"chartName":    chartName,
			"chartVersion": chartVersion,
			"appVersion":   appVersion,
			"revision":     rel.Version,
			"values":       rel.Config,
		},
	}
	if rel.Info != nil {
		resource["status"] = map[string]interface{}{
			"status":        rel.Info.Status.String(),
			"firstDeployed": rel.Info.FirstDeployed,
			"lastDeployed":  rel.Info.LastDeployed,
			"deleted":       rel.Info.Deleted,
		}
		resource["spec"].(map[string]interface{})["description"] = rel.Info.Description
	}
	data, err := yaml.Marshal(resource)
	if err != nil {
		return ""
	}
	return string(data)
}
