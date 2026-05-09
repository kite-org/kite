package helmutil

import (
	"bytes"
	"fmt"
	"net/url"
	"path"
	"strings"

	"github.com/zxh326/kite/pkg/model"
	chart "helm.sh/helm/v4/pkg/chart/v2"
	"helm.sh/helm/v4/pkg/chart/v2/loader"
	"helm.sh/helm/v4/pkg/getter"
	"helm.sh/helm/v4/pkg/registry"
	repo "helm.sh/helm/v4/pkg/repo/v1"
)

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
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" && parsedURL.Scheme != "oci" {
		return nil, fmt.Errorf("unsupported chartUrl scheme")
	}

	client, err := getter.Getters().ByScheme(parsedURL.Scheme)
	if err != nil {
		return nil, err
	}

	options := []getter.Option{
		getter.WithAcceptHeader("application/gzip,application/octet-stream"),
	}
	useRepositoryCredentials := repository != nil && repository.Username != "" && sameURLHost(repository.URL, chartURL)
	if useRepositoryCredentials {
		options = append(options, getter.WithBasicAuth(repository.Username, string(repository.Password)))
	}

	if parsedURL.Scheme == "oci" {
		registryOptions := []registry.ClientOption{}
		if useRepositoryCredentials {
			registryOptions = append(registryOptions, registry.ClientOptBasicAuth(repository.Username, string(repository.Password)))
		}
		registryClient, err := registry.NewClient(registryOptions...)
		if err != nil {
			return nil, err
		}
		if !strings.Contains(path.Base(parsedURL.Path), ":") && !strings.Contains(parsedURL.Path, "@") {
			tags, err := registryClient.Tags(strings.TrimPrefix(chartURL, "oci://"))
			if err != nil {
				return nil, err
			}
			tag, err := registry.GetTagMatchingVersionOrConstraint(tags, "")
			if err != nil {
				return nil, err
			}
			chartURL = chartURL + ":" + tag
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
	return loader.LoadArchive(bytes.NewReader(data.Bytes()))
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
