package gpu

import (
	"context"
	"fmt"
	"sync"
	"time"

	prommodel "github.com/prometheus/common/model"
	"github.com/zxh326/kite/pkg/cluster"
	"k8s.io/klog/v2"
)

const detectTTL = 60 * time.Second

type detectResult struct {
	enabled bool
	level   string
	expires time.Time
}

var (
	detectMu    sync.Mutex
	detectCache = map[string]detectResult{}
)

// detect reports whether the cluster has GPU nodes and which display level
// is available. Results are cached per cluster for detectTTL.
func detect(ctx context.Context, cs *cluster.ClientSet) detectResult {
	detectMu.Lock()
	if r, ok := detectCache[cs.Name]; ok && time.Now().Before(r.expires) {
		detectMu.Unlock()
		return r
	}
	detectMu.Unlock()

	r := detectResult{level: levelBasic, expires: time.Now().Add(detectTTL)}
	keys := ResourceKeys()
	nodes, err := listGPUNodes(ctx, cs.K8sClient, keys)
	if err != nil {
		klog.Warningf("gpu plugin: failed to list nodes for cluster %s: %v", cs.Name, err)
	}
	r.enabled = len(nodes) > 0
	if r.enabled && detectExporter(ctx, cs, keys) {
		r.level = levelDCGM
	}

	detectMu.Lock()
	detectCache[cs.Name] = r
	detectMu.Unlock()
	return r
}

// detectExporter checks whether any vendor's card-level exporter has series
// in the cluster's Prometheus.
func detectExporter(ctx context.Context, cs *cluster.ClientSet, keys []GPUResourceKey) bool {
	if cs.PromClient == nil {
		return false
	}
	for _, k := range keys {
		if k.Exporter == nil {
			continue
		}
		val, _, err := cs.PromClient.Query(ctx, fmt.Sprintf("count(%s)", k.Exporter.DetectMetric), time.Now())
		if err != nil {
			klog.V(4).Infof("gpu plugin: exporter detection query failed for cluster %s: %v", cs.Name, err)
			continue
		}
		if vec, ok := val.(prommodel.Vector); ok && len(vec) > 0 && vec[0].Value > 0 {
			return true
		}
	}
	return false
}
