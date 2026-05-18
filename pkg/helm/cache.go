package helm

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/helmutil"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/getter"
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
	cacheKeyPrefix := strings.TrimRight(cacheKey, "/") + "/"
	for key := range h.contentCache {
		if key == cacheKey || strings.HasPrefix(key, cacheKeyPrefix) {
			delete(h.contentCache, key)
		}
	}
	h.contentCacheMu.Unlock()
}
