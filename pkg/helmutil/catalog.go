package helmutil

import (
	"fmt"
	"os"
	"strings"

	"github.com/zxh326/kite/pkg/model"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/getter"
	"helm.sh/helm/v4/pkg/registry"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

// LoadRepositoryCatalog normalizes classic and OCI repositories as an index.
func LoadRepositoryCatalog(repository model.HelmRepository) (*repo.IndexFile, error) {
	if registry.IsOCI(repository.URL) {
		return loadOCIRepositoryIndex(repository)
	}
	return loadClassicRepositoryIndex(repository)
}

func loadClassicRepositoryIndex(repository model.HelmRepository) (*repo.IndexFile, error) {
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
	return repo.LoadIndexFile(indexPath)
}

func loadOCIRepositoryIndex(repository model.HelmRepository) (*repo.IndexFile, error) {
	chartName, err := OCIChartName(repository.URL)
	if err != nil {
		return nil, err
	}
	tags, err := listOCIChartVersions(&repository, repository.URL)
	if err != nil {
		return nil, err
	}
	if len(tags) == 0 {
		return nil, fmt.Errorf("no semver chart versions found at %s (non-semver tags are ignored)", repository.URL)
	}

	latestChart, err := LoadArchive(ociChartVersionURL(repository.URL, tags[0]), &repository)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart at %s: %w", repository.URL, err)
	}
	if latestChart.Metadata != nil && latestChart.Metadata.Name != "" {
		chartName = latestChart.Metadata.Name
	}

	entries := make(repo.ChartVersions, 0, len(tags))
	for _, tag := range tags {
		entries = append(entries, &repo.ChartVersion{
			Metadata: &chart.Metadata{Name: chartName, Version: tag},
			URLs:     []string{ociChartVersionURL(repository.URL, tag)},
		})
	}
	if latestChart.Metadata != nil {
		metadata := *latestChart.Metadata
		metadata.Name = chartName
		metadata.Version = entries[0].Version
		entries[0].Metadata = &metadata
	}

	return &repo.IndexFile{Entries: map[string]repo.ChartVersions{chartName: entries}}, nil
}

func listOCIChartVersions(repository *model.HelmRepository, chartURL string) ([]string, error) {
	registryClient, err := newRegistryClient(repository, chartURL)
	if err != nil {
		return nil, err
	}
	return registryClient.Tags(ociReference(chartURL))
}

func ociChartVersionURL(repositoryURL, tag string) string {
	return strings.TrimRight(repositoryURL, "/") + ":" + tag
}
