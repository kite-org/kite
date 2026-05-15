package helmutil

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	semver "github.com/blang/semver/v4"
	"github.com/zxh326/kite/pkg/model"
	"helm.sh/helm/v4/pkg/getter"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

const (
	ChartSourceRepository  = "repository"
	ChartSourceArtifactHub = "artifacthub"

	artifactHubHelmPackageAPIURL = "https://artifacthub.io/api/v1/packages/helm/"
)

type ChartPackage struct {
	Version    string
	URL        string
	Repository *model.HelmRepository
}

type artifactHubPackage struct {
	Version    string `json:"version"`
	ContentURL string `json:"content_url"`
}

func ResolveChartRepository(repositoryName, source string) (*model.HelmRepository, error) {
	if repositoryName == "" || source == ChartSourceArtifactHub {
		return nil, nil
	}
	var repository model.HelmRepository
	if err := model.DB.Where("name = ?", repositoryName).First(&repository).Error; err != nil {
		return nil, err
	}
	return &repository, nil
}

func LatestChartPackage(ctx context.Context, source, repositoryName, chartName string) (ChartPackage, error) {
	switch source {
	case "", ChartSourceRepository:
		return latestRepositoryChartPackage(repositoryName, chartName)
	case ChartSourceArtifactHub:
		return latestArtifactHubChartPackage(ctx, repositoryName, chartName)
	default:
		return ChartPackage{}, fmt.Errorf("unsupported chart source")
	}
}

func latestRepositoryChartPackage(repositoryName, chartName string) (ChartPackage, error) {
	var repository model.HelmRepository
	if err := model.DB.Where("name = ?", repositoryName).First(&repository).Error; err != nil {
		return ChartPackage{}, err
	}
	indexFile, err := LoadRepositoryIndex(repository)
	if err != nil {
		return ChartPackage{}, err
	}
	versions := indexFile.Entries[chartName]
	if len(versions) == 0 {
		return ChartPackage{}, fmt.Errorf("chart not found")
	}
	latest := versions[0]
	for _, version := range versions[1:] {
		if CompareChartVersions(version.Version, latest.Version) > 0 {
			latest = version
		}
	}
	if len(latest.URLs) == 0 {
		return ChartPackage{}, fmt.Errorf("chart package URL is missing")
	}
	return ChartPackage{
		Version:    latest.Version,
		URL:        ResolveURL(repository.URL, latest.URLs[0]),
		Repository: &repository,
	}, nil
}

func LoadRepositoryIndex(repository model.HelmRepository) (*repo.IndexFile, error) {
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

func latestArtifactHubChartPackage(ctx context.Context, repositoryName, chartName string) (ChartPackage, error) {
	packageURL := artifactHubHelmPackageAPIURL + url.PathEscape(repositoryName) + "/" + url.PathEscape(chartName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, packageURL, nil)
	if err != nil {
		return ChartPackage{}, err
	}
	req.Header.Set("User-Agent", "kite")

	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ChartPackage{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return ChartPackage{}, fmt.Errorf("artifact hub request failed: %s", resp.Status)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChartPackage{}, err
	}
	var pkg artifactHubPackage
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ChartPackage{}, err
	}
	if strings.TrimSpace(pkg.ContentURL) == "" {
		return ChartPackage{}, fmt.Errorf("chart package URL is missing")
	}
	return ChartPackage{
		Version: pkg.Version,
		URL:     pkg.ContentURL,
	}, nil
}

func IsChartVersionNewer(next, current string) bool {
	return CompareChartVersions(next, current) > 0
}

func CompareChartVersions(a, b string) int {
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
