package internal

import (
	"os"
	"path/filepath"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"k8s.io/klog/v2"
)

var (
	kiteUsername = os.Getenv("KITE_USERNAME")
	kitePassword = os.Getenv("KITE_PASSWORD")
)

func loadUser() error {
	if kiteUsername != "" && kitePassword != "" {
		uc, err := model.CountUsers()
		if err == nil && uc == 0 {
			klog.Infof("Creating super user %s from environment variables", kiteUsername)
			u := &model.User{
				Username: kiteUsername,
				Password: kitePassword,
			}
			err := model.AddSuperUser(u)
			if err == nil {
				rbac.SyncNow <- struct{}{}
			} else {
				return err
			}
		}
	}

	return nil
}

func loadClusters() error {
	cc, err := model.CountClusters()
	if err != nil || cc > 0 {
		return err
	}
	
	// Check if KITE_IMPORT_KUBECONFIG is set to false
	if importKubeconfig := os.Getenv("KITE_IMPORT_KUBECONFIG"); importKubeconfig == "false" {
		klog.Infof("Skipping kubeconfig import as KITE_IMPORT_KUBECONFIG is set to false")
		return nil
	}
	
	kubeconfigpath := ""
	if home := homedir.HomeDir(); home != "" {
		kubeconfigpath = filepath.Join(home, ".kube", "config")
	}

	if envKubeconfig := os.Getenv("KUBECONFIG"); envKubeconfig != "" {
		kubeconfigpath = envKubeconfig
	}

	config, err := os.ReadFile(kubeconfigpath)
	if err != nil {
		klog.Warningf("Failed to read kubeconfig file: %v", err)
		return nil
	}

	if len(config) == 0 {
		klog.Infof("Kubeconfig file is empty, skipping import")
		return nil
	}
	
	kubeconfig, err := clientcmd.Load(config)
	if err != nil {
		klog.Warningf("Failed to load kubeconfig: %v", err)
		return nil
	}

	if len(kubeconfig.Contexts) == 0 {
		klog.Infof("No contexts found in kubeconfig, skipping import")
		return nil
	}

	klog.Infof("Importing clusters from kubeconfig: %s", kubeconfigpath)
	cluster.ImportClustersFromKubeconfig(kubeconfig)
	return nil
}

// LoadConfigFromEnv loads configuration from environment variables.
func LoadConfigFromEnv() {
	if err := loadUser(); err != nil {
		klog.Warningf("Failed to migrate env to db user: %v", err)
	}

	if err := loadClusters(); err != nil {
		klog.Warningf("Failed to migrate env to db cluster: %v", err)
	}
}
