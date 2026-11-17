package plugins

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
)

var npmPackagePattern = regexp.MustCompile(`^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`)

type npmSource struct {
	PackageName string
	Registry    string
}

type npmMetadata struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Dist    struct {
		Tarball string `json:"tarball"`
		Shasum  string `json:"shasum"`
	} `json:"dist"`
}

func npmSourceFromURL(address string) *npmSource {
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil
	}
	var registry string
	switch u.Host {
	case "registry.npmjs.org":
		registry = "npmjs"
	case "registry.npmmirror.com":
		registry = "npmmirror"
	default:
		return nil
	}
	packageName, archive, ok := strings.Cut(strings.TrimPrefix(u.Path, "/"), "/-/")
	if !ok || !strings.HasSuffix(archive, ".tgz") || len(packageName) > 214 || !npmPackagePattern.MatchString(packageName) {
		return nil
	}
	return &npmSource{PackageName: packageName, Registry: registry}
}

func readNPMMetadata(ctx context.Context, packageName, registry, version string) (*npmMetadata, error) {
	packageName = strings.TrimSpace(packageName)
	if len(packageName) > 214 || !npmPackagePattern.MatchString(packageName) {
		return nil, fmt.Errorf("enter an npm package name such as my-plugin or @scope/my-plugin")
	}
	if version != "latest" {
		if _, err := semver.StrictNewVersion(version); err != nil || len(version) > 128 {
			return nil, fmt.Errorf("npm package version must be a semantic version of at most 128 characters")
		}
	}
	var registryURL string
	switch registry {
	case "npmjs":
		registryURL = "https://registry.npmjs.org"
	case "npmmirror":
		registryURL = "https://registry.npmmirror.com"
	default:
		return nil, fmt.Errorf("registry must be npmjs or npmmirror")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resp, err := fetch(ctx, registryURL+"/"+url.PathEscape(packageName)+"/"+url.PathEscape(version))
	if err != nil {
		return nil, fmt.Errorf("cannot fetch npm package %s: %w", packageName, err)
	}
	defer func() { _ = resp.Body.Close() }()
	const maxMetadataSize = 2 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxMetadataSize+1))
	if err != nil || len(data) > maxMetadataSize {
		return nil, fmt.Errorf("npm package metadata could not be read or exceeds 2 MiB")
	}
	var metadata npmMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil, fmt.Errorf("invalid npm package metadata: %w", err)
	}
	checksum, err := hex.DecodeString(metadata.Dist.Shasum)
	if err != nil || len(checksum) != sha1.Size || metadata.Name != packageName {
		return nil, fmt.Errorf("invalid npm package identity or checksum")
	}
	if _, err := semver.StrictNewVersion(metadata.Version); err != nil || len(metadata.Version) > 128 || (version != "latest" && metadata.Version != version) {
		return nil, fmt.Errorf("invalid npm package version")
	}
	return &metadata, nil
}

func installNPM(ctx context.Context, source npmSource, version, expectedID string, enabled bool) (string, error) {
	metadata, err := readNPMMetadata(ctx, source.PackageName, source.Registry, version)
	if err != nil {
		return "", err
	}
	archive, err := fetch(ctx, metadata.Dist.Tarball)
	if err != nil {
		return "", err
	}
	defer func() { _ = archive.Body.Close() }()
	hash := sha1.New()
	var id string
	err = withArchive(io.TeeReader(archive.Body, hash), nil, func(content string, manifest Manifest, digest string) error {
		if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), metadata.Dist.Shasum) {
			return fmt.Errorf("npm package checksum does not match")
		}
		if manifest.Version != metadata.Version {
			return fmt.Errorf("plugin version does not match the npm package version")
		}
		if expectedID != "" && manifest.ID != expectedID {
			return fmt.Errorf("plugin ID does not match the installed plugin")
		}
		if err := checkCompatibility(manifest.SDKVersion, manifest.Requires); err != nil {
			return err
		}
		if err := saveInstallation(content, manifest, digest, metadata.Dist.Tarball, enabled); err != nil {
			return err
		}
		id = manifest.ID
		return nil
	})
	return id, err
}
