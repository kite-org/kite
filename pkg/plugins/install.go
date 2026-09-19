package plugins

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"k8s.io/klog/v2"
)

const (
	maxArchiveSize  = 50 * 1024 * 1024
	maxExpandedSize = 200 * 1024 * 1024
)

// Coordinate asset installation, recovery, and removal within this process.
var mutationMu sync.Mutex

func installArchive(reader io.Reader, expected *CatalogPlugin, enabled bool) (string, error) {
	var id string
	err := withArchive(reader, expected, func(content string, manifest Manifest, digest string) error {
		if err := checkCompatibility(manifest.SDKVersion, manifest.Requires); err != nil {
			return err
		}
		var downloadURL string
		if expected != nil {
			downloadURL = expected.URL
		}
		if err := saveInstallation(content, manifest, digest, downloadURL, enabled); err != nil {
			return err
		}
		id = manifest.ID
		return nil
	})
	return id, err
}

func withArchive(reader io.Reader, expected *CatalogPlugin, consume func(string, Manifest, string) error) error {
	if err := os.MkdirAll(common.PluginDir, 0750); err != nil {
		return fmt.Errorf("cannot create plugin directory: %w", err)
	}
	stage, err := os.MkdirTemp(common.PluginDir, ".install-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(stage) }()
	archive, err := os.Create(filepath.Join(stage, "archive.tar.gz"))
	if err != nil {
		return err
	}
	defer func() { _ = archive.Close() }()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(archive, hash), io.LimitReader(reader, maxArchiveSize+1))
	if err != nil {
		return fmt.Errorf("cannot read plugin archive: %w", err)
	}
	if size > maxArchiveSize {
		return fmt.Errorf("plugin archive exceeds 50 MiB")
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if expected != nil && !strings.EqualFold(expected.SHA256, digest) {
		return fmt.Errorf("plugin archive SHA256 does not match the expected digest")
	}
	if _, err := archive.Seek(0, io.SeekStart); err != nil {
		return err
	}
	content := filepath.Join(stage, "content")
	if err := os.Mkdir(content, 0750); err != nil {
		return err
	}
	if err := extractArchive(archive, content); err != nil {
		return err
	}
	manifest, err := readManifest(content)
	if err != nil {
		return err
	}
	if expected != nil && (manifest.ID != expected.ID || manifest.Version != expected.Version) {
		return fmt.Errorf("plugin identity does not match the expected ID and version")
	}
	return consume(content, manifest, digest)
}

func extractArchive(reader io.Reader, dir string) error {
	gz, err := gzip.NewReader(reader)
	if err != nil {
		return fmt.Errorf("plugin archive must be tar.gz")
	}
	defer func() { _ = gz.Close() }()
	expanded := &io.LimitedReader{R: gz, N: maxExpandedSize + 1}
	archive := tar.NewReader(expanded)
	var total int64
	for count := 0; ; count++ {
		header, err := archive.Next()
		if expanded.N == 0 {
			return fmt.Errorf("plugin archive exceeds 200 MiB expanded")
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("invalid plugin archive: %w", err)
		}
		total += header.Size
		if count >= 10000 || total > maxExpandedSize {
			return fmt.Errorf("plugin archive exceeds 10000 entries or 200 MiB expanded")
		}
		name := strings.TrimSuffix(strings.TrimPrefix(header.Name, "./"), "/")
		if (name == "" || name == ".") && header.Typeflag == tar.TypeDir {
			continue
		}
		if !validAssetPath(name) {
			return fmt.Errorf("unsafe archive path: %s", header.Name)
		}
		destination := filepath.Join(dir, filepath.FromSlash(name))
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(destination, 0750); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := extractFile(archive, destination); err != nil {
				return err
			}
		default:
			return fmt.Errorf("plugin archive may only contain regular files and directories")
		}
	}
}

func extractFile(reader io.Reader, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0750); err != nil {
		return err
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0640)
	if err != nil {
		return fmt.Errorf("duplicate or invalid archive entry: %w", err)
	}
	_, copyErr := io.Copy(file, reader)
	closeErr := file.Close()
	return errors.Join(copyErr, closeErr)
}

func saveInstallation(content string, manifest Manifest, digest, downloadURL string, enabled bool) error {
	mutationMu.Lock()
	defer mutationMu.Unlock()
	var previous model.Plugin
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&previous, "id = ?", manifest.ID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if previous.Version == manifest.Version && previous.Digest != digest {
			return fmt.Errorf("this plugin version is already installed with different content; publish a new version")
		}
		if downloadURL == "" && previous.Version == manifest.Version {
			downloadURL = previous.DownloadURL
		}
		plugin := model.Plugin{
			ID:          manifest.ID,
			Enabled:     enabled,
			Version:     manifest.Version,
			Digest:      digest,
			DownloadURL: downloadURL,
			CreatedAt:   previous.CreatedAt,
		}
		if err := publishAssets(content, plugin); err != nil {
			return err
		}
		if previous.ID == "" {
			return tx.Create(&plugin).Error
		}
		return tx.Save(&plugin).Error
	})
	if err != nil {
		return err
	}
	forgetRecovery(manifest.ID)
	if previous.ID != "" && previous.Version != manifest.Version {
		if err := os.RemoveAll(filepath.Join(common.PluginDir, previous.ID, previous.Version)); err != nil {
			klog.Warningf("Failed to remove replaced plugin %s@%s: %v", previous.ID, previous.Version, err)
		}
	}
	return nil
}

func publishAssets(content string, plugin model.Plugin) error {
	destination := filepath.Join(common.PluginDir, plugin.ID, plugin.Version, plugin.Digest)
	if err := os.MkdirAll(filepath.Dir(destination), 0750); err != nil {
		return err
	}
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	return os.Rename(content, destination)
}
