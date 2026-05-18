package helm

import (
	"net/http"
	"sort"
	"strings"
	"time"

	semver "github.com/blang/semver/v4"
	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/chart/common"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	repo "helm.sh/helm/v4/pkg/repo/v1"
	"sigs.k8s.io/yaml"
)

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
			Version:     chartVersion.Version,
			AppVersion:  chartVersion.AppVersion,
			PublishedAt: chartUpdatedAt(indexFile.Generated, chartVersion),
		})
	}
	sortHelmChartVersions(versions)

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
	c.JSON(http.StatusOK, helmChartContentResponse{Templates: content.Templates})
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

func sortHelmChartVersions(versions []helmChartVersion) {
	sort.SliceStable(versions, func(i, j int) bool {
		if cmp := compareTimes(versions[i].PublishedAt, versions[j].PublishedAt); cmp != 0 {
			return cmp > 0
		}
		return compareChartVersions(versions[i].Version, versions[j].Version) > 0
	})
}

func compareTimes(a, b *time.Time) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if a.After(*b) {
		return 1
	}
	if a.Before(*b) {
		return -1
	}
	return 0
}

func compareChartVersions(a, b string) int {
	parsedA, errA := semver.ParseTolerant(a)
	parsedB, errB := semver.ParseTolerant(b)
	if errA == nil && errB == nil {
		return parsedA.Compare(parsedB)
	}
	if errA == nil {
		return 1
	}
	if errB == nil {
		return -1
	}
	return strings.Compare(a, b)
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

func chartTemplates(files []*common.File) []chartTemplate {
	templates := make([]chartTemplate, 0, len(files))
	for _, file := range files {
		if file == nil {
			continue
		}
		templates = append(templates, chartTemplate{
			Path:    chartTemplatePath(file.Name),
			Content: string(file.Data),
		})
	}
	return templates
}

func chartTemplatePath(name string) string {
	return strings.TrimPrefix(strings.TrimPrefix(name, "./"), "templates/")
}
