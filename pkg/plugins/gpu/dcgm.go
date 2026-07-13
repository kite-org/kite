package gpu

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	prommodel "github.com/prometheus/common/model"
	"github.com/zxh326/kite/pkg/cluster"
)

const mib = 1024 * 1024

// enrichWithCards upgrades a basic overview with per-card data from the
// vendor exporters (dcgm-exporter for NVIDIA). It mutates overview only on
// success; on error the caller keeps serving the basic view.
func enrichWithCards(ctx context.Context, cs *cluster.ClientSet, keys []GPUResourceKey, overview *Overview) error {
	if cs.PromClient == nil {
		return fmt.Errorf("prometheus client not available")
	}

	cards := map[string]*Card{}
	cardNode := map[string]string{}
	for _, k := range keys {
		if k.Exporter == nil {
			continue
		}
		utilVec, err := queryVector(ctx, cs, k.Exporter.UtilMetric)
		if err != nil {
			return err
		}
		if len(utilVec) == 0 {
			continue
		}
		// With honor_labels=false Prometheus renames the exporter's own
		// workload labels to exported_*, while plain pod/namespace describe
		// the dcgm-exporter pod itself. If any sample carries exported_pod,
		// only trust the exported_* variant for the whole family.
		exportedOnly := false
		for _, s := range utilVec {
			if labelOf(s.Metric, "exported_pod") != "" {
				exportedOnly = true
				break
			}
		}
		for _, s := range utilVec {
			id := cardID(s.Metric)
			if id == "" {
				continue
			}
			card := &Card{
				Index:       labelOf(s.Metric, "gpu", "device"),
				UUID:        labelOf(s.Metric, "UUID", "uuid"),
				ModelName:   labelOf(s.Metric, "modelName", "DCGM_FI_DEV_NAME"),
				Utilization: float64(s.Value),
				Occupant:    occupantOf(s.Metric, exportedOnly),
			}
			cards[id] = card
			cardNode[id] = labelOf(s.Metric, "Hostname", "kubernetes_node", "node")
		}

		usedVec, err := queryVector(ctx, cs, k.Exporter.MemUsedMetric)
		if err == nil {
			for _, s := range usedVec {
				if card, ok := cards[cardID(s.Metric)]; ok {
					card.MemoryUsedBytes = int64(s.Value) * mib
				}
			}
		}
		totalVec, err := queryVector(ctx, cs, k.Exporter.MemTotalMetric)
		if err == nil && len(totalVec) > 0 {
			for _, s := range totalVec {
				if card, ok := cards[cardID(s.Metric)]; ok {
					card.MemoryTotalBytes = int64(s.Value) * mib
				}
			}
		} else if k.Exporter.MemFreeMetric != "" {
			freeVec, err := queryVector(ctx, cs, k.Exporter.MemFreeMetric)
			if err == nil {
				for _, s := range freeVec {
					if card, ok := cards[cardID(s.Metric)]; ok {
						card.MemoryTotalBytes = card.MemoryUsedBytes + int64(s.Value)*mib
					}
				}
			}
		}
	}

	if len(cards) == 0 {
		return fmt.Errorf("no card series found")
	}

	nodeIndex := make(map[string]*NodeGPU, len(overview.Nodes))
	for i := range overview.Nodes {
		nodeIndex[overview.Nodes[i].Name] = &overview.Nodes[i]
	}
	var unassigned []Card
	for id, card := range cards {
		if node, ok := nodeIndex[cardNode[id]]; ok {
			node.Cards = append(node.Cards, *card)
		} else {
			unassigned = append(unassigned, *card)
		}
	}
	for i := range overview.Nodes {
		sortCards(overview.Nodes[i].Cards)
	}
	sortCards(unassigned)

	overview.Level = levelDCGM
	overview.UnassignedCards = unassigned
	return nil
}

func queryVector(ctx context.Context, cs *cluster.ClientSet, metric string) (prommodel.Vector, error) {
	if metric == "" {
		return nil, nil
	}
	val, _, err := cs.PromClient.Query(ctx, metric, time.Now())
	if err != nil {
		return nil, err
	}
	vec, ok := val.(prommodel.Vector)
	if !ok {
		return nil, fmt.Errorf("unexpected result type %T for %s", val, metric)
	}
	return vec, nil
}

// labelOf returns the first non-empty label among names. dcgm-exporter
// versions and scrape configs disagree on label names, so every lookup goes
// through a candidate list.
func labelOf(m prommodel.Metric, names ...string) string {
	for _, n := range names {
		if v, ok := m[prommodel.LabelName(n)]; ok && v != "" {
			return string(v)
		}
	}
	return ""
}

// cardID identifies a card across metric families. MIG instances share the
// parent UUID, so GPU_I_ID is part of the key.
func cardID(m prommodel.Metric) string {
	id := labelOf(m, "UUID", "uuid")
	if id == "" {
		id = labelOf(m, "Hostname", "kubernetes_node", "node", "instance") + "/gpu-" + labelOf(m, "gpu", "device")
	}
	if gi := labelOf(m, "GPU_I_ID"); gi != "" {
		id += "/mig-" + gi
	}
	return id
}

func occupantOf(m prommodel.Metric, exportedOnly bool) *Occupant {
	if pod := labelOf(m, "exported_pod"); pod != "" {
		return &Occupant{
			Namespace: labelOf(m, "exported_namespace"),
			Pod:       pod,
			Container: labelOf(m, "exported_container"),
		}
	}
	if exportedOnly {
		return nil
	}
	pod := labelOf(m, "pod")
	if pod == "" || isSelfReference(m) {
		return nil
	}
	return &Occupant{
		Namespace: labelOf(m, "namespace"),
		Pod:       pod,
		Container: labelOf(m, "container"),
	}
}

// isSelfReference detects series whose pod/namespace labels describe the
// scrape target (the exporter's own pod) rather than a workload — the case
// when dcgm-exporter runs without Kubernetes pod mapping. Target-metadata
// pods are named after their job/service (e.g. job="nvidia-dcgm-exporter",
// pod="nvidia-dcgm-exporter-l6wjn").
func isSelfReference(m prommodel.Metric) bool {
	pod := labelOf(m, "pod")
	if pod == "" {
		return false
	}
	for _, l := range []string{"job", "service"} {
		if v := labelOf(m, l); v != "" && strings.HasPrefix(pod, v+"-") {
			return true
		}
	}
	return false
}

func sortCards(cards []Card) {
	sort.Slice(cards, func(i, j int) bool {
		a, errA := strconv.Atoi(cards[i].Index)
		b, errB := strconv.Atoi(cards[j].Index)
		if errA == nil && errB == nil && a != b {
			return a < b
		}
		if cards[i].Index != cards[j].Index {
			return cards[i].Index < cards[j].Index
		}
		return cards[i].UUID < cards[j].UUID
	})
}
