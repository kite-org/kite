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
	policyv1 "k8s.io/api/policy/v1"
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
		string(common.Pods):                     NewPodHandler(),
		string(common.Namespaces):               NewGenericResourceHandler[*corev1.Namespace, *corev1.NamespaceList](common.Namespaces),
		string(common.Nodes):                    NewNodeHandler(),
		string(common.Services):                 NewGenericResourceHandler[*corev1.Service, *corev1.ServiceList](common.Services),
		string(common.Endpoints):                NewGenericResourceHandler[*corev1.Endpoints, *corev1.EndpointsList](common.Endpoints),
		string(common.EndpointSlices):           NewGenericResourceHandler[*discoveryv1.EndpointSlice, *discoveryv1.EndpointSliceList](common.EndpointSlices),
		string(common.ConfigMaps):               NewGenericResourceHandler[*corev1.ConfigMap, *corev1.ConfigMapList](common.ConfigMaps),
		string(common.Secrets):                  NewGenericResourceHandler[*corev1.Secret, *corev1.SecretList](common.Secrets),
		string(common.PersistentVolumes):        NewGenericResourceHandler[*corev1.PersistentVolume, *corev1.PersistentVolumeList](common.PersistentVolumes),
		string(common.PersistentVolumeClaims):   NewGenericResourceHandler[*corev1.PersistentVolumeClaim, *corev1.PersistentVolumeClaimList](common.PersistentVolumeClaims),
		string(common.ServiceAccounts):          NewGenericResourceHandler[*corev1.ServiceAccount, *corev1.ServiceAccountList](common.ServiceAccounts),
		string(common.CRDs):                     NewGenericResourceHandler[*apiextensionsv1.CustomResourceDefinition, *apiextensionsv1.CustomResourceDefinitionList](common.CRDs),
		string(common.Events):                   NewEventHandler(),
		string(common.Deployments):              NewDeploymentHandler(),
		string(common.ReplicaSets):              NewGenericResourceHandler[*appsv1.ReplicaSet, *appsv1.ReplicaSetList](common.ReplicaSets),
		string(common.StatefulSets):             NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](common.StatefulSets),
		string(common.DaemonSets):               NewGenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList](common.DaemonSets),
		string(common.PodDisruptionBudgets):     NewGenericResourceHandler[*policyv1.PodDisruptionBudget, *policyv1.PodDisruptionBudgetList](common.PodDisruptionBudgets),
		string(common.Jobs):                     NewGenericResourceHandler[*batchv1.Job, *batchv1.JobList](common.Jobs),
		string(common.CronJobs):                 NewGenericResourceHandler[*batchv1.CronJob, *batchv1.CronJobList](common.CronJobs),
		string(common.Ingresses):                NewGenericResourceHandler[*networkingv1.Ingress, *networkingv1.IngressList](common.Ingresses),
		string(common.NetworkPolicies):          NewGenericResourceHandler[*networkingv1.NetworkPolicy, *networkingv1.NetworkPolicyList](common.NetworkPolicies),
		string(common.StorageClasses):           NewGenericResourceHandler[*storagev1.StorageClass, *storagev1.StorageClassList](common.StorageClasses),
		string(common.Roles):                    NewGenericResourceHandler[*rbacv1.Role, *rbacv1.RoleList](common.Roles),
		string(common.RoleBindings):             NewGenericResourceHandler[*rbacv1.RoleBinding, *rbacv1.RoleBindingList](common.RoleBindings),
		string(common.ClusterRoles):             NewGenericResourceHandler[*rbacv1.ClusterRole, *rbacv1.ClusterRoleList](common.ClusterRoles),
		string(common.ClusterRoleBindings):      NewGenericResourceHandler[*rbacv1.ClusterRoleBinding, *rbacv1.ClusterRoleBindingList](common.ClusterRoleBindings),
		string(common.PodMetrics):               NewGenericResourceHandler[*metricsv1.PodMetrics, *metricsv1.PodMetricsList](common.PodMetrics),
		string(common.NodeMetrics):              NewGenericResourceHandler[*metricsv1.NodeMetrics, *metricsv1.NodeMetricsList](common.NodeMetrics),
		string(common.Gateways):                 NewGenericResourceHandler[*gatewayapiv1.Gateway, *gatewayapiv1.GatewayList](common.Gateways),
		string(common.HTTPRoutes):               NewGenericResourceHandler[*gatewayapiv1.HTTPRoute, *gatewayapiv1.HTTPRouteList](common.HTTPRoutes),
		string(common.HorizontalPodAutoscalers): NewGenericResourceHandler[*autoscalingv2.HorizontalPodAutoscaler, *autoscalingv2.HorizontalPodAutoscalerList](common.HorizontalPodAutoscalers),
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

	for _, resourceType := range common.RelatedResourceTypes() {
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
