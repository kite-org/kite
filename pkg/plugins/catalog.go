package plugins

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/version"
)

type CatalogPlugin struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Author      string       `json:"author,omitempty"`
	Homepage    string       `json:"homepage,omitempty"`
	ReadmeURL   string       `json:"readmeUrl,omitempty"`
	Version     string       `json:"version"`
	URL         string       `json:"url"`
	SHA256      string       `json:"sha256"`
	Requires    Requirements `json:"requires"`
	Error       string       `json:"error,omitempty"`
}

func validatePluginURL(address string) error {
	u, err := url.Parse(address)
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Fragment != "" || len(address) > 2048 {
		return fmt.Errorf("plugin URL must use HTTP or HTTPS without credentials or fragments, at most 2048 characters")
	}
	return nil
}

func fetch(ctx context.Context, address string) (*http.Response, error) {
	if err := validatePluginURL(address); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid plugin URL")
	}
	req.Header.Set("User-Agent", "kite/"+version.Version)
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch plugin URL")
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("plugin URL returned HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

func readCatalog(ctx context.Context, address string) ([]CatalogPlugin, error) {
	if address == "" {
		address = common.DefaultPluginCatalogURL
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resp, err := fetch(ctx, address)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	const maxCatalogSize = 2 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogSize+1))
	if err != nil || len(data) > maxCatalogSize {
		return nil, fmt.Errorf("plugin catalog could not be read or exceeds 2 MiB")
	}
	catalog := struct {
		Plugins []CatalogPlugin `json:"plugins"`
	}{}
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, fmt.Errorf("invalid plugin catalog JSON")
	}
	seen := make(map[string]bool, len(catalog.Plugins))
	for i := range catalog.Plugins {
		plugin := &catalog.Plugins[i]
		digest, err := hex.DecodeString(plugin.SHA256)
		if err != nil || len(digest) != 32 || !validPluginID(plugin.ID) || strings.TrimSpace(plugin.Name) == "" || len(plugin.Name) > 128 {
			return nil, fmt.Errorf("invalid catalog entry: %s", plugin.ID)
		}
		if _, err := semver.StrictNewVersion(plugin.Version); err != nil || len(plugin.Version) > 128 {
			return nil, fmt.Errorf("invalid semantic version for catalog entry: %s", plugin.ID)
		}
		if err := validatePluginURL(plugin.URL); err != nil {
			return nil, fmt.Errorf("invalid download URL for catalog entry %s: %w", plugin.ID, err)
		}
		key := plugin.ID + "@" + plugin.Version
		if seen[key] {
			return nil, fmt.Errorf("duplicate catalog entry: %s", key)
		}
		seen[key] = true
		plugin.SHA256 = strings.ToLower(plugin.SHA256)
		plugin.Error = ""
		if err := plugin.Requires.validate(); err != nil {
			plugin.Error = err.Error()
		}
	}
	if catalog.Plugins == nil {
		return []CatalogPlugin{}, nil
	}
	return catalog.Plugins, nil
}
