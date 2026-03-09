package resources

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	gatewayapiv1 "sigs.k8s.io/gateway-api/apis/v1"
)

type resourceHandler interface {
	List(c *gin.Context)
	Get(c *gin.Context)
	Create(c *gin.Context)
	Update(c *gin.Context)
	Delete(c *gin.Context)
	Patch(c *gin.Context)

	IsClusterScoped() bool
	Searchable() bool
	Search(c *gin.Context, query string, limit int64) ([]common.SearchResult, error)

	GetResource(c *gin.Context, namespace, name string) (interface{}, error)

	registerCustomRoutes(group *gin.RouterGroup)
	ListHistory(c *gin.Context)

	Describe(c *gin.Context)
}

type Restartable interface {
	Restart(c *gin.Context, namespace, name string) error
}

var handlers = map[string]resourceHandler{}

func RegisterRoutes(group *gin.RouterGroup) {
	handlers = map[string]resourceHandler{
		"pods":                     NewPodHandler(),
		"namespaces":               NewGenericResourceHandler[*corev1.Namespace, *corev1.NamespaceList]("namespaces", true, false),
		"nodes":                    NewNodeHandler(),
		"services":                 NewGenericResourceHandler[*corev1.Service, *corev1.ServiceList]("services", false, true),
		"endpoints":                NewGenericResourceHandler[*corev1.Endpoints, *corev1.EndpointsList]("endpoints", false, false),
		"endpointslices":           NewGenericResourceHandler[*discoveryv1.EndpointSlice, *discoveryv1.EndpointSliceList]("endpointslices", false, false),
		"configmaps":               NewGenericResourceHandler[*corev1.ConfigMap, *corev1.ConfigMapList]("configmaps", false, true),
		"secrets":                  NewGenericResourceHandler[*corev1.Secret, *corev1.SecretList]("secrets", false, true),
		"persistentvolumes":        NewGenericResourceHandler[*corev1.PersistentVolume, *corev1.PersistentVolumeList]("persistentvolumes", true, true),
		"persistentvolumeclaims":   NewGenericResourceHandler[*corev1.PersistentVolumeClaim, *corev1.PersistentVolumeClaimList]("persistentvolumeclaims", false, true),
		"serviceaccounts":          NewGenericResourceHandler[*corev1.ServiceAccount, *corev1.ServiceAccountList]("serviceaccounts", false, false),
		"crds":                     NewGenericResourceHandler[*apiextensionsv1.CustomResourceDefinition, *apiextensionsv1.CustomResourceDefinitionList]("crds", true, false),
		"events":                   NewEventHandler(),
		"deployments":              NewDeploymentHandler(),
		"replicasets":              NewGenericResourceHandler[*appsv1.ReplicaSet, *appsv1.ReplicaSetList]("replicasets", false, false),
		"statefulsets":             NewStatefulSetHandler(),
		"daemonsets":               NewGenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList]("daemonsets", false, true),
		"jobs":                     NewGenericResourceHandler[*batchv1.Job, *batchv1.JobList]("jobs", false, false),
		"cronjobs":                 NewGenericResourceHandler[*batchv1.CronJob, *batchv1.CronJobList]("cronjobs", false, false),
		"ingresses":                NewGenericResourceHandler[*networkingv1.Ingress, *networkingv1.IngressList]("ingresses", false, false),
		"networkpolicies":          NewGenericResourceHandler[*networkingv1.NetworkPolicy, *networkingv1.NetworkPolicyList]("networkpolicies", false, false),
		"storageclasses":           NewGenericResourceHandler[*storagev1.StorageClass, *storagev1.StorageClassList]("storageclasses", true, false),
		"roles":                    NewGenericResourceHandler[*rbacv1.Role, *rbacv1.RoleList]("roles", false, false),
		"rolebindings":             NewGenericResourceHandler[*rbacv1.RoleBinding, *rbacv1.RoleBindingList]("rolebindings", false, false),
		"clusterroles":             NewGenericResourceHandler[*rbacv1.ClusterRole, *rbacv1.ClusterRoleList]("clusterroles", true, false),
		"clusterrolebindings":      NewGenericResourceHandler[*rbacv1.ClusterRoleBinding, *rbacv1.ClusterRoleBindingList]("clusterrolebindings", true, false),
		"podmetrics":               NewGenericResourceHandler[*metricsv1.PodMetrics, *metricsv1.PodMetricsList]("metrics.k8s.io", false, false),
		"nodemetrics":              NewGenericResourceHandler[*metricsv1.NodeMetrics, *metricsv1.NodeMetricsList]("metrics.k8s.io", false, false),
		"gateways":                 NewGenericResourceHandler[*gatewayapiv1.Gateway, *gatewayapiv1.GatewayList]("gateways", false, false),
		"httproutes":               NewGenericResourceHandler[*gatewayapiv1.HTTPRoute, *gatewayapiv1.HTTPRouteList]("httproutes", false, false),
		"horizontalpodautoscalers": NewGenericResourceHandler[*autoscalingv2.HorizontalPodAutoscaler, *autoscalingv2.HorizontalPodAutoscalerList]("horizontalpodautoscalers", false, true),
	}

	for name, handler := range handlers {
		g := group.Group("/" + name)
		handler.registerCustomRoutes(g)
		if handler.IsClusterScoped() {
			registerClusterScopeRoutes(g, handler)
		} else {
			registerNamespaceScopeRoutes(g, handler)
		}

		if handler.Searchable() {
			RegisterSearchFunc(name, handler.Search)
		}
	}

	// Register related resources route for supported resource types
	supportedRelatedResourceTypes := []string{"pods", "deployments", "statefulsets", "daemonsets", "configmaps", "secrets", "persistentvolumeclaims", "httproutes", "horizontalpodautoscalers", "services", "ingresses"}
	for _, resourceType := range supportedRelatedResourceTypes {
		if handler, exists := handlers[resourceType]; exists && !handler.IsClusterScoped() {
			g := group.Group("/" + resourceType)
			g.GET("/:namespace/:name/related", func(c *gin.Context) {
				// Set the resource type in the context for GetRelatedResources
				c.Set("resource", resourceType)
				GetRelatedResources(c)
			})
		}
	}

	crHandler := NewCRHandler()
	otherGroup := group.Group("/:crd")
	{
		otherGroup.GET("", crHandler.List)
		otherGroup.GET("/_all", crHandler.List)
		otherGroup.GET("/_all/:name", crHandler.Get)
		otherGroup.GET("/_all/:name/describe", crHandler.Describe)
		otherGroup.PUT("/_all/:name", crHandler.Update)
		otherGroup.DELETE("/_all/:name", crHandler.Delete)

		otherGroup.GET("/:namespace", crHandler.List)
		otherGroup.GET("/:namespace/:name", crHandler.Get)
		otherGroup.GET("/:namespace/:name/describe", crHandler.Describe)
		otherGroup.PUT("/:namespace/:name", crHandler.Update)
		otherGroup.DELETE("/:namespace/:name", crHandler.Delete)
	}
}

func registerClusterScopeRoutes(group *gin.RouterGroup, handler resourceHandler) {
	group.GET("", handler.List)
	group.GET("/_all", handler.List)
	group.GET("/_all/:name", handler.Get)
	group.POST("/_all", handler.Create)
	group.PUT("/_all/:name", handler.Update)
	group.DELETE("/_all/:name", handler.Delete)
	group.PATCH("/_all/:name", handler.Patch)
	group.GET("/_all/:name/history", handler.ListHistory)
	group.GET("/_all/:name/describe", handler.Describe)
}

func registerNamespaceScopeRoutes(group *gin.RouterGroup, handler resourceHandler) {
	group.GET("", handler.List)
	group.GET("/:namespace", handler.List)
	group.GET("/:namespace/:name", handler.Get)
	group.POST("/:namespace", handler.Create)
	group.PUT("/:namespace/:name", handler.Update)
	group.DELETE("/:namespace/:name", handler.Delete)
	group.PATCH("/:namespace/:name", handler.Patch)
	group.GET("/:namespace/:name/history", handler.ListHistory)
	group.GET("/:namespace/:name/describe", handler.Describe)
}

var SearchFuncs = map[string]func(c *gin.Context, query string, limit int64) ([]common.SearchResult, error){}

func RegisterSearchFunc(resourceType string, searchFunc func(c *gin.Context, query string, limit int64) ([]common.SearchResult, error)) {
	SearchFuncs[resourceType] = searchFunc
}

func GetResource(c *gin.Context, resource, namespace, name string) (interface{}, error) {
	handler, exists := handlers[resource]
	if !exists {
		cs := c.MustGet("cluster").(*cluster.ClientSet)
		ctx := c.Request.Context()
		var crd apiextensionsv1.CustomResourceDefinition
		if err := cs.K8sClient.Get(ctx, types.NamespacedName{Name: resource}, &crd); err != nil {
			return nil, fmt.Errorf("resource handler for %s not found", resource)
		}

		gvr := schema.GroupVersionResource{
			Group: crd.Spec.Group,
		}
		for _, v := range crd.Spec.Versions {
			if v.Served {
				gvr.Version = v.Name
				break
			}
		}

		cr := &unstructured.Unstructured{}
		cr.SetGroupVersionKind(schema.GroupVersionKind{
			Group:   gvr.Group,
			Version: gvr.Version,
			Kind:    crd.Spec.Names.Kind,
		})

		var namespacedName types.NamespacedName
		if crd.Spec.Scope == apiextensionsv1.NamespaceScoped {
			if namespace == "" {
				return nil, fmt.Errorf("namespace is required for namespaced custom resources")
			}
			namespacedName = types.NamespacedName{Namespace: namespace, Name: name}
		} else {
			namespacedName = types.NamespacedName{Name: name}
		}

		if err := cs.K8sClient.Get(ctx, namespacedName, cr); err != nil {
			return nil, err
		}
		return cr, nil
	}
	return handler.GetResource(c, namespace, name)
}

func GetHandler(resource string) (resourceHandler, error) {
	handler, exists := handlers[resource]
	if !exists {
		return nil, fmt.Errorf("handler for resource %s not found", resource)
	}
	return handler, nil
}
