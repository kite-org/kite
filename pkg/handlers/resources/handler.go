package resources

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	apiserverinternalv1alpha1 "k8s.io/api/apiserverinternal/v1alpha1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	batchv1beta1 "k8s.io/api/batch/v1beta1"
	certificatesv1 "k8s.io/api/certificates/v1"
	certificatesv1alpha1 "k8s.io/api/certificates/v1alpha1"
	certificatesv1beta1 "k8s.io/api/certificates/v1beta1"
	coordinationv1 "k8s.io/api/coordination/v1"
	coordinationv1alpha2 "k8s.io/api/coordination/v1alpha2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	discoveryv1beta1 "k8s.io/api/discovery/v1beta1"
	extensionsv1beta1 "k8s.io/api/extensions/v1beta1"
	flowcontrolv1 "k8s.io/api/flowcontrol/v1"
	flowcontrolv1beta1 "k8s.io/api/flowcontrol/v1beta1"
	flowcontrolv1beta2 "k8s.io/api/flowcontrol/v1beta2"
	flowcontrolv1beta3 "k8s.io/api/flowcontrol/v1beta3"
	networkingv1 "k8s.io/api/networking/v1"
	networkingv1beta1 "k8s.io/api/networking/v1beta1"
	nodev1 "k8s.io/api/node/v1"
	policyv1 "k8s.io/api/policy/v1"
	policyv1beta1 "k8s.io/api/policy/v1beta1"
	rbacv1 "k8s.io/api/rbac/v1"
	resourcev1 "k8s.io/api/resource/v1"
	resourcev1alpha3 "k8s.io/api/resource/v1alpha3"
	schedulingv1 "k8s.io/api/scheduling/v1"
	schedulingv1alpha2 "k8s.io/api/scheduling/v1alpha2"
	storagev1 "k8s.io/api/storage/v1"
	storagev1beta1 "k8s.io/api/storage/v1beta1"
	storagemigrationv1beta1 "k8s.io/api/storagemigration/v1beta1"
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
		string(common.Pods):       NewPodHandler(),
		string(common.Namespaces): NewGenericResourceHandler[*corev1.Namespace, *corev1.NamespaceList](common.Namespaces),
		string(common.Nodes):      NewNodeHandler(),
		string(common.Services):   NewGenericResourceHandler[*corev1.Service, *corev1.ServiceList](common.Services),
		string(common.Endpoints):  NewGenericResourceHandler[*corev1.Endpoints, *corev1.EndpointsList](common.Endpoints),
		string(common.EndpointSlices): newVersionedResourceHandler(
			newResourceVersionCandidate("discovery.k8s.io/v1", string(common.EndpointSlices), NewGenericResourceHandler[*discoveryv1.EndpointSlice, *discoveryv1.EndpointSliceList](common.EndpointSlices)),
			newResourceVersionCandidate("discovery.k8s.io/v1beta1", string(common.EndpointSlices), NewGenericResourceHandler[*discoveryv1beta1.EndpointSlice, *discoveryv1beta1.EndpointSliceList](common.EndpointSlices)),
		),
		string(common.PodTemplates):           NewGenericResourceHandler[*corev1.PodTemplate, *corev1.PodTemplateList](common.PodTemplates),
		string(common.ReplicationControllers): NewGenericResourceHandler[*corev1.ReplicationController, *corev1.ReplicationControllerList](common.ReplicationControllers),
		string(common.LimitRanges):            NewGenericResourceHandler[*corev1.LimitRange, *corev1.LimitRangeList](common.LimitRanges),
		string(common.ResourceQuotas):         NewGenericResourceHandler[*corev1.ResourceQuota, *corev1.ResourceQuotaList](common.ResourceQuotas),
		string(common.ComponentStatuses):      NewGenericResourceHandler[*corev1.ComponentStatus, *corev1.ComponentStatusList](common.ComponentStatuses),
		string(common.ConfigMaps):             NewGenericResourceHandler[*corev1.ConfigMap, *corev1.ConfigMapList](common.ConfigMaps),
		string(common.Secrets):                NewGenericResourceHandler[*corev1.Secret, *corev1.SecretList](common.Secrets),
		string(common.PersistentVolumes):      NewGenericResourceHandler[*corev1.PersistentVolume, *corev1.PersistentVolumeList](common.PersistentVolumes),
		string(common.PersistentVolumeClaims): NewGenericResourceHandler[*corev1.PersistentVolumeClaim, *corev1.PersistentVolumeClaimList](common.PersistentVolumeClaims),
		string(common.ServiceAccounts):        NewGenericResourceHandler[*corev1.ServiceAccount, *corev1.ServiceAccountList](common.ServiceAccounts),
		string(common.CRDs):                   NewGenericResourceHandler[*apiextensionsv1.CustomResourceDefinition, *apiextensionsv1.CustomResourceDefinitionList](common.CRDs),
		string(common.Events):                 NewEventHandler(),
		string(common.Deployments):            NewDeploymentHandler(),
		string(common.ReplicaSets):            NewGenericResourceHandler[*appsv1.ReplicaSet, *appsv1.ReplicaSetList](common.ReplicaSets),
		string(common.ControllerRevisions):    NewGenericResourceHandler[*appsv1.ControllerRevision, *appsv1.ControllerRevisionList](common.ControllerRevisions),
		string(common.StatefulSets):           NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](common.StatefulSets),
		string(common.DaemonSets):             NewGenericResourceHandler[*appsv1.DaemonSet, *appsv1.DaemonSetList](common.DaemonSets),
		string(common.PodDisruptionBudgets): newVersionedResourceHandler(
			newResourceVersionCandidate("policy/v1", string(common.PodDisruptionBudgets), NewGenericResourceHandler[*policyv1.PodDisruptionBudget, *policyv1.PodDisruptionBudgetList](common.PodDisruptionBudgets)),
			newResourceVersionCandidate("policy/v1beta1", string(common.PodDisruptionBudgets), NewGenericResourceHandler[*policyv1beta1.PodDisruptionBudget, *policyv1beta1.PodDisruptionBudgetList](common.PodDisruptionBudgets)),
		),
		string(common.Jobs): NewGenericResourceHandler[*batchv1.Job, *batchv1.JobList](common.Jobs),
		string(common.CronJobs): newVersionedResourceHandler(
			newResourceVersionCandidate("batch/v1", string(common.CronJobs), NewGenericResourceHandler[*batchv1.CronJob, *batchv1.CronJobList](common.CronJobs)),
			newResourceVersionCandidate("batch/v1beta1", string(common.CronJobs), NewGenericResourceHandler[*batchv1beta1.CronJob, *batchv1beta1.CronJobList](common.CronJobs)),
		),
		string(common.Ingresses): newVersionedResourceHandler(
			newResourceVersionCandidate("networking.k8s.io/v1", string(common.Ingresses), NewGenericResourceHandler[*networkingv1.Ingress, *networkingv1.IngressList](common.Ingresses)),
			newResourceVersionCandidate("networking.k8s.io/v1beta1", string(common.Ingresses), NewGenericResourceHandler[*networkingv1beta1.Ingress, *networkingv1beta1.IngressList](common.Ingresses)),
			newResourceVersionCandidate("extensions/v1beta1", string(common.Ingresses), NewGenericResourceHandler[*extensionsv1beta1.Ingress, *extensionsv1beta1.IngressList](common.Ingresses)),
		),
		string(common.NetworkPolicies): NewGenericResourceHandler[*networkingv1.NetworkPolicy, *networkingv1.NetworkPolicyList](common.NetworkPolicies),
		string(common.IngressClasses): newVersionedResourceHandler(
			newResourceVersionCandidate("networking.k8s.io/v1", string(common.IngressClasses), NewGenericResourceHandler[*networkingv1.IngressClass, *networkingv1.IngressClassList](common.IngressClasses)),
			newResourceVersionCandidate("networking.k8s.io/v1beta1", string(common.IngressClasses), NewGenericResourceHandler[*networkingv1beta1.IngressClass, *networkingv1beta1.IngressClassList](common.IngressClasses)),
		),
		string(common.IPAddresses):       NewGenericResourceHandler[*networkingv1.IPAddress, *networkingv1.IPAddressList](common.IPAddresses),
		string(common.ServiceCIDRs):      NewGenericResourceHandler[*networkingv1.ServiceCIDR, *networkingv1.ServiceCIDRList](common.ServiceCIDRs),
		string(common.StorageClasses):    NewGenericResourceHandler[*storagev1.StorageClass, *storagev1.StorageClassList](common.StorageClasses),
		string(common.VolumeAttachments): NewGenericResourceHandler[*storagev1.VolumeAttachment, *storagev1.VolumeAttachmentList](common.VolumeAttachments),
		string(common.CSIDrivers):        NewGenericResourceHandler[*storagev1.CSIDriver, *storagev1.CSIDriverList](common.CSIDrivers),
		string(common.CSINodes):          NewGenericResourceHandler[*storagev1.CSINode, *storagev1.CSINodeList](common.CSINodes),
		string(common.CSIStorageCapacities): newVersionedResourceHandler(
			newResourceVersionCandidate("storage.k8s.io/v1", string(common.CSIStorageCapacities), NewGenericResourceHandler[*storagev1.CSIStorageCapacity, *storagev1.CSIStorageCapacityList](common.CSIStorageCapacities)),
			newResourceVersionCandidate("storage.k8s.io/v1beta1", string(common.CSIStorageCapacities), NewGenericResourceHandler[*storagev1beta1.CSIStorageCapacity, *storagev1beta1.CSIStorageCapacityList](common.CSIStorageCapacities)),
		),
		string(common.VolumeAttributesClasses):    NewGenericResourceHandler[*storagev1.VolumeAttributesClass, *storagev1.VolumeAttributesClassList](common.VolumeAttributesClasses),
		string(common.Roles):                      NewGenericResourceHandler[*rbacv1.Role, *rbacv1.RoleList](common.Roles),
		string(common.RoleBindings):               NewGenericResourceHandler[*rbacv1.RoleBinding, *rbacv1.RoleBindingList](common.RoleBindings),
		string(common.ClusterRoles):               NewGenericResourceHandler[*rbacv1.ClusterRole, *rbacv1.ClusterRoleList](common.ClusterRoles),
		string(common.ClusterRoleBindings):        NewGenericResourceHandler[*rbacv1.ClusterRoleBinding, *rbacv1.ClusterRoleBindingList](common.ClusterRoleBindings),
		string(common.CertificateSigningRequests): NewGenericResourceHandler[*certificatesv1.CertificateSigningRequest, *certificatesv1.CertificateSigningRequestList](common.CertificateSigningRequests),
		string(common.ClusterTrustBundles):        NewGenericResourceHandler[*certificatesv1alpha1.ClusterTrustBundle, *certificatesv1alpha1.ClusterTrustBundleList](common.ClusterTrustBundles),
		string(common.PodCertificateRequests):     NewGenericResourceHandler[*certificatesv1beta1.PodCertificateRequest, *certificatesv1beta1.PodCertificateRequestList](common.PodCertificateRequests),
		string(common.Leases):                     NewGenericResourceHandler[*coordinationv1.Lease, *coordinationv1.LeaseList](common.Leases),
		string(common.LeaseCandidates):            NewGenericResourceHandler[*coordinationv1alpha2.LeaseCandidate, *coordinationv1alpha2.LeaseCandidateList](common.LeaseCandidates),
		string(common.RuntimeClasses):             NewGenericResourceHandler[*nodev1.RuntimeClass, *nodev1.RuntimeClassList](common.RuntimeClasses),
		string(common.PriorityClasses):            NewGenericResourceHandler[*schedulingv1.PriorityClass, *schedulingv1.PriorityClassList](common.PriorityClasses),
		string(common.Workloads):                  NewGenericResourceHandler[*schedulingv1alpha2.Workload, *schedulingv1alpha2.WorkloadList](common.Workloads),
		string(common.PodGroups):                  NewGenericResourceHandler[*schedulingv1alpha2.PodGroup, *schedulingv1alpha2.PodGroupList](common.PodGroups),
		string(common.FlowSchemas): newVersionedResourceHandler(
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1", string(common.FlowSchemas), NewGenericResourceHandler[*flowcontrolv1.FlowSchema, *flowcontrolv1.FlowSchemaList](common.FlowSchemas)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta3", string(common.FlowSchemas), NewGenericResourceHandler[*flowcontrolv1beta3.FlowSchema, *flowcontrolv1beta3.FlowSchemaList](common.FlowSchemas)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta2", string(common.FlowSchemas), NewGenericResourceHandler[*flowcontrolv1beta2.FlowSchema, *flowcontrolv1beta2.FlowSchemaList](common.FlowSchemas)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta1", string(common.FlowSchemas), NewGenericResourceHandler[*flowcontrolv1beta1.FlowSchema, *flowcontrolv1beta1.FlowSchemaList](common.FlowSchemas)),
		),
		string(common.PriorityLevelConfigurations): newVersionedResourceHandler(
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1", string(common.PriorityLevelConfigurations), NewGenericResourceHandler[*flowcontrolv1.PriorityLevelConfiguration, *flowcontrolv1.PriorityLevelConfigurationList](common.PriorityLevelConfigurations)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta3", string(common.PriorityLevelConfigurations), NewGenericResourceHandler[*flowcontrolv1beta3.PriorityLevelConfiguration, *flowcontrolv1beta3.PriorityLevelConfigurationList](common.PriorityLevelConfigurations)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta2", string(common.PriorityLevelConfigurations), NewGenericResourceHandler[*flowcontrolv1beta2.PriorityLevelConfiguration, *flowcontrolv1beta2.PriorityLevelConfigurationList](common.PriorityLevelConfigurations)),
			newResourceVersionCandidate("flowcontrol.apiserver.k8s.io/v1beta1", string(common.PriorityLevelConfigurations), NewGenericResourceHandler[*flowcontrolv1beta1.PriorityLevelConfiguration, *flowcontrolv1beta1.PriorityLevelConfigurationList](common.PriorityLevelConfigurations)),
		),
		string(common.ValidatingAdmissionPolicies):       NewGenericResourceHandler[*admissionregistrationv1.ValidatingAdmissionPolicy, *admissionregistrationv1.ValidatingAdmissionPolicyList](common.ValidatingAdmissionPolicies),
		string(common.ValidatingAdmissionPolicyBindings): NewGenericResourceHandler[*admissionregistrationv1.ValidatingAdmissionPolicyBinding, *admissionregistrationv1.ValidatingAdmissionPolicyBindingList](common.ValidatingAdmissionPolicyBindings),
		string(common.ValidatingWebhookConfigurations):   NewGenericResourceHandler[*admissionregistrationv1.ValidatingWebhookConfiguration, *admissionregistrationv1.ValidatingWebhookConfigurationList](common.ValidatingWebhookConfigurations),
		string(common.MutatingWebhookConfigurations):     NewGenericResourceHandler[*admissionregistrationv1.MutatingWebhookConfiguration, *admissionregistrationv1.MutatingWebhookConfigurationList](common.MutatingWebhookConfigurations),
		string(common.MutatingAdmissionPolicies):         NewGenericResourceHandler[*admissionregistrationv1.MutatingAdmissionPolicy, *admissionregistrationv1.MutatingAdmissionPolicyList](common.MutatingAdmissionPolicies),
		string(common.MutatingAdmissionPolicyBindings):   NewGenericResourceHandler[*admissionregistrationv1.MutatingAdmissionPolicyBinding, *admissionregistrationv1.MutatingAdmissionPolicyBindingList](common.MutatingAdmissionPolicyBindings),
		string(common.ResourceSlices):                    NewGenericResourceHandler[*resourcev1.ResourceSlice, *resourcev1.ResourceSliceList](common.ResourceSlices),
		string(common.ResourceClaims):                    NewGenericResourceHandler[*resourcev1.ResourceClaim, *resourcev1.ResourceClaimList](common.ResourceClaims),
		string(common.DeviceClasses):                     NewGenericResourceHandler[*resourcev1.DeviceClass, *resourcev1.DeviceClassList](common.DeviceClasses),
		string(common.ResourceClaimTemplates):            NewGenericResourceHandler[*resourcev1.ResourceClaimTemplate, *resourcev1.ResourceClaimTemplateList](common.ResourceClaimTemplates),
		string(common.DeviceTaintRules):                  NewGenericResourceHandler[*resourcev1alpha3.DeviceTaintRule, *resourcev1alpha3.DeviceTaintRuleList](common.DeviceTaintRules),
		string(common.ResourcePoolStatusRequests):        NewGenericResourceHandler[*resourcev1alpha3.ResourcePoolStatusRequest, *resourcev1alpha3.ResourcePoolStatusRequestList](common.ResourcePoolStatusRequests),
		string(common.StorageVersions):                   NewGenericResourceHandler[*apiserverinternalv1alpha1.StorageVersion, *apiserverinternalv1alpha1.StorageVersionList](common.StorageVersions),
		string(common.StorageVersionMigrations):          NewGenericResourceHandler[*storagemigrationv1beta1.StorageVersionMigration, *storagemigrationv1beta1.StorageVersionMigrationList](common.StorageVersionMigrations),
		string(common.PodMetrics):                        NewGenericResourceHandler[*metricsv1.PodMetrics, *metricsv1.PodMetricsList](common.PodMetrics),
		string(common.NodeMetrics):                       NewGenericResourceHandler[*metricsv1.NodeMetrics, *metricsv1.NodeMetricsList](common.NodeMetrics),
		string(common.Gateways):                          NewGenericResourceHandler[*gatewayapiv1.Gateway, *gatewayapiv1.GatewayList](common.Gateways),
		string(common.HTTPRoutes):                        NewGenericResourceHandler[*gatewayapiv1.HTTPRoute, *gatewayapiv1.HTTPRouteList](common.HTTPRoutes),
		string(common.HorizontalPodAutoscalers): newVersionedResourceHandler(
			newResourceVersionCandidate("autoscaling/v2", string(common.HorizontalPodAutoscalers), NewGenericResourceHandler[*autoscalingv2.HorizontalPodAutoscaler, *autoscalingv2.HorizontalPodAutoscalerList](common.HorizontalPodAutoscalers)),
			newResourceVersionCandidate("autoscaling/v1", string(common.HorizontalPodAutoscalers), NewGenericResourceHandler[*autoscalingv1.HorizontalPodAutoscaler, *autoscalingv1.HorizontalPodAutoscalerList](common.HorizontalPodAutoscalers)),
		),
		string(common.HelmReleases): NewHelmReleaseHandler(),
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
