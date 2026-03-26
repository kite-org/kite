package resources

import (
	"net/http"
	"reflect"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

type GenericResourceHandler[T client.Object, V client.ObjectList] struct {
	name            string
	isClusterScoped bool
	objectType      reflect.Type
	listType        reflect.Type
	enableSearch    bool
}

func NewGenericResourceHandler[T client.Object, V client.ObjectList](
	name string,
	isClusterScoped bool,
	enableSearch bool,
) *GenericResourceHandler[T, V] {
	var obj T
	var list V

	return &GenericResourceHandler[T, V]{
		name:            name,
		isClusterScoped: isClusterScoped,
		enableSearch:    enableSearch,
		objectType:      reflect.TypeOf(obj).Elem(),
		listType:        reflect.TypeOf(list).Elem(),
	}
}

func (h *GenericResourceHandler[T, V]) ToYAML(obj T) string {
	if reflect.ValueOf(obj).IsNil() {
		return ""
	}
	obj.SetManagedFields(nil)
	yamlBytes, err := yaml.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(yamlBytes)
}

func (h *GenericResourceHandler[T, V]) getGroupKind() schema.GroupKind {
	objValue := reflect.New(h.objectType).Interface().(T)
	gvks, _, err := kube.GetScheme().ObjectKinds(objValue)
	if err != nil || len(gvks) == 0 {
		return schema.GroupKind{}
	}
	return gvks[0].GroupKind()
}

func (h *GenericResourceHandler[T, V]) recordHistory(c *gin.Context, opType string, prev, curr T, success bool, errMsg string) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	history := model.ResourceHistory{
		ClusterName:   cs.Name,
		ResourceType:  h.name,
		ResourceName:  curr.GetName(),
		Namespace:     curr.GetNamespace(),
		OperationType: opType,
		ResourceYAML:  h.ToYAML(curr),
		PreviousYAML:  h.ToYAML(prev),
		Success:       success,
		ErrorMessage:  errMsg,
		OperatorID:    user.ID,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("Failed to create resource history: %v", err)
	}
}

func (h *GenericResourceHandler[T, V]) IsClusterScoped() bool {
	return h.isClusterScoped
}

func (h *GenericResourceHandler[T, V]) Name() string {
	return h.name
}

func (h *GenericResourceHandler[T, V]) Searchable() bool {
	return h.enableSearch
}

func (h *GenericResourceHandler[T, V]) GetResource(c *gin.Context, namespace, name string) (interface{}, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	object := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		if namespace != "" && namespace != "_all" {
			namespacedName.Namespace = namespace
		}
	}
	if err := cs.K8sClient.Get(c.Request.Context(), namespacedName, object); err != nil {
		return nil, err
	}
	return object, nil
}

func (h *GenericResourceHandler[T, V]) Get(c *gin.Context) {
	object, err := h.GetResource(c, c.Param("namespace"), c.Param("name"))
	if err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	obj, err := meta.Accessor(object)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access object metadata"})
		return
	}
	obj.SetManagedFields(nil)
	anno := obj.GetAnnotations()
	if anno != nil {
		delete(anno, common.KubectlAnnotation)
	}

	c.JSON(http.StatusOK, object)
}
