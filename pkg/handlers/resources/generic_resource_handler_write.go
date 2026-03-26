package resources

import (
	"context"
	"net/http"
	"reflect"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/kube"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func (h *GenericResourceHandler[T, V]) Create(c *gin.Context) {
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := c.ShouldBindJSON(resource); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()

	var success bool
	var errMsg string
	var empty T
	defer func() {
		h.recordHistory(c, "create", empty, resource, success, errMsg)
	}()

	if err := cs.K8sClient.Create(ctx, resource); err != nil {
		success, errMsg = false, err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusCreated, resource)
}

func (h *GenericResourceHandler[T, V]) Update(c *gin.Context) {
	name := c.Param("name")
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := c.ShouldBindJSON(resource); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	oldObj := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name, Namespace: c.Param("namespace")}
	if h.isClusterScoped {
		namespacedName = types.NamespacedName{Name: name}
	}
	if err := cs.K8sClient.Get(c.Request.Context(), namespacedName, oldObj); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var success bool
	var errMsg string
	defer func() {
		h.recordHistory(c, "update", oldObj, resource, success, errMsg)
	}()

	resource.SetName(name)
	if !h.isClusterScoped {
		namespace := c.Param("namespace")
		if namespace != "" && namespace != "_all" {
			resource.SetNamespace(namespace)
		}
	}

	ctx := c.Request.Context()
	if err := cs.K8sClient.Update(ctx, resource); err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusOK, resource)
}

func (h *GenericResourceHandler[T, V]) Patch(c *gin.Context) {
	name := c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	patchBytes, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read patch data"})
		return
	}

	patchType := types.StrategicMergePatchType
	if c.Query("patchType") == "merge" {
		patchType = types.MergePatchType
	} else if c.Query("patchType") == "json" {
		patchType = types.JSONPatchType
	}

	oldObj := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		namespace := c.Param("namespace")
		if namespace != "" && namespace != "_all" {
			namespacedName.Namespace = namespace
		}
	}
	ctx := c.Request.Context()
	if err := cs.K8sClient.Get(ctx, namespacedName, oldObj); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	prevObj := oldObj.DeepCopyObject().(T)

	success := false
	var errMsg string
	defer func() {
		h.recordHistory(c, "patch", prevObj, oldObj, success, errMsg)
	}()

	patch := client.RawPatch(patchType, patchBytes)
	if err := cs.K8sClient.Patch(ctx, oldObj, patch); err != nil {
		errMsg = err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusOK, oldObj)
}

func (h *GenericResourceHandler[T, V]) Delete(c *gin.Context) {
	name := c.Param("name")
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		namespace := c.Param("namespace")
		if namespace != "" && namespace != "_all" {
			namespacedName.Namespace = namespace
		}
	}

	ctx := c.Request.Context()
	if err := cs.K8sClient.Get(ctx, namespacedName, resource); err != nil {
		if client.IgnoreNotFound(err) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cascadeDelete := c.Query("cascade") != "false"
	forceDelete := c.Query("force") == "true"
	wait := c.Query("wait") != "false"

	deleteOptions := &client.DeleteOptions{}
	if cascadeDelete {
		propagationPolicy := metav1.DeletePropagationForeground
		deleteOptions.PropagationPolicy = &propagationPolicy
	} else {
		propagationPolicy := metav1.DeletePropagationOrphan
		deleteOptions.PropagationPolicy = &propagationPolicy
	}

	if forceDelete {
		gracePeriodSeconds := int64(0)
		deleteOptions.GracePeriodSeconds = &gracePeriodSeconds
	}
	if err := cs.K8sClient.Delete(ctx, resource, deleteOptions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if wait {
		timeout := 1 * time.Minute
		if forceDelete {
			timeout = 3 * time.Second
		}
		err := kube.WaitForResourceDeletion(ctx, cs.K8sClient, resource, timeout)
		if err != nil {
			if forceDelete {
				klog.Infof("Force deleting resource %s/%s timed out, will attempt to remove finalizers", resource.GetNamespace(), resource.GetName())
				patch := client.MergeFrom(resource.DeepCopyObject().(T))
				resource.SetFinalizers([]string{})
				if err := cs.K8sClient.Patch(context.Background(), resource, patch); err != nil {
					klog.Errorf("Failed to remove finalizers: %v", err)
				}
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted successfully"})
}
