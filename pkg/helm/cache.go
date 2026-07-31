package helm

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/registry"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

const (
	helmRepositoryIndexCacheTTL = 5 * time.Minute
	helmChartContentCacheTTL    = 10 * time.Minute
	artifactHubCacheTTL         = 5 * time.Minute
)

type cachedRepositoryIndex struct {
	indexFile *repo.IndexFile
	expiresAt time.Time
}

type cachedChartContent struct {
	content   helmChartContent
	expiresAt time.Time
}

type cachedArtifactHubResponse struct {
	data      []byte
	headers   http.Header
	expiresAt time.Time
}

var (
	artifactHubCacheMu sync.Mutex
	artifactHubCache   = map[string]cachedArtifactHubResponse{}
)

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

	var indexFile *repo.IndexFile
	var err error
	if registry.IsOCI(repository.URL) {
		indexFile, err = loadOCIRepositoryIndex(repository)
	} else {
		indexFile, err = helmutil.LoadRepositoryIndex(repository)
	}
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

// loadOCIRepositoryIndex synthesizes a repository index for an oci:// URL,
// which points at a single chart: registry tags are its versions. Metadata
// beyond name/version only exists inside the chart archive, so the newest
// version is pulled once to enrich the listing. That pull failing is fatal:
// it rejects URLs whose newest tag is not a loadable Helm chart (e.g. a
// container image), and a best-effort fallback would let the chart's identity
// flip between the Chart.yaml name and the URL path base across cache
// rebuilds, breaking detail routes and release matching.
func loadOCIRepositoryIndex(repository model.HelmRepository) (*repo.IndexFile, error) {
	chartName, err := helmutil.OCIChartName(repository.URL)
	if err != nil {
		return nil, err
	}
	tags, err := helmutil.ListOCIChartVersions(&repository, repository.URL)
	if err != nil {
		return nil, err
	}
	if len(tags) == 0 {
		return nil, fmt.Errorf("no semver chart versions found at %s (non-semver tags are ignored)", repository.URL)
	}

	latestChart, err := helmutil.LoadArchive(helmutil.OCIChartVersionURL(repository.URL, tags[0]), &repository)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart at %s: %w", repository.URL, err)
	}
	// Charts mirrored under a different registry path keep their Chart.yaml
	// name; adopt it so name matching against installed releases works.
	if latestChart.Metadata != nil && latestChart.Metadata.Name != "" {
		chartName = latestChart.Metadata.Name
	}

	entries := make(repo.ChartVersions, 0, len(tags))
	for _, tag := range tags {
		entries = append(entries, &repo.ChartVersion{
			Metadata: &chart.Metadata{Name: chartName, Version: tag},
			URLs:     []string{helmutil.OCIChartVersionURL(repository.URL, tag)},
		})
	}
	if latestChart.Metadata != nil {
		metadata := *latestChart.Metadata
		// The registry tag and adopted name stay authoritative so lookups
		// keep matching the synthesized entries.
		metadata.Name = chartName
		metadata.Version = entries[0].Version
		entries[0].Metadata = &metadata
	}

	return &repo.IndexFile{Entries: map[string]repo.ChartVersions{chartName: entries}}, nil
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
		Metadata:  loadedChart.Metadata,
	}

	h.contentCacheMu.Lock()
	h.contentCache[cacheKey] = cachedChartContent{
		content:   content,
		expiresAt: now.Add(helmChartContentCacheTTL),
	}
	h.contentCacheMu.Unlock()

	return content, nil
}

func repositoryIndexCacheKey(repository model.HelmRepository) string {
	return repository.URL
}

func chartContentCacheKey(repository model.HelmRepository, entry *repo.ChartVersion) string {
	return helmutil.ResolveURL(repository.URL, entry.URLs[0])
}

func (h *HelmChartHandler) clearRepositoryCache(repository model.HelmRepository) {
	cacheKey := repositoryIndexCacheKey(repository)
	helmutil.ClearRepositoryArchiveCache(repository)

	h.indexCacheMu.Lock()
	delete(h.indexCache, cacheKey)
	h.indexCacheMu.Unlock()

	h.contentCacheMu.Lock()
	for key := range h.contentCache {
		if helmutil.MatchesRepositoryCacheKey(cacheKey, key) {
			delete(h.contentCache, key)
		}
	}
	h.contentCacheMu.Unlock()
}
