package helm

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	artifactHubSearchURL     = "https://artifacthub.io/api/v1/packages/search"
	artifactHubPackageAPIURL = "https://artifacthub.io/api/v1/packages/helm/"
	artifactHubValuesAPIURL  = "https://artifacthub.io/api/v1/packages/"
	artifactHubImageURL      = "https://artifacthub.io/image/"
	artifactHubPackageURL    = "https://artifacthub.io/packages/helm/"
)

func (h *HelmChartHandler) ListArtifactHubCharts(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset, err := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offset < 0 {
		offset = 0
	}

	searchURL, err := url.Parse(artifactHubSearchURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	params := searchURL.Query()
	params.Set("kind", "0")
	params.Set("facets", "false")
	params.Set("limit", strconv.Itoa(limit))
	params.Set("offset", strconv.Itoa(offset))
	params.Set("deprecated", "false")
	if c.DefaultQuery("verifiedPublisher", "true") == "true" {
		params.Set("verified_publisher", "true")
	}
	if query != "" {
		params.Set("ts_query_web", query)
		params.Set("sort", "relevance")
	} else {
		params.Set("sort", "stars")
	}
	searchURL.RawQuery = params.Encode()

	data, headers, err := fetchArtifactHubWithHeaders(c, searchURL.String())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	var result artifactHubSearchResponse
	if err := json.Unmarshal(data, &result); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	items := make([]helmChart, 0, len(result.Packages))
	for _, pkg := range result.Packages {
		if pkg.Repository.Kind != 0 {
			continue
		}
		items = append(items, toArtifactHubChart(pkg))
	}

	total := len(items)
	if headerTotal, err := strconv.Atoi(headers.Get("Pagination-Total-Count")); err == nil {
		total = headerTotal
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "total": total})
}

func (h *HelmChartHandler) GetArtifactHubChart(c *gin.Context) {
	repositoryName := c.Param("repository")
	chartName := c.Param("name")
	version := c.Query("version")

	pkg, err := fetchArtifactHubChartDetail(c, repositoryName, chartName, version)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toArtifactHubChartDetail(pkg))
}

func (h *HelmChartHandler) GetArtifactHubChartContent(c *gin.Context) {
	repositoryName := c.Param("repository")
	chartName := c.Param("name")
	contentName := c.Param("content")
	version := c.Query("version")

	if contentName != "values" && contentName != "templates" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported chart content"})
		return
	}

	pkg, err := fetchArtifactHubChartDetail(c, repositoryName, chartName, version)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	if pkg.PackageID == "" || pkg.Version == "" {
		c.JSON(http.StatusOK, helmChartContentResponse{})
		return
	}

	contentURL := artifactHubValuesAPIURL + url.PathEscape(pkg.PackageID) + "/" + url.PathEscape(pkg.Version) + "/" + contentName
	contentData, err := fetchArtifactHub(c, contentURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	if contentName == "templates" {
		templates, err := artifactHubTemplates(contentData)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, helmChartContentResponse{Templates: templates})
		return
	}

	c.JSON(http.StatusOK, helmChartContentResponse{Content: string(contentData)})
}

func toArtifactHubChart(pkg artifactHubPackage) helmChart {
	return helmChart{
		RepositoryName: pkg.Repository.Name,
		RepositoryURL:  pkg.Repository.URL,
		Source:         "artifacthub",
		Name:           pkg.Name,
		Version:        pkg.Version,
		AppVersion:     pkg.AppVersion,
		Description:    pkg.Description,
		Icon:           artifactHubIcon(pkg.LogoImageID),
		ArtifactHubURL: artifactHubPackageURL + url.PathEscape(pkg.Repository.Name) + "/" + url.PathEscape(pkg.Name),
		Deprecated:     pkg.Deprecated,
		UpdatedAt:      artifactHubUpdatedAt(pkg.TS),
	}
}

func toArtifactHubChartDetail(pkg artifactHubPackageDetail) helmChartDetail {
	versions := make([]helmChartVersion, 0, len(pkg.AvailableVersions))
	for _, version := range pkg.AvailableVersions {
		versions = append(versions, helmChartVersion{
			Version:     version.Version,
			AppVersion:  version.AppVersion,
			PublishedAt: artifactHubUpdatedAt(version.TS),
		})
	}
	sortHelmChartVersions(versions)

	return helmChartDetail{
		helmChart: helmChart{
			RepositoryName: pkg.Repository.Name,
			RepositoryURL:  pkg.Repository.URL,
			Source:         "artifacthub",
			Name:           pkg.Name,
			Version:        pkg.Version,
			AppVersion:     pkg.AppVersion,
			KubeVersion:    artifactHubKubeVersion(pkg.Data),
			Description:    pkg.Description,
			Icon:           artifactHubIcon(pkg.LogoImageID),
			Home:           pkg.HomeURL,
			ArtifactHubURL: artifactHubPackageURL + url.PathEscape(pkg.Repository.Name) + "/" + url.PathEscape(pkg.Name),
			ChartURL:       pkg.ContentURL,
			Keywords:       pkg.Keywords,
			Maintainers:    pkg.Maintainers,
			Deprecated:     pkg.Deprecated,
			UpdatedAt:      artifactHubUpdatedAt(pkg.TS),
		},
		Readme:   pkg.Readme,
		Versions: versions,
	}
}

func artifactHubIcon(logoImageID string) string {
	if logoImageID == "" {
		return ""
	}
	return artifactHubImageURL + logoImageID
}

func artifactHubUpdatedAt(ts int64) *time.Time {
	if ts <= 0 {
		return nil
	}
	v := time.Unix(ts, 0)
	return &v
}

func fetchArtifactHubChartDetail(c *gin.Context, repositoryName, chartName, version string) (artifactHubPackageDetail, error) {
	packageURL := artifactHubPackageAPIURL + url.PathEscape(repositoryName) + "/" + url.PathEscape(chartName)
	if version != "" {
		packageURL += "/" + url.PathEscape(version)
	}
	data, err := fetchArtifactHub(c, packageURL)
	if err != nil {
		return artifactHubPackageDetail{}, err
	}

	var pkg artifactHubPackageDetail
	if err := json.Unmarshal(data, &pkg); err != nil {
		return artifactHubPackageDetail{}, err
	}
	return pkg, nil
}

func fetchArtifactHub(c *gin.Context, targetURL string) ([]byte, error) {
	data, _, err := fetchArtifactHubWithHeaders(c, targetURL)
	return data, err
}

func fetchArtifactHubWithHeaders(c *gin.Context, targetURL string) ([]byte, http.Header, error) {
	now := time.Now()
	artifactHubCacheMu.Lock()
	cached, ok := artifactHubCache[targetURL]
	if ok && now.Before(cached.expiresAt) {
		data := append([]byte(nil), cached.data...)
		headers := cached.headers.Clone()
		artifactHubCacheMu.Unlock()
		return data, headers, nil
	}
	if ok {
		delete(artifactHubCache, targetURL)
	}
	artifactHubCacheMu.Unlock()

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "kite")

	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("artifact hub request failed: %s", resp.Status)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	headers := resp.Header.Clone()

	artifactHubCacheMu.Lock()
	artifactHubCache[targetURL] = cachedArtifactHubResponse{
		data:      append([]byte(nil), data...),
		headers:   headers.Clone(),
		expiresAt: time.Now().Add(artifactHubCacheTTL),
	}
	artifactHubCacheMu.Unlock()

	return data, headers, nil
}

func artifactHubKubeVersion(data json.RawMessage) string {
	raw := strings.TrimSpace(string(data))
	if raw == "" || raw == `""` || raw == "null" {
		return ""
	}
	var parsed artifactHubData
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	return parsed.KubeVersion
}

func artifactHubTemplates(data []byte) ([]chartTemplate, error) {
	var result artifactHubTemplatesResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}

	templates := make([]chartTemplate, 0, len(result.Templates))
	for _, file := range result.Templates {
		content, err := base64.StdEncoding.DecodeString(file.Data)
		if err != nil {
			return nil, err
		}
		templates = append(templates, chartTemplate{
			Path:    chartTemplatePath(file.Name),
			Content: string(content),
		})
	}
	return templates, nil
}
