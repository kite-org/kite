package helmutil

import (
	"context"
	"sort"
	"time"

	"helm.sh/helm/v4/pkg/action"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/kube"
	release "helm.sh/helm/v4/pkg/release/v1"
)

type InstallReleaseOptions struct {
	ReleaseName     string
	Namespace       string
	Timeout         time.Duration
	Description     string
	CreateNamespace bool
	DryRun          bool
	Wait            bool
}

type UninstallReleaseOptions struct {
	Timeout     time.Duration
	Description string
}

type RollbackReleaseOptions struct {
	Version int
	Timeout time.Duration
}

func GetRelease(cfg *action.Configuration, name string) (*release.Release, error) {
	releaser, err := action.NewGet(cfg).Run(name)
	if err != nil {
		return nil, err
	}
	return ReleaseFromReleaser(releaser)
}

func ListReleases(cfg *action.Configuration, allNamespaces bool) ([]*release.Release, error) {
	listAction := action.NewList(cfg)
	listAction.All = true
	listAction.AllNamespaces = allNamespaces
	listAction.StateMask = action.ListAll
	listAction.Sort = action.ByDateDesc
	releasers, err := listAction.Run()
	if err != nil {
		return nil, err
	}
	return ReleasesFromReleasers(releasers)
}

func ReleaseHistoryItems(cfg *action.Configuration, name string) ([]HelmReleaseHistoryItem, error) {
	releasers, err := action.NewHistory(cfg).Run(name)
	if err != nil {
		return nil, err
	}
	releases, err := ReleasesFromReleasers(releasers)
	if err != nil {
		return nil, err
	}
	sort.Slice(releases, func(i, j int) bool {
		return releases[i].Version > releases[j].Version
	})
	items := make([]HelmReleaseHistoryItem, 0, len(releases))
	for _, rel := range releases {
		items = append(items, ToHelmReleaseHistoryItem(rel))
	}
	return items, nil
}

func InstallRelease(ctx context.Context, cfg *action.Configuration, chartToInstall *chart.Chart, values map[string]interface{}, opts InstallReleaseOptions) (*release.Release, error) {
	install := action.NewInstall(cfg)
	install.ReleaseName = opts.ReleaseName
	install.Namespace = opts.Namespace
	install.Timeout = opts.Timeout
	install.Description = opts.Description
	install.CreateNamespace = opts.CreateNamespace
	if opts.DryRun {
		install.DryRunStrategy = action.DryRunClient
	}
	install.WaitStrategy = kube.HookOnlyStrategy
	if opts.Wait {
		install.WaitStrategy = kube.StatusWatcherStrategy
	}
	releaser, err := install.RunWithContext(ctx, chartToInstall, values)
	if err != nil {
		return nil, err
	}
	return ReleaseFromReleaser(releaser)
}

func UninstallRelease(cfg *action.Configuration, name string, opts UninstallReleaseOptions) error {
	uninstall := action.NewUninstall(cfg)
	uninstall.Timeout = opts.Timeout
	uninstall.Description = opts.Description
	uninstall.WaitStrategy = kube.HookOnlyStrategy
	_, err := uninstall.Run(name)
	return err
}

func RollbackRelease(cfg *action.Configuration, name string, opts RollbackReleaseOptions) error {
	rollback := action.NewRollback(cfg)
	rollback.Version = opts.Version
	rollback.Timeout = opts.Timeout
	rollback.WaitStrategy = kube.HookOnlyStrategy
	return rollback.Run(name)
}
