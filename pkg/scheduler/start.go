package scheduler

import (
	"context"

	"github.com/zxh326/kite/pkg/cluster"
)

const (
	helmReleaseAutoUpgradeTaskType = "helm_release_auto_upgrade"
)

func Start(ctx context.Context, cm *cluster.ClusterManager) {
	manager := NewManager()

	manager.Register(helmReleaseAutoUpgradeTaskType, &helmReleaseAutoUpgradeExecutor{cm: cm})
	manager.Start(ctx)
}
