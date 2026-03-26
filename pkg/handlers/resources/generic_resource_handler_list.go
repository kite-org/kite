package resources

import (
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func (h *GenericResourceHandler[T, V]) list(c *gin.Context) (V, error) {
	var zero V
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	objectList := reflect.New(h.listType).Interface().(V)

	ctx := c.Request.Context()

	var listOpts []client.ListOption
	namespace := c.Param("namespace")
	if !h.isClusterScoped {
		if namespace != "" && namespace != "_all" {
			listOpts = append(listOpts, client.InNamespace(namespace))
		}
	}
	if c.Query("limit") != "" {
		limit, err := strconv.ParseInt(c.Query("limit"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit parameter"})
			return zero, err
		}
		listOpts = append(listOpts, client.Limit(limit))
	}

	if c.Query("continue") != "" {
		continueToken := c.Query("continue")
		listOpts = append(listOpts, client.Continue(continueToken))
	}

	if c.Query("labelSelector") != "" {
		labelSelector := c.Query("labelSelector")
		selector, err := metav1.ParseToLabelSelector(labelSelector)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid labelSelector parameter: " + err.Error()})
			return zero, err
		}
		labelSelectorOption, err := metav1.LabelSelectorAsSelector(selector)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to convert labelSelector: " + err.Error()})
			return zero, err
		}
		listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labelSelectorOption})
	}

	if c.Query("fieldSelector") != "" {
		fieldSelector := c.Query("fieldSelector")
		fieldSelectorOption, err := fields.ParseSelector(fieldSelector)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid fieldSelector parameter: " + err.Error()})
			return zero, err
		}
		listOpts = append(listOpts, client.MatchingFieldsSelector{Selector: fieldSelectorOption})
	}

	if err := cs.K8sClient.List(ctx, objectList, listOpts...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return zero, err
	}

	items, err := meta.ExtractList(objectList)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to extract items from list"})
		return zero, err
	}
	sort.Slice(items, func(i, j int) bool {
		o1, _ := meta.Accessor(items[i])
		o2, _ := meta.Accessor(items[j])
		if o1 == nil || o2 == nil {
			return false
		}

		t1 := o1.GetCreationTimestamp()
		t2 := o2.GetCreationTimestamp()
		if t1.Equal(&t2) {
			return o1.GetName() < o2.GetName()
		}

		return t1.After(t2.Time)
	})

	user := c.MustGet("user").(model.User)
	filterItems := make([]runtime.Object, 0, len(items))
	for i := range items {
		obj, err := meta.Accessor(items[i])
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access object metadata"})
			return zero, err
		}
		obj.SetManagedFields(nil)
		anno := obj.GetAnnotations()
		if anno != nil {
			delete(anno, common.KubectlAnnotation)
		}
		if h.Name() == "namespaces" && !rbac.CanAccessNamespace(user, cs.Name, obj.GetName()) {
			continue
		}
		if namespace == "_all" && obj.GetNamespace() != "" && !rbac.CanAccessNamespace(user, cs.Name, obj.GetNamespace()) {
			continue
		}
		filterItems = append(filterItems, items[i])
	}
	_ = meta.SetList(objectList, filterItems)

	return objectList, nil
}

func (h *GenericResourceHandler[T, V]) List(c *gin.Context) {
	object, err := h.list(c)
	if err != nil {
		return
	}
	c.JSON(http.StatusOK, object)
}

func (h *GenericResourceHandler[T, V]) Search(c *gin.Context, q string, limit int64) ([]common.SearchResult, error) {
	if !h.enableSearch || len(q) < 3 {
		return nil, nil
	}
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	ctx := c.Request.Context()
	objectList := reflect.New(h.listType).Interface().(V)
	var listOpts []client.ListOption
	if idx := strings.Index(q, ":"); idx > 0 {
		labelKey := strings.TrimSpace(q[:idx])
		labelValue := strings.TrimSpace(q[idx+1:])
		listOpts = append(listOpts, client.MatchingLabels{labelKey: labelValue})
	} else if idx := strings.Index(q, "="); idx > 0 {
		labelKey := strings.TrimSpace(q[:idx])
		labelValue := strings.TrimSpace(q[idx+1:])
		listOpts = append(listOpts, client.MatchingLabels{labelKey: labelValue})
	}
	if err := cs.K8sClient.List(ctx, objectList, listOpts...); err != nil {
		klog.Errorf("failed to list %s: %v", h.name, err)
		return nil, err
	}
	isLabelSearch := strings.Contains(q, ":") || strings.Contains(q, "=")
	items, err := meta.ExtractList(objectList)
	if err != nil {
		klog.Errorf("failed to extract items from list: %v", err)
		return nil, err
	}

	results := make([]common.SearchResult, 0, limit)

	for _, item := range items {
		obj, ok := item.(client.Object)
		if !ok {
			klog.Errorf("item is not a client.Object: %v", item)
			continue
		}
		if !isLabelSearch && !strings.Contains(strings.ToLower(obj.GetName()), strings.ToLower(q)) {
			continue
		}
		result := common.SearchResult{
			ID:           string(obj.GetUID()),
			Name:         obj.GetName(),
			Namespace:    obj.GetNamespace(),
			ResourceType: h.name,
			CreatedAt:    obj.GetCreationTimestamp().String(),
		}
		results = append(results, result)
		if limit > 0 && int64(len(results)) >= limit {
			break
		}
	}

	return results, nil
}
