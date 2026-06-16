package common

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type SearchResult struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace,omitempty"`
	ResourceType string `json:"resourceType"`
	CreatedAt    string `json:"createdAt"`
}

type RelatedResource struct {
	Type       string `json:"type"`
	APIVersion string `json:"apiVersion,omitempty"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace,omitempty"`
}

type Resource struct {
	Allocatable int64 `json:"allocatable"`
	Requested   int64 `json:"requested"`
	Limited     int64 `json:"limited"`
}

type ResourceMetric struct {
	CPU Resource `json:"cpu,omitempty"`
	Mem Resource `json:"memory,omitempty"`
}

type PasswordLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	MFACode  string `json:"mfa_code"`
}

type ImportClustersRequest struct {
	Config    string `json:"config"`
	InCluster bool   `json:"inCluster"`
}

type ClusterInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	IsDefault bool   `json:"isDefault"`
	Error     string `json:"error,omitempty"`
}

type MetricsCell struct {
	CPUUsage      int64 `json:"cpuUsage,omitempty"`
	CPULimit      int64 `json:"cpuLimit,omitempty"`
	CPURequest    int64 `json:"cpuRequest,omitempty"`
	MemoryUsage   int64 `json:"memoryUsage,omitempty"`
	MemoryLimit   int64 `json:"memoryLimit,omitempty"`
	MemoryRequest int64 `json:"memoryRequest,omitempty"`
	Pods          int64 `json:"pods,omitempty"`
	PodsLimit     int64 `json:"podsLimit,omitempty"`
}

type NodeWithMetrics struct {
	*corev1.Node `json:",inline"`
	Metrics      *MetricsCell `json:"metrics"`
}

type NodeListWithMetrics struct {
	Items           []*NodeWithMetrics `json:"items"`
	metav1.TypeMeta `json:",inline"`
	// Standard list metadata.
	// More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
	// +optional
	metav1.ListMeta `json:"metadata" protobuf:"bytes,1,opt,name=metadata"`
}
