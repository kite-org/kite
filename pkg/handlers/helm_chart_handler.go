package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/chart/common"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/getter"
	repo "helm.sh/helm/v4/pkg/repo/v1"
	"sigs.k8s.io/yaml"
)

const (
	helmRepositoryIndexCacheTTL = 5 * time.Minute
	helmChartContentCacheTTL    = 10 * time.Minute
	artifactHubSearchURL        = "https://artifacthub.io/api/v1/packages/search"
	artifactHubPackageAPIURL    = "https://artifacthub.io/api/v1/packages/helm/"
	artifactHubValuesAPIURL     = "https://artifacthub.io/api/v1/packages/"
	artifactHubImageURL         = "https://artifacthub.io/image/"
	artifactHubPackageURL       = "https://artifacthub.io/packages/helm/"
)

type HelmChartHandler struct {
	indexCacheMu   sync.Mutex
	indexCache     map[string]cachedRepositoryIndex
	contentCacheMu sync.Mutex
	contentCache   map[string]cachedChartContent
}

type cachedRepositoryIndex struct {
	indexFile *repo.IndexFile
	expiresAt time.Time
}

type cachedChartContent struct {
	content   helmChartContent
	expiresAt time.Time
}

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
	Version    string     `json:"version"`
	AppVersion string     `json:"appVersion,omitempty"`
	UpdatedAt  *time.Time `json:"updatedAt,omitempty"`
}

type helmChartDetail struct {
	helmChart
	Readme   string             `json:"readme,omitempty"`
	Versions []helmChartVersion `json:"versions"`
}

type helmChartContentResponse struct {
	Content string `json:"content"`
}

type helmChartContent struct {
	Readme    string
	Values    string
	Templates string
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

func NewHelmChartHandler() *HelmChartHandler {
	return &HelmChartHandler{
		indexCache:   map[string]cachedRepositoryIndex{},
		contentCache: map[string]cachedChartContent{},
	}
}

func (h *HelmChartHandler) RegisterRoutes(group *gin.RouterGroup) {
	g := group.Group("/charts")
	g.GET("/repositories", h.ListRepositories)
	g.GET("/artifacthub", h.ListArtifactHubCharts)
	g.GET("", h.ListCharts)
	g.GET("/artifacthub/:repository/:name/content/:content", h.GetArtifactHubChartContent)
	g.GET("/artifacthub/:repository/:name", h.GetArtifactHubChart)
	g.GET("/:repository/:name/content/:content", h.GetChartContent)
	g.GET("/:repository/:name", h.GetChart)
}

func (h *HelmChartHandler) RegisterAdminRoutes(group *gin.RouterGroup) {
	g := group.Group("/charts")
	g.POST("/repositories", h.CreateRepository)
	g.DELETE("/repositories/:id", h.DeleteRepository)
}

func (h *HelmChartHandler) ListRepositories(c *gin.Context) {
	var repositories []model.HelmRepository
	if err := model.DB.Order("name").Find(&repositories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]helmRepositoryResponse, 0, len(repositories))
	for _, repository := range repositories {
		items = append(items, toHelmRepositoryResponse(repository))
	}
	c.JSON(http.StatusOK, items)
}

func (h *HelmChartHandler) CreateRepository(c *gin.Context) {
	var req createHelmRepositoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	repository := model.HelmRepository{
		Name:     strings.TrimSpace(req.Name),
		URL:      strings.TrimSpace(req.URL),
		Username: strings.TrimSpace(req.Username),
		Password: model.SecretString(req.Password),
	}

	if repository.Name == "" || repository.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository name and URL are required"})
		return
	}
	if strings.Contains(repository.Name, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository name cannot contain /"})
		return
	}
	if (repository.Username == "") != (repository.Password == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository username and password must be provided together"})
		return
	}

	repositoryURL, err := url.Parse(repository.URL)
	if err != nil || repositoryURL.Scheme == "" || repositoryURL.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository URL must be absolute"})
		return
	}
	scheme := strings.ToLower(repositoryURL.Scheme)
	if scheme != "http" && scheme != "https" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository URL must use http or https"})
		return
	}

	var count int64
	if err := model.DB.Model(&model.HelmRepository{}).Where("name = ?", repository.Name).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "repository name already exists"})
		return
	}

	if _, err := h.loadRepositoryIndex(repository); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := model.DB.Create(&repository).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toHelmRepositoryResponse(repository))
}

func (h *HelmChartHandler) DeleteRepository(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var repository model.HelmRepository
	if err := model.DB.First(&repository, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repository not found"})
		return
	}

	if err := model.DB.Delete(&repository).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.clearRepositoryCache(repository)

	c.JSON(http.StatusOK, gin.H{"message": "repository deleted"})
}

func (h *HelmChartHandler) ListCharts(c *gin.Context) {
	repositoryName := c.Query("repository")
	query := strings.ToLower(strings.TrimSpace(c.Query("q")))

	var repositories []model.HelmRepository
	db := model.DB.Order("name")
	if repositoryName != "" {
		db = db.Where("name = ?", repositoryName)
	}
	if err := db.Find(&repositories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := []helmChart{}
	for _, repository := range repositories {
		indexFile, err := h.loadRepositoryIndex(repository)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, versions := range indexFile.Entries {
			if len(versions) == 0 {
				continue
			}
			entry := versions[0]
			item := toHelmChart(repository, indexFile.Generated, entry)
			if query != "" && !helmChartMatchesQuery(item, query) {
				continue
			}
			items = append(items, item)
		}
	}

	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

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

	content := string(contentData)
	if contentName == "templates" {
		content, err = artifactHubTemplates(contentData)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, helmChartContentResponse{Content: content})
}

func (h *HelmChartHandler) GetChart(c *gin.Context) {
	repositoryName := c.Param("repository")
	chartName := c.Param("name")
	version := c.Query("version")

	var repository model.HelmRepository
	if err := model.DB.Where("name = ?", repositoryName).First(&repository).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repository not found"})
		return
	}

	indexFile, err := h.loadRepositoryIndex(repository)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	entry, err := indexFile.Get(chartName, version)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	content, err := h.loadChartContent(repository, entry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	versions := []helmChartVersion{}
	for _, chartVersion := range indexFile.Entries[chartName] {
		versions = append(versions, helmChartVersion{
			Version:    chartVersion.Version,
			AppVersion: chartVersion.AppVersion,
			UpdatedAt:  chartUpdatedAt(indexFile.Generated, chartVersion),
		})
	}

	c.JSON(http.StatusOK, helmChartDetail{
		helmChart: toHelmChart(repository, indexFile.Generated, entry),
		Readme:    content.Readme,
		Versions:  versions,
	})
}

func (h *HelmChartHandler) GetChartContent(c *gin.Context) {
	repositoryName := c.Param("repository")
	chartName := c.Param("name")
	contentName := c.Param("content")
	version := c.Query("version")

	if contentName != "values" && contentName != "templates" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported chart content"})
		return
	}

	var repository model.HelmRepository
	if err := model.DB.Where("name = ?", repositoryName).First(&repository).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repository not found"})
		return
	}

	indexFile, err := h.loadRepositoryIndex(repository)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	entry, err := indexFile.Get(chartName, version)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	content, err := h.loadChartContent(repository, entry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if contentName == "values" {
		c.JSON(http.StatusOK, helmChartContentResponse{Content: content.Values})
		return
	}
	c.JSON(http.StatusOK, helmChartContentResponse{Content: content.Templates})
}

func (h *HelmChartHandler) loadRepositoryIndex(repository model.HelmRepository) (*repo.IndexFile, error) {
	cacheKey := repositoryIndexCacheKey(repository)
	now := time.Now()

	h.indexCacheMu.Lock()
	cached, ok := h.indexCache[cacheKey]
	if ok && now.Before(cached.expiresAt) {
		h.indexCacheMu.Unlock()
		return cached.indexFile, nil
	}
	h.indexCacheMu.Unlock()

	entry := &repo.Entry{
		Name:     repository.Name,
		URL:      repository.URL,
		Username: repository.Username,
		Password: string(repository.Password),
	}
	chartRepository, err := repo.NewChartRepository(entry, getter.Getters())
	if err != nil {
		return nil, err
	}
	cacheDir, err := os.MkdirTemp("", "kite-helm-repo-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(cacheDir) }()
	chartRepository.CachePath = cacheDir

	indexPath, err := chartRepository.DownloadIndexFile()
	if err != nil {
		return nil, err
	}
	indexFile, err := repo.LoadIndexFile(indexPath)
	if err != nil {
		return nil, err
	}

	h.indexCacheMu.Lock()
	h.indexCache[cacheKey] = cachedRepositoryIndex{
		indexFile: indexFile,
		expiresAt: now.Add(helmRepositoryIndexCacheTTL),
	}
	h.indexCacheMu.Unlock()

	return indexFile, nil
}

func (h *HelmChartHandler) loadChartContent(repository model.HelmRepository, entry *repo.ChartVersion) (helmChartContent, error) {
	if len(entry.URLs) == 0 {
		return helmChartContent{}, nil
	}
	cacheKey := chartContentCacheKey(repository, entry)
	now := time.Now()

	h.contentCacheMu.Lock()
	cached, ok := h.contentCache[cacheKey]
	if ok && now.Before(cached.expiresAt) {
		h.contentCacheMu.Unlock()
		return cached.content, nil
	}
	h.contentCacheMu.Unlock()

	loadedChart, err := helmutil.LoadRepositoryArchive(repository, entry)
	if err != nil {
		return helmChartContent{}, err
	}
	values, err := chartValues(loadedChart)
	if err != nil {
		return helmChartContent{}, err
	}
	content := helmChartContent{
		Readme:    findReadme(loadedChart.Files),
		Values:    values,
		Templates: chartTemplates(loadedChart.Templates),
	}

	h.contentCacheMu.Lock()
	h.contentCache[cacheKey] = cachedChartContent{
		content:   content,
		expiresAt: now.Add(helmChartContentCacheTTL),
	}
	h.contentCacheMu.Unlock()

	return content, nil
}

func toHelmRepositoryResponse(repository model.HelmRepository) helmRepositoryResponse {
	return helmRepositoryResponse{
		ID:        repository.ID,
		Name:      repository.Name,
		URL:       repository.URL,
		Username:  repository.Username,
		HasAuth:   repository.Username != "",
		CreatedAt: repository.CreatedAt,
		UpdatedAt: repository.UpdatedAt,
	}
}

func toHelmChart(repository model.HelmRepository, generated time.Time, entry *repo.ChartVersion) helmChart {
	chartURL := ""
	if len(entry.URLs) > 0 {
		chartURL = helmutil.ResolveURL(repository.URL, entry.URLs[0])
	}

	return helmChart{
		RepositoryID:   repository.ID,
		RepositoryName: repository.Name,
		RepositoryURL:  repository.URL,
		Source:         "repository",
		Name:           entry.Name,
		Version:        entry.Version,
		AppVersion:     entry.AppVersion,
		KubeVersion:    entry.KubeVersion,
		Description:    entry.Description,
		Icon:           helmutil.ResolveURL(repository.URL, entry.Icon),
		Home:           entry.Home,
		Sources:        entry.Sources,
		ChartURL:       chartURL,
		Keywords:       entry.Keywords,
		Maintainers:    entry.Maintainers,
		Deprecated:     entry.Deprecated,
		UpdatedAt:      chartUpdatedAt(generated, entry),
	}
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
			Version:    version.Version,
			AppVersion: version.AppVersion,
			UpdatedAt:  artifactHubUpdatedAt(version.TS),
		})
	}

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
	return data, resp.Header, nil
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

func artifactHubTemplates(data []byte) (string, error) {
	var result artifactHubTemplatesResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}

	var builder strings.Builder
	for _, file := range result.Templates {
		content, err := base64.StdEncoding.DecodeString(file.Data)
		if err != nil {
			return "", err
		}
		if builder.Len() > 0 {
			builder.WriteString("\n---\n")
		}
		builder.WriteString("# Source: ")
		builder.WriteString(file.Name)
		builder.WriteByte('\n')
		builder.Write(content)
	}
	return builder.String(), nil
}

func chartUpdatedAt(generated time.Time, entry *repo.ChartVersion) *time.Time {
	if !entry.Created.IsZero() {
		v := entry.Created
		return &v
	}
	if !generated.IsZero() {
		v := generated
		return &v
	}
	return nil
}

func helmChartMatchesQuery(chart helmChart, query string) bool {
	values := []string{chart.Name, chart.RepositoryName, chart.Version, chart.Description, chart.AppVersion}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	for _, keyword := range chart.Keywords {
		if strings.Contains(strings.ToLower(keyword), query) {
			return true
		}
	}
	return false
}

func repositoryIndexCacheKey(repository model.HelmRepository) string {
	return strings.Join([]string{
		repository.Name,
		repository.URL,
		repository.Username,
	}, "\x00")
}

func chartContentCacheKey(repository model.HelmRepository, entry *repo.ChartVersion) string {
	return strings.Join([]string{
		repositoryIndexCacheKey(repository),
		entry.Name,
		entry.Version,
		strings.Join(entry.URLs, "\x00"),
	}, "\x00")
}

func (h *HelmChartHandler) clearRepositoryCache(repository model.HelmRepository) {
	cacheKey := repositoryIndexCacheKey(repository)

	h.indexCacheMu.Lock()
	delete(h.indexCache, cacheKey)
	h.indexCacheMu.Unlock()

	h.contentCacheMu.Lock()
	for key := range h.contentCache {
		if key == cacheKey || strings.HasPrefix(key, cacheKey+"\x00") {
			delete(h.contentCache, key)
		}
	}
	h.contentCacheMu.Unlock()
}

func findReadme(files []*common.File) string {
	for _, file := range files {
		if file == nil {
			continue
		}
		name := strings.ToLower(file.Name)
		if name == "readme.md" || name == "readme.txt" || name == "readme" {
			return string(file.Data)
		}
	}
	return ""
}

func chartValues(loadedChart *chart.Chart) (string, error) {
	for _, file := range loadedChart.Raw {
		if file == nil {
			continue
		}
		name := strings.ToLower(file.Name)
		if name == "values.yaml" || name == "values.yml" {
			return string(file.Data), nil
		}
	}
	if len(loadedChart.Values) == 0 {
		return "", nil
	}
	values, err := yaml.Marshal(loadedChart.Values)
	if err != nil {
		return "", err
	}
	return string(values), nil
}

func chartTemplates(files []*common.File) string {
	var builder strings.Builder
	for _, file := range files {
		if file == nil {
			continue
		}
		if builder.Len() > 0 {
			builder.WriteString("\n---\n")
		}
		builder.WriteString("# Source: ")
		builder.WriteString(file.Name)
		builder.WriteByte('\n')
		builder.Write(file.Data)
	}
	return builder.String()
}
