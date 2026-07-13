package gpu

const (
	levelBasic = "basic"
	levelDCGM  = "dcgm"
)

type Summary struct {
	TotalGPUs     int64 `json:"totalGPUs"`
	AllocatedGPUs int64 `json:"allocatedGPUs"`
	FreeGPUs      int64 `json:"freeGPUs"`
}

type ContainerAllocation struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type PodAllocation struct {
	Namespace  string                `json:"namespace"`
	Name       string                `json:"name"`
	Count      int64                 `json:"count"`
	Containers []ContainerAllocation `json:"containers"`
}

type NodeResource struct {
	Key         string          `json:"key"`
	Allocatable int64           `json:"allocatable"`
	Allocated   int64           `json:"allocated"`
	Pods        []PodAllocation `json:"pods"`
}

type Occupant struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container,omitempty"`
}

// Card is a physical GPU (or MIG instance) reported by a card-level
// exporter. Occupant is nil for idle cards.
type Card struct {
	Index            string    `json:"index"`
	UUID             string    `json:"uuid"`
	ModelName        string    `json:"modelName,omitempty"`
	Utilization      float64   `json:"utilization"`
	MemoryUsedBytes  int64     `json:"memoryUsedBytes,omitempty"`
	MemoryTotalBytes int64     `json:"memoryTotalBytes,omitempty"`
	Occupant         *Occupant `json:"occupant"`
}

type NodeGPU struct {
	Name      string         `json:"name"`
	Ready     bool           `json:"ready"`
	GPUModel  string         `json:"gpuModel,omitempty"`
	Resources []NodeResource `json:"resources"`
	// Cards is only populated when Level is "dcgm".
	Cards []Card `json:"cards,omitempty"`
}

type Overview struct {
	Level        string    `json:"level"`
	ResourceKeys []string  `json:"resourceKeys"`
	Summary      Summary   `json:"summary"`
	Nodes        []NodeGPU `json:"nodes"`
	// UnassignedCards are exporter series whose node label could not be
	// matched to a known GPU node.
	UnassignedCards []Card `json:"unassignedCards,omitempty"`
}
