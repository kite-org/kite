package plugins

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/zxh326/kite/pkg/version"
)

type Manifest struct {
	SchemaVersion int             `json:"schemaVersion"`
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Version       string          `json:"version"`
	Description   string          `json:"description,omitempty"`
	Author        string          `json:"author,omitempty"`
	Homepage      string          `json:"homepage,omitempty"`
	License       string          `json:"license,omitempty"`
	Requires      Requirements    `json:"requires"`
	Entry         string          `json:"entry"`
	Module        string          `json:"module"`
	Styles        []string        `json:"styles,omitempty"`
	Routes        json.RawMessage `json:"routes"`
	Menus         json.RawMessage `json:"menus"`
}

type Requirements struct {
	Kite string `json:"kite"`
}

func readManifest(dir string) (Manifest, error) {
	var manifest Manifest
	file, err := os.Open(filepath.Join(dir, "plugin.json"))
	if err != nil {
		return manifest, fmt.Errorf("archive must contain plugin.json at its root")
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.Size() > 1024*1024 {
		return manifest, fmt.Errorf("plugin.json must not exceed 1 MiB")
	}
	if err := json.NewDecoder(file).Decode(&manifest); err != nil {
		return manifest, fmt.Errorf("invalid plugin.json: %w", err)
	}
	if err := manifest.validate(); err != nil {
		return manifest, err
	}
	assets := append([]string{manifest.Entry}, manifest.Styles...)
	for _, asset := range assets {
		if !validAssetPath(asset) {
			return manifest, fmt.Errorf("invalid asset path: %s", asset)
		}
		info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(asset)))
		if err != nil || !info.Mode().IsRegular() {
			return manifest, fmt.Errorf("missing asset: %s", asset)
		}
	}
	return manifest, nil
}

func (m Manifest) validate() error {
	if m.SchemaVersion != 1 {
		return fmt.Errorf("unsupported plugin schema version")
	}
	if !validPluginID(m.ID) {
		return fmt.Errorf("plugin ID must be a safe directory name of 1-64 bytes")
	}
	if strings.TrimSpace(m.Name) == "" || len(m.Name) > 128 {
		return fmt.Errorf("plugin name must be 1-128 characters")
	}
	if _, err := semver.StrictNewVersion(m.Version); err != nil || len(m.Version) > 128 {
		return fmt.Errorf("plugin version must be a semantic version of at most 128 characters")
	}
	return nil
}

func (r Requirements) validate() error {
	if r.Kite == "" {
		return fmt.Errorf("requires.kite is required")
	}
	kiteRange, err := semver.NewConstraint(r.Kite)
	if err != nil {
		return fmt.Errorf("invalid requires.kite range")
	}
	kiteVersion, err := semver.NewVersion(version.Version)
	if err == nil && !kiteRange.Check(kiteVersion) {
		return fmt.Errorf("plugin requires Kite %s; this Kite is %s", r.Kite, version.Version)
	}
	return nil
}

func validPluginID(name string) bool {
	return len(name) > 0 && len(name) <= 64 && validAssetPath(name) && path.Base(name) == name
}

func validAssetPath(name string) bool {
	return name != "" && name != "." && name == path.Clean(name) && !strings.HasPrefix(name, "/") &&
		!strings.HasPrefix(name, "../") && name != ".." && !strings.ContainsAny(name, "\\\x00:#?%")
}
