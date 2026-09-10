package plugins

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

type pluginRecovery struct {
	err error
}

var (
	recoveryContext context.Context
	recoveryMu      sync.Mutex
	recoveries      = map[[3]string]*pluginRecovery{}
)

func Start(ctx context.Context) {
	recoveryContext = ctx
	go func() {
		records, err := enabledPlugins()
		if err != nil {
			klog.Errorf("Failed to load installed plugins: %v", err)
			return
		}
		for _, plugin := range records {
			klog.Infof("Loading plugin %s", plugin.ID)
			manifest, err := loadInstalledPlugin(plugin, true)
			if err != nil {
				if manifest != nil || plugin.DownloadURL == "" {
					klog.Errorf("Loading plugin %s error: %v", plugin.ID, err)
				}
				continue
			}
			klog.Infof("Loaded plugin %s@%s", plugin.ID, plugin.Version)
		}
	}()
}

func enabledPlugins() ([]model.Plugin, error) {
	var records []model.Plugin
	err := model.DB.Where("enabled = ?", true).Order("id").Find(&records).Error
	return records, err
}

func loadInstalledPlugin(plugin model.Plugin, restore bool) (*Manifest, error) {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	key := [3]string{plugin.ID, plugin.Version, plugin.Digest}
	if recovery := recoveries[key]; recovery != nil {
		return nil, recovery.err
	}
	manifest, err := readManifest(filepath.Join(common.PluginDir, plugin.ID, plugin.Version, plugin.Digest))
	if err == nil && (manifest.ID != plugin.ID || manifest.Version != plugin.Version) {
		err = fmt.Errorf("plugin identity does not match its installation record")
	}
	if err == nil {
		return &manifest, manifest.Requires.validate()
	}
	if plugin.DownloadURL == "" {
		return nil, fmt.Errorf("plugin files are unavailable; upload this plugin version again: %w", err)
	}
	if !restore {
		return nil, fmt.Errorf("plugin files are unavailable: %w", err)
	}
	recovery := &pluginRecovery{err: fmt.Errorf("plugin files are unavailable; restoring installed version")}
	recoveries[key] = recovery
	klog.Warningf("Loading plugin %s error: %v, reinstall from %s", plugin.ID, err, plugin.DownloadURL)
	go func() {
		err := restorePlugin(plugin, recovery)
		recoveryMu.Lock()
		defer recoveryMu.Unlock()
		if recoveries[key] != recovery {
			return
		}
		if err != nil {
			recovery.err = fmt.Errorf("failed to restore plugin files: %w", err)
			klog.Errorf("Loading plugin %s error: %v", plugin.ID, recovery.err)
		} else {
			delete(recoveries, key)
		}
	}()
	return nil, recovery.err
}

func restorePlugin(plugin model.Plugin, recovery *pluginRecovery) error {
	resp, err := fetch(recoveryContext, plugin.DownloadURL)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	expected := &CatalogPlugin{ID: plugin.ID, Version: plugin.Version, SHA256: plugin.Digest}
	return withArchive(resp.Body, expected, func(content string, manifest Manifest, _ string) error {
		mutationMu.Lock()
		defer mutationMu.Unlock()
		recoveryMu.Lock()
		current := recoveries[[3]string{plugin.ID, plugin.Version, plugin.Digest}] == recovery
		recoveryMu.Unlock()
		if !current {
			return nil
		}
		var record model.Plugin
		if err := model.DB.First(&record, "id = ? AND version = ? AND digest = ?", plugin.ID, plugin.Version, plugin.Digest).Error; err != nil {
			return err
		}
		if err := publishAssets(content, record); err != nil {
			return err
		}
		if err := manifest.Requires.validate(); err != nil {
			klog.Errorf("Loading plugin %s error: %v", plugin.ID, err)
		} else {
			klog.Infof("Loaded plugin %s@%s", plugin.ID, plugin.Version)
		}
		return nil
	})
}

func forgetRecovery(id string) {
	recoveryMu.Lock()
	defer recoveryMu.Unlock()
	for key := range recoveries {
		if key[0] == id {
			delete(recoveries, key)
		}
	}
}
