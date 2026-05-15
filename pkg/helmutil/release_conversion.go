package helmutil

import (
	"time"

	release "helm.sh/helm/v4/pkg/release/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

func ReleaseToYAML(rel *release.Release) string {
	if rel == nil {
		return ""
	}
	helmRelease := ToHelmRelease(rel, true)
	helmRelease.Spec.DefaultValues = nil
	helmRelease.Spec.Manifest = ""
	helmRelease.Spec.Notes = ""
	data, err := yaml.Marshal(helmRelease)
	if err != nil {
		return ""
	}
	return string(data)
}

func ToHelmRelease(rel *release.Release, details bool) HelmRelease {
	chartName, chartVersion, appVersion := ChartInfo(rel)
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

func ToHelmReleaseHistoryItem(rel *release.Release) HelmReleaseHistoryItem {
	chartName, chartVersion, appVersion := ChartInfo(rel)
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

func toHelmHooks(hooks []*release.Hook) []HelmHook {
	out := make([]HelmHook, 0, len(hooks))
	for _, hook := range hooks {
		if hook == nil {
			continue
		}
		events := make([]string, 0, len(hook.Events))
		for _, event := range hook.Events {
			events = append(events, event.String())
		}
		out = append(out, HelmHook{
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
