package helmutil

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/model"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/chart/v2/loader"
	"helm.sh/helm/v4/pkg/getter"
	"helm.sh/helm/v4/pkg/registry"
	repo "helm.sh/helm/v4/pkg/repo/v1"
	"oras.land/oras-go/v2/registry/remote/auth"
)

const archiveCacheTTL = 10 * time.Minute

var (
	archiveCacheMu sync.Mutex
	archiveCache   = map[string]cachedArchive{}
)

type cachedArchive struct {
	data      []byte
	expiresAt time.Time
}

func LoadRepositoryArchive(repository model.HelmRepository, entry *repo.ChartVersion) (*chart.Chart, error) {
	if len(entry.URLs) == 0 {
		return nil, nil
	}
	chartURL, err := repo.ResolveReferenceURL(repository.URL, entry.URLs[0])
	if err != nil {
		return nil, err
	}
	return LoadArchive(chartURL, &repository)
}

func LoadArchive(chartURL string, repository *model.HelmRepository) (*chart.Chart, error) {
	chartURL = strings.TrimSpace(chartURL)
	parsedURL, err := url.Parse(chartURL)
	if err != nil || parsedURL.Scheme == "" {
		return nil, fmt.Errorf("chartUrl must be an absolute URL")
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" && parsedURL.Scheme != registry.OCIScheme {
		return nil, fmt.Errorf("unsupported chartUrl scheme")
	}

	var registryClient *registry.Client
	if parsedURL.Scheme == registry.OCIScheme && !OCIRefHasTagOrDigest(parsedURL) {
		// Cache the resolved version instead of a mutable tag-less reference.
		registryClient, err = newRegistryClient(repository, chartURL)
		if err != nil {
			return nil, err
		}
		tags, err := registryClient.Tags(ociReference(chartURL))
		if err != nil {
			return nil, err
		}
		tag, err := registry.GetTagMatchingVersionOrConstraint(tags, "")
		if err != nil {
			return nil, err
		}
		chartURL = chartURL + ":" + tag
	}

	cacheKey := archiveCacheKey(chartURL)
	now := time.Now()
	archiveCacheMu.Lock()
	cached, ok := archiveCache[cacheKey]
	if ok && now.Before(cached.expiresAt) {
		data := append([]byte(nil), cached.data...)
		archiveCacheMu.Unlock()
		return loader.LoadArchive(bytes.NewReader(data))
	}
	archiveCacheMu.Unlock()

	client, err := getter.Getters().ByScheme(parsedURL.Scheme)
	if err != nil {
		return nil, err
	}

	options := []getter.Option{
		getter.WithAcceptHeader("application/gzip,application/octet-stream"),
	}
	useRepositoryCredentials := repositoryCredentialsApply(repository, chartURL)
	if useRepositoryCredentials {
		options = append(options, getter.WithBasicAuth(repository.Username, string(repository.Password)))
	}
	if parsedURL.Scheme == registry.OCIScheme {
		if registryClient == nil {
			registryClient, err = newRegistryClient(repository, chartURL)
			if err != nil {
				return nil, err
			}
		}
		options = append(options, getter.WithRegistryClient(registryClient))
	}

	baseURL := chartURL
	if repository != nil {
		baseURL = repository.URL
	}
	options = append(options, getter.WithURL(baseURL))

	data, err := client.Get(chartURL, options...)
	if err != nil {
		return nil, err
	}
	archiveData := data.Bytes()
	loadedChart, err := loader.LoadArchive(bytes.NewReader(archiveData))
	if err != nil {
		return nil, err
	}

	archiveCacheMu.Lock()
	archiveCache[cacheKey] = cachedArchive{
		data:      append([]byte(nil), archiveData...),
		expiresAt: time.Now().Add(archiveCacheTTL),
	}
	archiveCacheMu.Unlock()

	return loadedChart, nil
}

var (
	registryHTTPClient = &http.Client{
		Transport: registry.NewTransport(false),
		Timeout:   time.Duration(getter.DefaultHTTPTimeout) * time.Second,
	}
	anonymousAuthorizer = newAnonymousAuthorizer()
)

func newAnonymousAuthorizer() auth.Client {
	authorizer := auth.Client{
		Client: registryHTTPClient,
		Cache:  auth.NewCache(),
	}
	authorizer.SetUserAgent("kite")
	return authorizer
}

func newRegistryClient(repository *model.HelmRepository, targetURL string) (*registry.Client, error) {
	options := []registry.ClientOption{registry.ClientOptHTTPClient(registryHTTPClient)}
	if repositoryCredentialsApply(repository, targetURL) {
		options = append(options, registry.ClientOptBasicAuth(repository.Username, string(repository.Password)))
	} else {
		options = append(options, registry.ClientOptAuthorizer(anonymousAuthorizer))
	}
	return registry.NewClient(options...)
}

func repositoryCredentialsApply(repository *model.HelmRepository, targetURL string) bool {
	return repository != nil && repository.Username != "" && sameURLHost(repository.URL, targetURL)
}

// OCIChartName returns the last path segment of an OCI repository URL.
func OCIChartName(repositoryURL string) (string, error) {
	parsedURL, err := url.Parse(repositoryURL)
	if err != nil {
		return "", err
	}
	name := path.Base(strings.Trim(parsedURL.Path, "/"))
	if name == "" || name == "." {
		return "", fmt.Errorf("oci repository URL must include a chart path, e.g. oci://registry.example.com/charts/app")
	}
	return name, nil
}

func OCIRefHasTagOrDigest(parsedURL *url.URL) bool {
	return strings.Contains(path.Base(parsedURL.Path), ":") || strings.Contains(parsedURL.Path, "@")
}

func ociReference(chartURL string) string {
	return strings.TrimPrefix(chartURL, registry.OCIScheme+"://")
}

func ResolveURL(baseURL, refURL string) string {
	if refURL == "" {
		return ""
	}
	resolved, err := repo.ResolveReferenceURL(baseURL, refURL)
	if err != nil {
		return refURL
	}
	return resolved
}

func sameURLHost(baseURL, targetURL string) bool {
	base, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	target, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(base.Hostname(), target.Hostname())
}

func archiveCacheKey(chartURL string) string {
	return chartURL
}

// MatchesRepositoryCacheKey matches paths and OCI tag references under a repository URL.
func MatchesRepositoryCacheKey(repositoryURL, key string) bool {
	if key == repositoryURL {
		return true
	}
	trimmed := strings.TrimRight(repositoryURL, "/")
	if strings.HasPrefix(key, trimmed+"/") {
		return true
	}
	return registry.IsOCI(repositoryURL) && strings.HasPrefix(key, trimmed+":")
}

func ClearRepositoryArchiveCache(repository model.HelmRepository) {
	archiveCacheMu.Lock()
	for key := range archiveCache {
		if MatchesRepositoryCacheKey(repository.URL, key) {
			delete(archiveCache, key)
		}
	}
	archiveCacheMu.Unlock()
}
