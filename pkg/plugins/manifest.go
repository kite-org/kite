package plugins

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/zxh326/kite/pkg/version"
)

const supportedSDKVersions = ">=0.0.6"

var pluginIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)

type Manifest struct {
	SchemaVersion int             `json:"schemaVersion"`
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Version       string          `json:"version"`
	SDKVersion    string          `json:"sdkVersion"`
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
	Resources     json.RawMessage `json:"resources"`
	Themes        []Theme         `json:"themes,omitempty"`
	Settings      *Settings       `json:"settings,omitempty"`
}

type Requirements struct {
	Kite string `json:"kite"`
}

type Theme struct {
	ID     string          `json:"id"`
	Label  json.RawMessage `json:"label,omitempty"`
	Styles []string        `json:"styles"`
}

type Settings struct {
	Label json.RawMessage `json:"label,omitempty"`
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
	themeIDs := make(map[string]struct{}, len(manifest.Themes))
	for _, theme := range manifest.Themes {
		if !validThemeID(theme.ID) {
			return manifest, fmt.Errorf("invalid theme ID: %s", theme.ID)
		}
		if _, ok := themeIDs[theme.ID]; ok {
			return manifest, fmt.Errorf("duplicate theme ID: %s", theme.ID)
		}
		themeIDs[theme.ID] = struct{}{}
		if len(theme.Styles) == 0 {
			return manifest, fmt.Errorf("theme %s must list at least one stylesheet", theme.ID)
		}
		assets = append(assets, theme.Styles...)
	}
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
		return fmt.Errorf("plugin ID must be 1-64 lowercase letters, digits or hyphens, starting and ending with a letter or digit")
	}
	if strings.TrimSpace(m.Name) == "" || len(m.Name) > 128 {
		return fmt.Errorf("plugin name must be 1-128 characters")
	}
	if _, err := semver.StrictNewVersion(m.Version); err != nil || len(m.Version) > 128 {
		return fmt.Errorf("plugin version must be a semantic version of at most 128 characters")
	}
	return nil
}

func checkCompatibility(sdkVersion string, r Requirements) error {
	if sdkVersion == "" {
		return fmt.Errorf("sdkVersion is required")
	}
	sdk, err := semver.StrictNewVersion(sdkVersion)
	if err != nil || len(sdkVersion) > 128 {
		return fmt.Errorf("sdkVersion must be a semantic version of at most 128 characters")
	}
	sdkRange, _ := semver.NewConstraint(supportedSDKVersions)
	if !sdkRange.Check(sdk) {
		return fmt.Errorf("plugin was built with SDK %s; this Kite supports SDK %s", sdkVersion, supportedSDKVersions)
	}
	if r.Kite == "" {
		return fmt.Errorf("requires.kite is required")
	}
	kiteRange, err := semver.NewConstraint(r.Kite)
	if err != nil {
		return fmt.Errorf("invalid requires.kite range")
	}
	kiteVersion, err := semver.StrictNewVersion(strings.TrimPrefix(version.Version, "v"))
	if err == nil && kiteVersion.Prerelease() == "" && kiteVersion.Metadata() == "" && !kiteRange.Check(kiteVersion) {
		return fmt.Errorf("plugin requires Kite %s; this Kite is %s", r.Kite, version.Version)
	}
	return nil
}

func validPluginID(name string) bool {
	return pluginIDPattern.MatchString(name)
}

func validThemeID(id string) bool {
	if id == "" {
		return false
	}
	for i, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' && i > 0 && i < len(id)-1:
		default:
			return false
		}
	}
	return true
}

func validAssetPath(name string) bool {
	return name != "" && name != "." && name == path.Clean(name) && !strings.HasPrefix(name, "/") &&
		!strings.HasPrefix(name, "../") && name != ".." && !strings.ContainsAny(name, "\\\x00:#?%")
}
