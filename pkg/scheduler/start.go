package scheduler

import (
	"context"

	"github.com/zxh326/kite/pkg/cluster"
)

func Start(ctx context.Context, cm *cluster.ClusterManager) {
	manager := NewManager()

	registerHelmReleaseAutoUpgradeExecutor(manager, cm)
	manager.Start(ctx)
}
