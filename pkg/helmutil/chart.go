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
		// Resolve the tag before the cache lookup so a tag-less URL never
		// pins a stale "latest" for the TTL.
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

// anonymousAuthorizer is shared by all credential-less registry clients: an
// explicit anonymous authorizer keeps them anonymous — without it the SDK
// falls back to the host's Helm/Docker credential stores, which leaks ambient
// credentials and may invoke an interactive keychain helper. Sharing one
// authorizer reuses its connections and cached auth tokens across calls.
var anonymousAuthorizer = newAnonymousAuthorizer()

func newAnonymousAuthorizer() auth.Client {
	authorizer := auth.Client{
		Client: &http.Client{Transport: registry.NewTransport(false)},
		Cache:  auth.NewCache(),
	}
	authorizer.SetUserAgent("kite")
	return authorizer
}

// newRegistryClient builds an OCI registry client, attaching the repository's
// basic-auth credentials only when they belong to the target reference host.
func newRegistryClient(repository *model.HelmRepository, targetURL string) (*registry.Client, error) {
	if repositoryCredentialsApply(repository, targetURL) {
		return registry.NewClient(registry.ClientOptBasicAuth(repository.Username, string(repository.Password)))
	}
	return registry.NewClient(registry.ClientOptAuthorizer(anonymousAuthorizer))
}

func repositoryCredentialsApply(repository *model.HelmRepository, targetURL string) bool {
	return repository != nil && repository.Username != "" && sameURLHost(repository.URL, targetURL)
}

// ListOCIChartVersions returns the semver tags of the chart at an oci:// URL,
// newest first. Non-semver tags (e.g. "latest", "v1.2.3") are filtered out by
// the registry client.
func ListOCIChartVersions(repository *model.HelmRepository, chartURL string) ([]string, error) {
	registryClient, err := newRegistryClient(repository, chartURL)
	if err != nil {
		return nil, err
	}
	return registryClient.Tags(ociReference(chartURL))
}

// OCIChartName returns the chart name an oci:// repository URL points at: the
// last segment of the registry path.
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

// OCIRefHasTagOrDigest reports whether an oci:// URL pins a tag or digest.
func OCIRefHasTagOrDigest(parsedURL *url.URL) bool {
	return strings.Contains(path.Base(parsedURL.Path), ":") || strings.Contains(parsedURL.Path, "@")
}

// OCIChartVersionURL builds the chart URL for one registry tag. The
// "<repository URL>:<tag>" format is load-bearing for
// MatchesRepositoryCacheKey.
func OCIChartVersionURL(repositoryURL, tag string) string {
	return strings.TrimRight(repositoryURL, "/") + ":" + tag
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

// MatchesRepositoryCacheKey reports whether a cached chart URL belongs to the
// repository: an exact match, a path under it, or — only for oci://
// repositories, whose archives are cached under "<repository URL>:<tag>" — a
// tag reference. The tag form is not matched for http repositories so they
// cannot evict a sibling on the same host that carries an explicit port.
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
