package gpu

import (
	"os"
	"strings"

	corev1 "k8s.io/api/core/v1"
)

// ExporterSpec describes the Prometheus metrics exposed by a vendor's
// card-level exporter (e.g. dcgm-exporter for NVIDIA). Memory metrics are
// reported in MiB by dcgm-exporter.
type ExporterSpec struct {
	DetectMetric   string
	UtilMetric     string
	MemUsedMetric  string
	MemTotalMetric string
	// MemFreeMetric is combined with MemUsedMetric to derive the total when
	// MemTotalMetric has no series (older dcgm-exporter versions).
	MemFreeMetric string
}

type GPUResourceKey struct {
	Key    corev1.ResourceName
	Vendor string
	// ProductLabel is the node label carrying the GPU product name when the
	// vendor's feature discovery publishes one (e.g. GPU Feature Discovery).
	ProductLabel string
	// Exporter is nil when the vendor has no supported card-level exporter.
	Exporter *ExporterSpec
}

var dcgmSpec = ExporterSpec{
	DetectMetric:   "DCGM_FI_DEV_GPU_UTIL",
	UtilMetric:     "DCGM_FI_DEV_GPU_UTIL",
	MemUsedMetric:  "DCGM_FI_DEV_FB_USED",
	MemTotalMetric: "DCGM_FI_DEV_FB_TOTAL",
	MemFreeMetric:  "DCGM_FI_DEV_FB_FREE",
}

var knownKeys = map[string]GPUResourceKey{
	"nvidia.com/gpu": {Key: "nvidia.com/gpu", Vendor: "nvidia", ProductLabel: "nvidia.com/gpu.product", Exporter: &dcgmSpec},
	"amd.com/gpu":    {Key: "amd.com/gpu", Vendor: "amd"},
}

var defaultKeys = []GPUResourceKey{knownKeys["nvidia.com/gpu"]}

// ResourceKeys returns the GPU extended-resource names the plugin watches.
// GPU_RESOURCE_KEYS (comma-separated) overrides the default list; unknown
// keys are tracked count-only, with the vendor derived from the key's domain.
func ResourceKeys() []GPUResourceKey {
	env := strings.TrimSpace(os.Getenv("GPU_RESOURCE_KEYS"))
	if env == "" {
		return defaultKeys
	}
	var keys []GPUResourceKey
	for _, raw := range strings.Split(env, ",") {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if k, ok := knownKeys[name]; ok {
			keys = append(keys, k)
			continue
		}
		vendor := name
		if i := strings.IndexAny(name, "./"); i > 0 {
			vendor = name[:i]
		}
		keys = append(keys, GPUResourceKey{Key: corev1.ResourceName(name), Vendor: vendor})
	}
	if len(keys) == 0 {
		return defaultKeys
	}
	return keys
}
