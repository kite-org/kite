package helmutil

import (
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	release "helm.sh/helm/v4/pkg/release/v1"
	"k8s.io/klog/v2"
)

func RecordReleaseHistory(clusterName string, operatorID uint, source, opType, name, namespace string, prev, curr *release.Release, success bool, err error) {
	if curr != nil {
		name = curr.Name
		namespace = curr.Namespace
	} else if prev != nil {
		name = prev.Name
		namespace = prev.Namespace
	}

	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	resourceYAML := ReleaseToYAML(curr)
	if opType == "delete" {
		resourceYAML = ""
	}
	history := model.ResourceHistory{
		ClusterName:     clusterName,
		ResourceType:    string(common.HelmReleases),
		ResourceName:    name,
		Namespace:       namespace,
		OperationType:   opType,
		OperationSource: source,
		ResourceYAML:    resourceYAML,
		PreviousYAML:    ReleaseToYAML(prev),
		Success:         success,
		ErrorMessage:    errMsg,
		OperatorID:      operatorID,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("Failed to create helm release history: %v", err)
	}
}
