package internal

import (
	"context"
	"crypto/sha256"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

const configReloadDebounce = 300 * time.Millisecond

func StartConfigWatcher(ctx context.Context, path string) error {
	if path == "" {
		return nil
	}

	configPath, err := filepath.Abs(path)
	if err != nil {
		configPath = filepath.Clean(path)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	if err := watcher.Add(filepath.Dir(configPath)); err != nil {
		_ = watcher.Close()
		return err
	}

	_, lastHash, err := readConfigFile(configPath)
	hasHash := err == nil
	if err != nil {
		klog.Warningf("Failed to read initial config file hash: %v", err)
	}

	go watchConfigFile(ctx, watcher, configPath, lastHash, hasHash)
	klog.Infof("Watching configuration file: %s", configPath)
	return nil
}

func watchConfigFile(ctx context.Context, watcher *fsnotify.Watcher, configPath string, lastHash [sha256.Size]byte, hasHash bool) {
	defer func() {
		_ = watcher.Close()
	}()

	var timer *time.Timer
	var timerC <-chan time.Time
	scheduleReload := func() {
		if timer == nil {
			timer = time.NewTimer(configReloadDebounce)
			timerC = timer.C
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(configReloadDebounce)
		timerC = timer.C
	}

	stopTimer := func() {
		if timer == nil {
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			stopTimer()
			return
		case event, ok := <-watcher.Events:
			if !ok {
				stopTimer()
				return
			}
			if isConfigFileEvent(configPath, event) {
				scheduleReload()
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				stopTimer()
				return
			}
			klog.Warningf("Config file watcher error: %v", err)
		case <-timerC:
			timerC = nil
			sections, hash, err := reloadConfigFileIfChanged(configPath, lastHash, hasHash)
			if err != nil {
				klog.Errorf("Failed to reload config file: %v", err)
				continue
			}
			if sections == nil {
				continue
			}
			lastHash = hash
			hasHash = true
			notifyConfigReload(sections)
		}
	}
}

func reloadConfigFileIfChanged(path string, lastHash [sha256.Size]byte, hasHash bool) (AppliedSections, [sha256.Size]byte, error) {
	cfg, hash, err := readConfigFile(path)
	if err != nil {
		return nil, hash, err
	}
	if hasHash && hash == lastHash {
		return nil, hash, nil
	}

	sections := applyConfig(path, cfg)
	common.SetManagedSections(sections)
	klog.Infof("Reloaded configuration from file: %s", path)
	return sections, hash, nil
}

func notifyConfigReload(sections AppliedSections) {
	if sections["clusters"] {
		cluster.TriggerClusterSync()
	}
	if sections["rbac"] || sections["superUser"] {
		rbac.TriggerSync()
	}
}

func isConfigFileEvent(configPath string, event fsnotify.Event) bool {
	if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename|fsnotify.Remove|fsnotify.Chmod) == 0 {
		return false
	}

	eventPath := filepath.Clean(event.Name)
	if eventPath == configPath {
		return true
	}

	base := filepath.Base(eventPath)
	return base == filepath.Base(configPath) || strings.HasPrefix(base, "..data")
}
