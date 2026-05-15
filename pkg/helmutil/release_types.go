package helmutil

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type HelmRelease struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata"`
	Spec              HelmReleaseSpec   `json:"spec"`
	Status            HelmReleaseStatus `json:"status"`
}

type HelmReleaseList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []HelmRelease `json:"items"`
}

type HelmReleaseSpec struct {
	ReleaseName   string                 `json:"releaseName"`
	Namespace     string                 `json:"namespace"`
	Chart         string                 `json:"chart"`
	ChartName     string                 `json:"chartName"`
	ChartVersion  string                 `json:"chartVersion"`
	AppVersion    string                 `json:"appVersion,omitempty"`
	Icon          string                 `json:"icon,omitempty"`
	Revision      int                    `json:"revision"`
	Values        map[string]interface{} `json:"values,omitempty"`
	DefaultValues map[string]interface{} `json:"defaultValues,omitempty"`
	Manifest      string                 `json:"manifest,omitempty"`
	Notes         string                 `json:"notes,omitempty"`
	Description   string                 `json:"description,omitempty"`
	Hooks         []HelmHook             `json:"hooks,omitempty"`
}

type HelmReleaseStatus struct {
	Status        string                `json:"status"`
	FirstDeployed *time.Time            `json:"firstDeployed,omitempty"`
	LastDeployed  *time.Time            `json:"lastDeployed,omitempty"`
	Deleted       *time.Time            `json:"deleted,omitempty"`
	Resources     []HelmReleaseResource `json:"resources,omitempty"`
}

type HelmReleaseResource struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace,omitempty"`
}

type HelmReleaseDryRunResource struct {
	HelmReleaseResource
	Path            string `json:"path"`
	Content         string `json:"content"`
	OriginalContent string `json:"originalContent,omitempty"`
	ModifiedContent string `json:"modifiedContent,omitempty"`
	Status          string `json:"status,omitempty"`
}

type HelmReleaseDryRunResponse struct {
	Resources []HelmReleaseDryRunResource `json:"resources"`
}

type HelmReleaseHistoryItem struct {
	Revision      int                    `json:"revision"`
	Status        string                 `json:"status"`
	Chart         string                 `json:"chart"`
	ChartName     string                 `json:"chartName"`
	ChartVersion  string                 `json:"chartVersion"`
	AppVersion    string                 `json:"appVersion,omitempty"`
	Values        map[string]interface{} `json:"values,omitempty"`
	Description   string                 `json:"description,omitempty"`
	FirstDeployed *time.Time             `json:"firstDeployed,omitempty"`
	LastDeployed  *time.Time             `json:"lastDeployed,omitempty"`
	Deleted       *time.Time             `json:"deleted,omitempty"`
}

type HelmHook struct {
	Name     string                 `json:"name"`
	Kind     string                 `json:"kind"`
	Path     string                 `json:"path"`
	Manifest string                 `json:"manifest"`
	Events   []string               `json:"events"`
	LastRun  map[string]interface{} `json:"last_run,omitempty"`
	Weight   int                    `json:"weight,omitempty"`
}
