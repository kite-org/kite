package common

import "strings"

// ResourceType is the canonical plural name for a Kubernetes resource,
// matching the form used in API URLs (e.g. /api/v1/pods).
type ResourceType string

const (
	Pods                              ResourceType = "pods"
	Namespaces                        ResourceType = "namespaces"
	Nodes                             ResourceType = "nodes"
	Services                          ResourceType = "services"
	Endpoints                         ResourceType = "endpoints"
	EndpointSlices                    ResourceType = "endpointslices"
	PodTemplates                      ResourceType = "podtemplates"
	ReplicationControllers            ResourceType = "replicationcontrollers"
	LimitRanges                       ResourceType = "limitranges"
	ResourceQuotas                    ResourceType = "resourcequotas"
	ComponentStatuses                 ResourceType = "componentstatuses"
	ConfigMaps                        ResourceType = "configmaps"
	Secrets                           ResourceType = "secrets"
	PersistentVolumes                 ResourceType = "persistentvolumes"
	PersistentVolumeClaims            ResourceType = "persistentvolumeclaims"
	ServiceAccounts                   ResourceType = "serviceaccounts"
	CRDs                              ResourceType = "crds"
	Events                            ResourceType = "events"
	Deployments                       ResourceType = "deployments"
	ReplicaSets                       ResourceType = "replicasets"
	ControllerRevisions               ResourceType = "controllerrevisions"
	StatefulSets                      ResourceType = "statefulsets"
	DaemonSets                        ResourceType = "daemonsets"
	PodDisruptionBudgets              ResourceType = "poddisruptionbudgets"
	Jobs                              ResourceType = "jobs"
	CronJobs                          ResourceType = "cronjobs"
	Ingresses                         ResourceType = "ingresses"
	NetworkPolicies                   ResourceType = "networkpolicies"
	IngressClasses                    ResourceType = "ingressclasses"
	IPAddresses                       ResourceType = "ipaddresses"
	ServiceCIDRs                      ResourceType = "servicecidrs"
	StorageClasses                    ResourceType = "storageclasses"
	VolumeAttachments                 ResourceType = "volumeattachments"
	CSIDrivers                        ResourceType = "csidrivers"
	CSINodes                          ResourceType = "csinodes"
	CSIStorageCapacities              ResourceType = "csistoragecapacities"
	VolumeAttributesClasses           ResourceType = "volumeattributesclasses"
	Roles                             ResourceType = "roles"
	RoleBindings                      ResourceType = "rolebindings"
	ClusterRoles                      ResourceType = "clusterroles"
	ClusterRoleBindings               ResourceType = "clusterrolebindings"
	CertificateSigningRequests        ResourceType = "certificatesigningrequests"
	ClusterTrustBundles               ResourceType = "clustertrustbundles"
	PodCertificateRequests            ResourceType = "podcertificaterequests"
	Leases                            ResourceType = "leases"
	LeaseCandidates                   ResourceType = "leasecandidates"
	RuntimeClasses                    ResourceType = "runtimeclasses"
	PriorityClasses                   ResourceType = "priorityclasses"
	FlowSchemas                       ResourceType = "flowschemas"
	PriorityLevelConfigurations       ResourceType = "prioritylevelconfigurations"
	ValidatingAdmissionPolicies       ResourceType = "validatingadmissionpolicies"
	ValidatingAdmissionPolicyBindings ResourceType = "validatingadmissionpolicybindings"
	ValidatingWebhookConfigurations   ResourceType = "validatingwebhookconfigurations"
	MutatingWebhookConfigurations     ResourceType = "mutatingwebhookconfigurations"
	MutatingAdmissionPolicies         ResourceType = "mutatingadmissionpolicies"
	MutatingAdmissionPolicyBindings   ResourceType = "mutatingadmissionpolicybindings"
	ResourceSlices                    ResourceType = "resourceslices"
	ResourceClaims                    ResourceType = "resourceclaims"
	DeviceClasses                     ResourceType = "deviceclasses"
	ResourceClaimTemplates            ResourceType = "resourceclaimtemplates"
	DeviceTaintRules                  ResourceType = "devicetaintrules"
	ResourcePoolStatusRequests        ResourceType = "resourcepoolstatusrequests"
	StorageVersions                   ResourceType = "storageversions"
	StorageVersionMigrations          ResourceType = "storageversionmigrations"
	Workloads                         ResourceType = "workloads"
	PodGroups                         ResourceType = "podgroups"
	PodMetrics                        ResourceType = "podmetrics"
	NodeMetrics                       ResourceType = "nodemetrics"
	Gateways                          ResourceType = "gateways"
	HTTPRoutes                        ResourceType = "httproutes"
	HorizontalPodAutoscalers          ResourceType = "horizontalpodautoscalers"
	HelmReleases                      ResourceType = "helmrelease"
)

// ResourceMeta holds all metadata for a known Kubernetes resource type.
// Adding support for a new resource requires only one entry here.
type ResourceMeta struct {
	Kind          string       // e.g. "Pod"
	Singular      string       // e.g. "pod"
	Plural        ResourceType // e.g. "pods" — canonical form used in URLs
	Short         []string     // e.g. ["po"]
	Group         string       // e.g. "" (core), "apps", "batch"
	Version       string       // e.g. "v1"
	ClusterScoped bool
	Searchable    bool // whether this resource participates in global search and aliases
	Related       bool // whether this resource exposes the related-resources API
}

// Registry is the single source of truth for all known resource types.
var Registry = []ResourceMeta{
	// Core v1
	{Kind: "Pod", Singular: "pod", Plural: Pods, Short: []string{"po"}, Version: "v1", Searchable: true, Related: true},
	{Kind: "Namespace", Singular: "namespace", Plural: Namespaces, Short: []string{"ns"}, Version: "v1", ClusterScoped: true},
	{Kind: "Node", Singular: "node", Plural: Nodes, Version: "v1", ClusterScoped: true, Searchable: true},
	{Kind: "Service", Singular: "service", Plural: Services, Short: []string{"svc"}, Version: "v1", Searchable: true, Related: true},
	{Kind: "Endpoints", Singular: "endpoints", Plural: Endpoints, Short: []string{"ep"}, Version: "v1"},
	{Kind: "EndpointSlice", Singular: "endpointslice", Plural: EndpointSlices, Version: "v1", Group: "discovery.k8s.io"},
	{Kind: "PodTemplate", Singular: "podtemplate", Plural: PodTemplates, Version: "v1"},
	{Kind: "ReplicationController", Singular: "replicationcontroller", Plural: ReplicationControllers, Short: []string{"rc"}, Version: "v1"},
	{Kind: "LimitRange", Singular: "limitrange", Plural: LimitRanges, Short: []string{"limits"}, Version: "v1"},
	{Kind: "ResourceQuota", Singular: "resourcequota", Plural: ResourceQuotas, Short: []string{"quota"}, Version: "v1"},
	{Kind: "ComponentStatus", Singular: "componentstatus", Plural: ComponentStatuses, Short: []string{"cs"}, Version: "v1", ClusterScoped: true},
	{Kind: "ConfigMap", Singular: "configmap", Plural: ConfigMaps, Short: []string{"cm"}, Version: "v1", Searchable: true, Related: true},
	{Kind: "Secret", Singular: "secret", Plural: Secrets, Version: "v1", Searchable: true, Related: true},
	{Kind: "PersistentVolume", Singular: "persistentvolume", Plural: PersistentVolumes, Short: []string{"pv"}, Version: "v1", ClusterScoped: true, Searchable: true},
	{Kind: "PersistentVolumeClaim", Singular: "persistentvolumeclaim", Plural: PersistentVolumeClaims, Short: []string{"pvc"}, Version: "v1", Searchable: true, Related: true},
	{Kind: "ServiceAccount", Singular: "serviceaccount", Plural: ServiceAccounts, Short: []string{"sa"}, Version: "v1"},
	{Kind: "Event", Singular: "event", Plural: Events, Short: []string{"ev"}, Version: "v1"},

	// apps/v1
	{Kind: "Deployment", Singular: "deployment", Plural: Deployments, Short: []string{"deploy", "dep"}, Group: "apps", Version: "v1", Searchable: true, Related: true},
	{Kind: "ReplicaSet", Singular: "replicaset", Plural: ReplicaSets, Short: []string{"rs"}, Group: "apps", Version: "v1"},
	{Kind: "ControllerRevision", Singular: "controllerrevision", Plural: ControllerRevisions, Group: "apps", Version: "v1"},
	{Kind: "StatefulSet", Singular: "statefulset", Plural: StatefulSets, Short: []string{"sts"}, Group: "apps", Version: "v1", Searchable: true, Related: true},
	{Kind: "DaemonSet", Singular: "daemonset", Plural: DaemonSets, Short: []string{"ds"}, Group: "apps", Version: "v1", Searchable: true, Related: true},

	// policy/v1
	{Kind: "PodDisruptionBudget", Singular: "poddisruptionbudget", Plural: PodDisruptionBudgets, Short: []string{"pdb"}, Group: "policy", Version: "v1", Searchable: true, Related: true},

	// batch/v1
	{Kind: "Job", Singular: "job", Plural: Jobs, Group: "batch", Version: "v1", Searchable: true},
	{Kind: "CronJob", Singular: "cronjob", Plural: CronJobs, Short: []string{"cj"}, Group: "batch", Version: "v1", Searchable: true},

	// networking.k8s.io/v1
	{Kind: "Ingress", Singular: "ingress", Plural: Ingresses, Short: []string{"ing"}, Group: "networking.k8s.io", Version: "v1", Related: true},
	{Kind: "NetworkPolicy", Singular: "networkpolicy", Plural: NetworkPolicies, Short: []string{"netpol"}, Group: "networking.k8s.io", Version: "v1"},
	{Kind: "IngressClass", Singular: "ingressclass", Plural: IngressClasses, Group: "networking.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "IPAddress", Singular: "ipaddress", Plural: IPAddresses, Group: "networking.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ServiceCIDR", Singular: "servicecidr", Plural: ServiceCIDRs, Group: "networking.k8s.io", Version: "v1", ClusterScoped: true},

	// storage.k8s.io/v1
	{Kind: "StorageClass", Singular: "storageclass", Plural: StorageClasses, Short: []string{"sc"}, Group: "storage.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "VolumeAttachment", Singular: "volumeattachment", Plural: VolumeAttachments, Group: "storage.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "CSIDriver", Singular: "csidriver", Plural: CSIDrivers, Group: "storage.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "CSINode", Singular: "csinode", Plural: CSINodes, Group: "storage.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "CSIStorageCapacity", Singular: "csistoragecapacity", Plural: CSIStorageCapacities, Group: "storage.k8s.io", Version: "v1"},
	{Kind: "VolumeAttributesClass", Singular: "volumeattributesclass", Plural: VolumeAttributesClasses, Group: "storage.k8s.io", Version: "v1", ClusterScoped: true},

	// rbac.authorization.k8s.io/v1
	{Kind: "Role", Singular: "role", Plural: Roles, Group: "rbac.authorization.k8s.io", Version: "v1"},
	{Kind: "RoleBinding", Singular: "rolebinding", Plural: RoleBindings, Group: "rbac.authorization.k8s.io", Version: "v1"},
	{Kind: "ClusterRole", Singular: "clusterrole", Plural: ClusterRoles, Group: "rbac.authorization.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ClusterRoleBinding", Singular: "clusterrolebinding", Plural: ClusterRoleBindings, Group: "rbac.authorization.k8s.io", Version: "v1", ClusterScoped: true},

	// certificates.k8s.io
	{Kind: "CertificateSigningRequest", Singular: "certificatesigningrequest", Plural: CertificateSigningRequests, Short: []string{"csr"}, Group: "certificates.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ClusterTrustBundle", Singular: "clustertrustbundle", Plural: ClusterTrustBundles, Group: "certificates.k8s.io", Version: "v1alpha1", ClusterScoped: true},
	{Kind: "PodCertificateRequest", Singular: "podcertificaterequest", Plural: PodCertificateRequests, Group: "certificates.k8s.io", Version: "v1beta1"},

	// coordination.k8s.io
	{Kind: "Lease", Singular: "lease", Plural: Leases, Group: "coordination.k8s.io", Version: "v1"},
	{Kind: "LeaseCandidate", Singular: "leasecandidate", Plural: LeaseCandidates, Group: "coordination.k8s.io", Version: "v1alpha2"},

	// node.k8s.io
	{Kind: "RuntimeClass", Singular: "runtimeclass", Plural: RuntimeClasses, Group: "node.k8s.io", Version: "v1", ClusterScoped: true},

	// scheduling.k8s.io
	{Kind: "PriorityClass", Singular: "priorityclass", Plural: PriorityClasses, Short: []string{"pc"}, Group: "scheduling.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "Workload", Singular: "workload", Plural: Workloads, Group: "scheduling.k8s.io", Version: "v1alpha2"},
	{Kind: "PodGroup", Singular: "podgroup", Plural: PodGroups, Group: "scheduling.k8s.io", Version: "v1alpha2"},

	// flowcontrol.apiserver.k8s.io/v1
	{Kind: "FlowSchema", Singular: "flowschema", Plural: FlowSchemas, Group: "flowcontrol.apiserver.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "PriorityLevelConfiguration", Singular: "prioritylevelconfiguration", Plural: PriorityLevelConfigurations, Group: "flowcontrol.apiserver.k8s.io", Version: "v1", ClusterScoped: true},

	// admissionregistration.k8s.io/v1
	{Kind: "ValidatingAdmissionPolicy", Singular: "validatingadmissionpolicy", Plural: ValidatingAdmissionPolicies, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ValidatingAdmissionPolicyBinding", Singular: "validatingadmissionpolicybinding", Plural: ValidatingAdmissionPolicyBindings, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ValidatingWebhookConfiguration", Singular: "validatingwebhookconfiguration", Plural: ValidatingWebhookConfigurations, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "MutatingWebhookConfiguration", Singular: "mutatingwebhookconfiguration", Plural: MutatingWebhookConfigurations, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "MutatingAdmissionPolicy", Singular: "mutatingadmissionpolicy", Plural: MutatingAdmissionPolicies, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "MutatingAdmissionPolicyBinding", Singular: "mutatingadmissionpolicybinding", Plural: MutatingAdmissionPolicyBindings, Group: "admissionregistration.k8s.io", Version: "v1", ClusterScoped: true},

	// resource.k8s.io
	{Kind: "ResourceSlice", Singular: "resourceslice", Plural: ResourceSlices, Group: "resource.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ResourceClaim", Singular: "resourceclaim", Plural: ResourceClaims, Group: "resource.k8s.io", Version: "v1"},
	{Kind: "DeviceClass", Singular: "deviceclass", Plural: DeviceClasses, Group: "resource.k8s.io", Version: "v1", ClusterScoped: true},
	{Kind: "ResourceClaimTemplate", Singular: "resourceclaimtemplate", Plural: ResourceClaimTemplates, Group: "resource.k8s.io", Version: "v1"},
	{Kind: "DeviceTaintRule", Singular: "devicetaintrule", Plural: DeviceTaintRules, Group: "resource.k8s.io", Version: "v1alpha3", ClusterScoped: true},
	{Kind: "ResourcePoolStatusRequest", Singular: "resourcepoolstatusrequest", Plural: ResourcePoolStatusRequests, Group: "resource.k8s.io", Version: "v1alpha3", ClusterScoped: true},

	// apiserverinternal.k8s.io
	{Kind: "StorageVersion", Singular: "storageversion", Plural: StorageVersions, Group: "internal.apiserver.k8s.io", Version: "v1alpha1", ClusterScoped: true},

	// storagemigration.k8s.io
	{Kind: "StorageVersionMigration", Singular: "storageversionmigration", Plural: StorageVersionMigrations, Group: "storagemigration.k8s.io", Version: "v1beta1", ClusterScoped: true},

	// apiextensions.k8s.io/v1
	{Kind: "CustomResourceDefinition", Singular: "customresourcedefinition", Plural: "customresourcedefinitions", Short: []string{"crd", "crds"}, Group: "apiextensions.k8s.io", Version: "v1", ClusterScoped: true},

	// metrics.k8s.io/v1beta1
	{Kind: "PodMetrics", Singular: "podmetrics", Plural: PodMetrics, Group: "metrics.k8s.io", Version: "v1beta1"},
	{Kind: "NodeMetrics", Singular: "nodemetrics", Plural: NodeMetrics, Group: "metrics.k8s.io", Version: "v1beta1"},

	// gateway.networking.k8s.io/v1
	{Kind: "Gateway", Singular: "gateway", Plural: Gateways, Group: "gateway.networking.k8s.io", Version: "v1"},
	{Kind: "HTTPRoute", Singular: "httproute", Plural: HTTPRoutes, Group: "gateway.networking.k8s.io", Version: "v1", Related: true},

	// autoscaling/v2
	{Kind: "HorizontalPodAutoscaler", Singular: "horizontalpodautoscaler", Plural: HorizontalPodAutoscalers, Short: []string{"hpa"}, Group: "autoscaling", Version: "v2", Searchable: true, Related: true},

	// Synthetic resources
	{Kind: "HelmRelease", Singular: "helmrelease", Plural: HelmReleases, Short: []string{"hr"}, Version: "v1"},
}

// resourceIndex maps lowercase alias → *ResourceMeta for O(1) lookups.
// Built once at init time from Registry.
var resourceIndex map[string]*ResourceMeta

func init() {
	resourceIndex = make(map[string]*ResourceMeta, len(Registry)*3)
	for i := range Registry {
		m := &Registry[i]
		resourceIndex[strings.ToLower(m.Kind)] = m
		resourceIndex[m.Singular] = m
		resourceIndex[string(m.Plural)] = m
		for _, s := range m.Short {
			resourceIndex[s] = m
		}
	}
}

// LookupResource finds a ResourceMeta by any alias (kind, singular, plural, or short name).
// Returns nil if not found.
func LookupResource(alias string) *ResourceMeta {
	return resourceIndex[strings.ToLower(strings.TrimSpace(alias))]
}

func MustLookupResource(alias string) *ResourceMeta {
	resource := LookupResource(alias)
	if resource == nil {
		panic("resource metadata not found: " + alias)
	}
	return resource
}

// SearchAliases builds the alias→plural map used by the search subsystem.
// Only resources with Searchable=true are included.
func SearchAliases() map[string]string {
	m := make(map[string]string)
	for i := range Registry {
		r := &Registry[i]
		if !r.Searchable {
			continue
		}
		m[r.Singular] = string(r.Plural)
		m[string(r.Plural)] = string(r.Plural)
		for _, s := range r.Short {
			m[s] = string(r.Plural)
		}
	}
	return m
}

func RelatedResourceTypes() []string {
	resourceTypes := make([]string, 0)
	for i := range Registry {
		if Registry[i].Related {
			resourceTypes = append(resourceTypes, string(Registry[i].Plural))
		}
	}
	return resourceTypes
}
