interface ResourceMetadataBase {
  singular: string
  singularLabel: string
  pluralLabel: string
  shortLabel?: string
  clusterScope: boolean
}

export const resourceMetadataList = [
  {
    type: 'pods',
    singular: 'pod',
    singularLabel: 'Pod',
    pluralLabel: 'Pods',
    clusterScope: false,
  },
  {
    type: 'deployments',
    singular: 'deployment',
    singularLabel: 'Deployment',
    pluralLabel: 'Deployments',
    shortLabel: 'Deploy',
    clusterScope: false,
  },
  {
    type: 'statefulsets',
    singular: 'statefulset',
    singularLabel: 'StatefulSet',
    pluralLabel: 'StatefulSets',
    shortLabel: 'STS',
    clusterScope: false,
  },
  {
    type: 'daemonsets',
    singular: 'daemonset',
    singularLabel: 'DaemonSet',
    pluralLabel: 'DaemonSets',
    shortLabel: 'Daemon',
    clusterScope: false,
  },
  {
    type: 'jobs',
    singular: 'job',
    singularLabel: 'Job',
    pluralLabel: 'Jobs',
    shortLabel: 'Job',
    clusterScope: false,
  },
  {
    type: 'cronjobs',
    singular: 'cronjob',
    singularLabel: 'CronJob',
    pluralLabel: 'CronJobs',
    clusterScope: false,
  },
  {
    type: 'services',
    singular: 'service',
    singularLabel: 'Service',
    pluralLabel: 'Services',
    clusterScope: false,
  },
  {
    type: 'gateways',
    singular: 'gateway',
    singularLabel: 'Gateway',
    pluralLabel: 'Gateways',
    clusterScope: false,
  },
  {
    type: 'httproutes',
    singular: 'httproute',
    singularLabel: 'HTTPRoute',
    pluralLabel: 'HTTPRoutes',
    clusterScope: false,
  },
  {
    type: 'configmaps',
    singular: 'configmap',
    singularLabel: 'ConfigMap',
    pluralLabel: 'ConfigMaps',
    clusterScope: false,
  },
  {
    type: 'secrets',
    singular: 'secret',
    singularLabel: 'Secret',
    pluralLabel: 'Secrets',
    clusterScope: false,
  },
  {
    type: 'ingresses',
    singular: 'ingress',
    singularLabel: 'Ingress',
    pluralLabel: 'Ingresses',
    clusterScope: false,
  },
  {
    type: 'networkpolicies',
    singular: 'networkpolicy',
    singularLabel: 'NetworkPolicy',
    pluralLabel: 'NetworkPolicies',
    clusterScope: false,
  },
  {
    type: 'namespaces',
    singular: 'namespace',
    singularLabel: 'Namespace',
    pluralLabel: 'Namespaces',
    clusterScope: true,
  },
  {
    type: 'crds',
    singular: 'crd',
    singularLabel: 'CRD',
    pluralLabel: 'CRDs',
    clusterScope: true,
  },
  {
    type: 'crs',
    singular: 'custom resource',
    singularLabel: 'Custom Resource',
    pluralLabel: 'Custom Resources',
    clusterScope: false,
  },
  {
    type: 'nodes',
    singular: 'node',
    singularLabel: 'Node',
    pluralLabel: 'Nodes',
    clusterScope: true,
  },
  {
    type: 'events',
    singular: 'event',
    singularLabel: 'Event',
    pluralLabel: 'Events',
    clusterScope: false,
  },
  {
    type: 'persistentvolumes',
    singular: 'persistentvolume',
    singularLabel: 'PersistentVolume',
    pluralLabel: 'PersistentVolumes',
    shortLabel: 'PV',
    clusterScope: true,
  },
  {
    type: 'persistentvolumeclaims',
    singular: 'persistentvolumeclaim',
    singularLabel: 'PersistentVolumeClaim',
    pluralLabel: 'PersistentVolumeClaims',
    shortLabel: 'PVC',
    clusterScope: false,
  },
  {
    type: 'storageclasses',
    singular: 'storageclass',
    singularLabel: 'StorageClass',
    pluralLabel: 'StorageClasses',
    clusterScope: true,
  },
  {
    type: 'podmetrics',
    singular: 'podmetric',
    singularLabel: 'PodMetrics',
    pluralLabel: 'PodMetrics',
    clusterScope: false,
  },
  {
    type: 'replicasets',
    singular: 'replicaset',
    singularLabel: 'ReplicaSet',
    pluralLabel: 'ReplicaSets',
    clusterScope: false,
  },
  {
    type: 'serviceaccounts',
    singular: 'serviceaccount',
    singularLabel: 'ServiceAccount',
    pluralLabel: 'ServiceAccounts',
    clusterScope: false,
  },
  {
    type: 'roles',
    singular: 'role',
    singularLabel: 'Role',
    pluralLabel: 'Roles',
    clusterScope: false,
  },
  {
    type: 'rolebindings',
    singular: 'rolebinding',
    singularLabel: 'RoleBinding',
    pluralLabel: 'RoleBindings',
    clusterScope: false,
  },
  {
    type: 'clusterroles',
    singular: 'clusterrole',
    singularLabel: 'ClusterRole',
    pluralLabel: 'ClusterRoles',
    clusterScope: true,
  },
  {
    type: 'clusterrolebindings',
    singular: 'clusterrolebinding',
    singularLabel: 'ClusterRoleBinding',
    pluralLabel: 'ClusterRoleBindings',
    clusterScope: true,
  },
  {
    type: 'horizontalpodautoscalers',
    singular: 'horizontalpodautoscaler',
    singularLabel: 'HorizontalPodAutoscaler',
    pluralLabel: 'HorizontalPodAutoscalers',
    shortLabel: 'HPA',
    clusterScope: false,
  },
] as const satisfies readonly (ResourceMetadataBase & { type: string })[]

export type ResourceType = (typeof resourceMetadataList)[number]['type']

export type ResourceMetadata = ResourceMetadataBase & {
  type: ResourceType
}

const resourceMetadataMap = new Map(
  resourceMetadataList.map(
    (item) => [item.type, item] satisfies [ResourceType, ResourceMetadata]
  )
)

export const clusterScopedResourceTypes = resourceMetadataList
  .filter((item) => item.clusterScope)
  .map((item) => item.type) as ResourceType[]

function fallbackMetadata(resource: string): ResourceMetadata {
  const singular = resource.endsWith('s') ? resource.slice(0, -1) : resource
  const label = singular.charAt(0).toUpperCase() + singular.slice(1)
  return {
    type: resource as ResourceType,
    singular,
    singularLabel: label,
    pluralLabel: resource.charAt(0).toUpperCase() + resource.slice(1),
    clusterScope: false,
  }
}

export function getResourceMetadata(
  resource?: string | null
): ResourceMetadata | undefined {
  if (!resource) {
    return undefined
  }
  return (
    resourceMetadataMap.get(resource as ResourceType) ??
    fallbackMetadata(resource)
  )
}

export function getResourceSingular(resource?: string | null) {
  return getResourceMetadata(resource)?.singular || ''
}

export function getResourceSingularLabel(resource?: string | null) {
  return getResourceMetadata(resource)?.singularLabel || ''
}

export function getResourcePluralLabel(resource?: string | null) {
  return getResourceMetadata(resource)?.pluralLabel || ''
}

export function getResourceShortLabel(resource?: string | null) {
  const metadata = getResourceMetadata(resource)
  return metadata?.shortLabel || metadata?.singularLabel || ''
}

export function isClusterScopedResource(resource?: string | null) {
  return getResourceMetadata(resource)?.clusterScope ?? false
}

export function getResourceListPath(resource: string) {
  return `/${resource}`
}

export function getResourceDetailPath(
  resource: string,
  name: string,
  namespace?: string
) {
  return isClusterScopedResource(resource) || !namespace
    ? `/${resource}/${name}`
    : `/${resource}/${namespace}/${name}`
}

export function getResourceQueryKey(
  resource: string,
  namespace?: string,
  name?: string
) {
  return [resource, namespace || '_all', name || '_all']
}
