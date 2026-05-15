package helmutil

import (
	"context"
	"time"

	"helm.sh/helm/v4/pkg/action"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/kube"
	release "helm.sh/helm/v4/pkg/release/v1"
)

type UpgradeReleaseOptions struct {
	Namespace         string
	Timeout           time.Duration
	ReuseValues       bool
	Description       string
	ForceConflicts    bool
	RollbackOnFailure bool
	DryRun            bool
	Wait              bool
}

func UpgradeRelease(ctx context.Context, cfg *action.Configuration, name string, chartToUpgrade *chart.Chart, values map[string]interface{}, opts UpgradeReleaseOptions) (*release.Release, error) {
	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = opts.Namespace
	upgrade.Timeout = opts.Timeout
	upgrade.ReuseValues = opts.ReuseValues
	upgrade.Description = opts.Description
	upgrade.ForceConflicts = opts.ForceConflicts
	upgrade.RollbackOnFailure = opts.RollbackOnFailure
	if opts.DryRun {
		upgrade.DryRunStrategy = action.DryRunClient
	}
	upgrade.WaitStrategy = kube.HookOnlyStrategy
	if opts.Wait {
		upgrade.WaitStrategy = kube.StatusWatcherStrategy
	}
	releaser, err := upgrade.RunWithContext(ctx, name, chartToUpgrade, values)
	if err != nil {
		return nil, err
	}
	return ReleaseFromReleaser(releaser)
}
