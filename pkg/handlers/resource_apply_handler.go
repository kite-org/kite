package handlers

import (
	"bufio"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	serializeryaml "k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	syaml "sigs.k8s.io/yaml"
)

type ResourceApplyHandler struct {
}

func NewResourceApplyHandler() *ResourceApplyHandler {
	return &ResourceApplyHandler{}
}

type ApplyResourceRequest struct {
	YAML string `json:"yaml" binding:"required"`
}

// ApplyResource applies one or more YAML resources to the cluster
func (h *ResourceApplyHandler) ApplyResource(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	var req ApplyResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	decodeUniversal := serializeryaml.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)
	reader := utilyaml.NewYAMLReader(bufio.NewReader(strings.NewReader(req.YAML)))
	appliedResources := make([]gin.H, 0, 1)

	for {
		rawDoc, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			klog.Errorf("Failed to read YAML document: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid YAML format: " + err.Error()})
			return
		}

		docYAML := strings.TrimSpace(string(rawDoc))
		if docYAML == "" {
			continue
		}

		obj := &unstructured.Unstructured{}
		_, _, err = decodeUniversal.Decode(rawDoc, nil, obj)
		if err != nil {
			klog.Errorf("Failed to decode YAML: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid YAML format: " + err.Error()})
			return
		}
		if obj.GetKind() == "" || obj.GetName() == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "YAML must include kind and metadata.name"})
			return
		}

		resource := strings.ToLower(obj.GetKind()) + "s"
		canCreate := rbac.CanAccess(user, resource, string(common.VerbCreate), cs.Name, obj.GetNamespace())
		canUpdate := false
		if !canCreate {
			canUpdate = rbac.CanAccess(user, resource, string(common.VerbUpdate), cs.Name, obj.GetNamespace())
		}
		if !canCreate && !canUpdate {
			c.JSON(http.StatusForbidden, gin.H{
				"error": rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, obj.GetNamespace(), cs.Name)})
			return
		}

		existingObj := &unstructured.Unstructured{}
		existingObj.SetGroupVersionKind(obj.GetObjectKind().GroupVersionKind())
		existingObj.SetName(obj.GetName())
		existingObj.SetNamespace(obj.GetNamespace())

		err = cs.K8sClient.Get(ctx, client.ObjectKey{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}, existingObj)

		operation := "get"
		switch {
		case apierrors.IsNotFound(err):
			operation = "create"
			if !canCreate {
				c.JSON(http.StatusForbidden, gin.H{
					"error": rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, obj.GetNamespace(), cs.Name)})
				return
			}
			err = cs.K8sClient.Create(ctx, obj)
			if err != nil {
				klog.Errorf("Failed to create resource: %v", err)
			}
		case err == nil:
			operation = "update"
			if !canUpdate {
				canUpdate = rbac.CanAccess(user, resource, string(common.VerbUpdate), cs.Name, obj.GetNamespace())
			}
			if !canUpdate {
				c.JSON(http.StatusForbidden, gin.H{
					"error": rbac.NoAccess(user.Key(), string(common.VerbUpdate), resource, obj.GetNamespace(), cs.Name)})
				return
			}
			obj.SetResourceVersion(existingObj.GetResourceVersion())
			err = cs.K8sClient.Update(ctx, obj)
			if err != nil {
				klog.Errorf("Failed to update resource: %v", err)
			}
		default:
			klog.Errorf("Failed to get resource: %v", err)
		}

		previousYAML := []byte{}
		if existingObj.GetResourceVersion() != "" {
			existingObj.SetManagedFields(nil)
			previousYAML, _ = syaml.Marshal(existingObj)
		}
		errMessage := ""
		if err != nil {
			errMessage = err.Error()
		}
		model.DB.Create(&model.ResourceHistory{
			ClusterName:   cs.Name,
			ResourceType:  resource,
			ResourceName:  obj.GetName(),
			Namespace:     obj.GetNamespace(),
			OperationType: "apply",
			ResourceYAML:  docYAML,
			PreviousYAML:  string(previousYAML),
			OperatorID:    user.ID,
			Success:       err == nil,
			ErrorMessage:  errMessage,
		})

		if err != nil {
			switch operation {
			case "create":
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create resource: " + err.Error()})
			case "update":
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update resource: " + err.Error()})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get resource: " + err.Error()})
			}
			return
		}

		klog.Infof("Successfully applied resource: %s/%s", obj.GetKind(), obj.GetName())
		appliedResources = append(appliedResources, gin.H{
			"kind":      obj.GetKind(),
			"name":      obj.GetName(),
			"namespace": obj.GetNamespace(),
		})
	}

	if len(appliedResources) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid resource YAML found"})
		return
	}
	if len(appliedResources) == 1 {
		c.JSON(http.StatusOK, gin.H{
			"message":   "Resource applied successfully",
			"kind":      appliedResources[0]["kind"],
			"name":      appliedResources[0]["name"],
			"namespace": appliedResources[0]["namespace"],
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Resources applied successfully",
		"count":     len(appliedResources),
		"resources": appliedResources,
	})
}
