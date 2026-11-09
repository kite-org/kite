//go:build desktop

package internal

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
)

var kubeconfigMu sync.Mutex
var kubeconfigSourcesChanged = make(chan struct{}, 1)

func loadClusters() error {
	var paths []string
	for _, path := range clientcmd.NewDefaultClientConfigLoadingRules().Precedence {
		if path == "" {
			continue
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		paths = append(paths, absolute)
	}
	source := model.KubeconfigSource{Key: "default", Paths: paths, Enabled: true}
	if err := model.DB.Where("key = ?", source.Key).FirstOrCreate(&source).Error; err != nil {
		return err
	}
	if !slices.Equal(source.Paths, paths) {
		source.Paths = paths
		if err := model.DB.Select("Paths").Updates(&source).Error; err != nil {
			return err
		}
	}
	var sources []model.KubeconfigSource
	if err := model.DB.Where("enabled = ?", true).Find(&sources).Error; err != nil {
		return err
	}
	for _, source := range sources {
		_, _, _ = syncKubeconfigSource(source, false)
	}
	return nil
}

func ImportKubeconfigFile(path string) (int64, error) {
	if common.IsSectionManaged("clusters") {
		return 0, fmt.Errorf("cannot import kubeconfig: %s", common.ManagedSectionError)
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return 0, err
	}
	kubeconfigMu.Lock()
	defer kubeconfigMu.Unlock()
	var sources []model.KubeconfigSource
	if err := model.DB.Find(&sources).Error; err != nil {
		return 0, err
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(path)))
	source := model.KubeconfigSource{Key: key, Paths: []string{path}, Enabled: true}
	for _, existing := range sources {
		if slices.Contains(existing.Paths, path) && (existing.Enabled || existing.Key == key) {
			source = existing
			break
		}
	}
	if source.ID == 0 {
		if err := model.DB.Create(&source).Error; err != nil {
			return 0, err
		}
	} else if !source.Enabled {
		if err := model.DB.Model(&source).Update("enabled", true).Error; err != nil {
			return 0, err
		}
	}
	count, changed, err := syncKubeconfigSource(source, true)
	if changed {
		cluster.TriggerClusterSync()
	}
	select {
	case kubeconfigSourcesChanged <- struct{}{}:
	default:
	}
	return count, err
}

func RemoveKubeconfigSource(id uint) error {
	if common.IsSectionManaged("clusters") {
		return fmt.Errorf("cannot remove kubeconfig source: %s", common.ManagedSectionError)
	}
	kubeconfigMu.Lock()
	defer kubeconfigMu.Unlock()
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var source model.KubeconfigSource
		if err := tx.Where("id = ?", id).First(&source).Error; err != nil {
			return err
		}
		if err := tx.Where("kubeconfig_source_id = ?", id).Delete(&model.Cluster{}).Error; err != nil {
			return err
		}
		return tx.Model(&model.KubeconfigSource{}).Where("id = ?", id).Update("enabled", false).Error
	})
	if err == nil {
		cluster.TriggerClusterSync()
		select {
		case kubeconfigSourcesChanged <- struct{}{}:
		default:
		}
	}
	return err
}

func syncKubeconfigSource(source model.KubeconfigSource, importing bool) (count int64, changed bool, resultErr error) {
	defer func() {
		message := ""
		if resultErr != nil {
			message = resultErr.Error()
		}
		if message != source.Error {
			if err := model.DB.Model(&source).Update("error", message).Error; err != nil {
				resultErr = err
			}
		}
	}()
	for _, path := range source.Paths {
		info, err := os.Stat(path)
		if err != nil {
			return 0, false, err
		}
		if info.Size() == 0 {
			return 0, false, fmt.Errorf("kubeconfig file is empty: %s", path)
		}
	}
	rules := clientcmd.ClientConfigLoadingRules{Precedence: source.Paths}
	config, err := rules.Load()
	if err != nil {
		return 0, false, err
	}
	if len(config.Contexts) > 0 {
		if err := clientcmd.Validate(*config); err != nil {
			return 0, false, err
		}
	}
	return applyKubeconfigSource(source, config, importing)
}

func applyKubeconfigSource(source model.KubeconfigSource, config *clientcmdapi.Config, importing bool) (int64, bool, error) {
	var count int64
	changed := false
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var existing []model.Cluster
		if err := tx.Find(&existing).Error; err != nil {
			return err
		}
		byName := make(map[string]model.Cluster, len(existing))
		for _, item := range existing {
			byName[item.Name] = item
		}
		for name, context := range config.Contexts {
			item, exists := byName[name]
			if exists && item.KubeconfigSourceID != source.ID &&
				(!importing || item.KubeconfigSourceID != 0 || item.InCluster || item.ClusterAgent) {
				return fmt.Errorf("cluster %q already exists outside this kubeconfig source; import the file to link an existing manual configuration", name)
			}
			single := clientcmdapi.NewConfig()
			single.CurrentContext = name
			single.Contexts[name] = context
			single.Clusters[context.Cluster] = config.Clusters[context.Cluster]
			if auth := config.AuthInfos[context.AuthInfo]; auth != nil {
				single.AuthInfos[context.AuthInfo] = auth
			}
			content, err := clientcmd.Write(*single)
			if err != nil {
				return err
			}
			if !exists {
				item = model.Cluster{
					Name: name, Config: model.SecretString(content), KubeconfigSourceID: source.ID,
					Enable: true, IsDefault: len(existing) == 0 && name == config.CurrentContext,
				}
				if err := tx.Create(&item).Error; err != nil {
					return err
				}
				changed = true
			} else if string(item.Config) != string(content) || item.KubeconfigSourceID != source.ID {
				if err := tx.Model(&item).Updates(map[string]interface{}{
					"config": model.SecretString(content), "kubeconfig_source_id": source.ID,
				}).Error; err != nil {
					return err
				}
				changed = true
			}
			count++
		}
		for _, item := range existing {
			if item.KubeconfigSourceID == source.ID && config.Contexts[item.Name] == nil {
				if err := tx.Delete(&item).Error; err != nil {
					return err
				}
				changed = true
			}
		}
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	return count, changed, nil
}

func StartKubeconfigWatcher(ctx context.Context, onChange func()) error {
	if common.IsSectionManaged("clusters") {
		return nil
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	go func() {
		defer func() { _ = watcher.Close() }()
		var sources []model.KubeconfigSource
		reload := func() {
			changed := false
			kubeconfigMu.Lock()
			defer func() {
				kubeconfigMu.Unlock()
				if changed {
					cluster.TriggerClusterSync()
					onChange()
				}
			}()
			if err := model.DB.Where("enabled = ?", true).Find(&sources).Error; err != nil {
				klog.Errorf("Failed to list kubeconfig sources: %v", err)
				return
			}
			directories := make(map[string]bool)
			for _, source := range sources {
				for _, path := range source.Paths {
					dir := filepath.Dir(path)
					for {
						if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) || filepath.Dir(dir) == dir {
							break
						}
						dir = filepath.Dir(dir)
					}
					directories[dir] = true
				}
				_, updated, _ := syncKubeconfigSource(source, false)
				changed = changed || updated
			}
			watched := watcher.WatchList()
			for _, dir := range watched {
				if !directories[dir] {
					_ = watcher.Remove(dir)
				}
			}
			for dir := range directories {
				if !slices.Contains(watched, dir) {
					if err := watcher.Add(dir); err != nil {
						klog.Errorf("Failed to watch kubeconfig directory %s: %v", dir, err)
					}
				}
			}
		}
		reload()
		timer := time.NewTimer(time.Hour)
		timer.Stop()
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-kubeconfigSourcesChanged:
				reload()
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				for _, source := range sources {
					for _, path := range source.Paths {
						if event.Name == path || strings.HasPrefix(path, event.Name+string(filepath.Separator)) {
							timer.Reset(300 * time.Millisecond)
						}
					}
				}
			case <-timer.C:
				reload()
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				klog.Errorf("Kubeconfig watcher error: %v", err)
			}
		}
	}()
	return nil
}
