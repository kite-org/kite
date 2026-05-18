package helm

import (
	"encoding/json"
	"time"

	chart "helm.sh/helm/v4/pkg/chart/v2"
)

type createHelmRepositoryRequest struct {
	Name     string `json:"name" binding:"required"`
	URL      string `json:"url" binding:"required"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type helmRepositoryResponse struct {
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Username  string    `json:"username,omitempty"`
	HasAuth   bool      `json:"hasAuth"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type helmChart struct {
	RepositoryID   uint                `json:"repositoryId"`
	RepositoryName string              `json:"repositoryName"`
	RepositoryURL  string              `json:"repositoryUrl"`
	Source         string              `json:"source,omitempty"`
	Name           string              `json:"name"`
	Version        string              `json:"version"`
	AppVersion     string              `json:"appVersion,omitempty"`
	KubeVersion    string              `json:"kubeVersion,omitempty"`
	Description    string              `json:"description,omitempty"`
	Icon           string              `json:"icon,omitempty"`
	Home           string              `json:"home,omitempty"`
	ArtifactHubURL string              `json:"artifactHubUrl,omitempty"`
	ChartURL       string              `json:"chartUrl,omitempty"`
	Sources        []string            `json:"sources,omitempty"`
	Keywords       []string            `json:"keywords,omitempty"`
	Maintainers    []*chart.Maintainer `json:"maintainers,omitempty"`
	Deprecated     bool                `json:"deprecated,omitempty"`
	UpdatedAt      *time.Time          `json:"updatedAt,omitempty"`
}

type helmChartVersion struct {
	Version     string     `json:"version"`
	AppVersion  string     `json:"appVersion,omitempty"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

type helmChartDetail struct {
	helmChart
	Readme   string             `json:"readme,omitempty"`
	Versions []helmChartVersion `json:"versions"`
}

type helmChartContentResponse struct {
	Content   string          `json:"content,omitempty"`
	Templates []chartTemplate `json:"templates,omitempty"`
}

type chartTemplate struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type helmChartContent struct {
	Readme    string
	Values    string
	Templates []chartTemplate
}

type artifactHubSearchResponse struct {
	Packages []artifactHubPackage `json:"packages"`
}

type artifactHubPackage struct {
	Name        string                `json:"name"`
	Version     string                `json:"version"`
	AppVersion  string                `json:"app_version"`
	Description string                `json:"description"`
	LogoImageID string                `json:"logo_image_id"`
	Deprecated  bool                  `json:"deprecated"`
	TS          int64                 `json:"ts"`
	Repository  artifactHubRepository `json:"repository"`
}

type artifactHubPackageDetail struct {
	PackageID         string                `json:"package_id"`
	Name              string                `json:"name"`
	Version           string                `json:"version"`
	AppVersion        string                `json:"app_version"`
	Description       string                `json:"description"`
	LogoImageID       string                `json:"logo_image_id"`
	Deprecated        bool                  `json:"deprecated"`
	TS                int64                 `json:"ts"`
	HomeURL           string                `json:"home_url"`
	ContentURL        string                `json:"content_url"`
	Readme            string                `json:"readme"`
	Data              json.RawMessage       `json:"data"`
	Keywords          []string              `json:"keywords"`
	Maintainers       []*chart.Maintainer   `json:"maintainers"`
	AvailableVersions []artifactHubVersion  `json:"available_versions"`
	Repository        artifactHubRepository `json:"repository"`
}

type artifactHubData struct {
	KubeVersion string `json:"kubeVersion"`
}

type artifactHubVersion struct {
	Version    string `json:"version"`
	AppVersion string `json:"app_version"`
	TS         int64  `json:"ts"`
}

type artifactHubTemplatesResponse struct {
	Templates []artifactHubTemplate `json:"templates"`
}

type artifactHubTemplate struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type artifactHubRepository struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Kind int    `json:"kind"`
}
