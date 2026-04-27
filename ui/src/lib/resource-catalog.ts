import {
  IconArrowsHorizontal,
  IconBell,
  IconBox,
  IconBoxMultiple,
  IconClockHour4,
  IconCode,
  IconDatabase,
  IconFileDatabase,
  IconKey,
  IconLoadBalancer,
  IconLock,
  IconMap,
  IconNetwork,
  IconPlayerPlay,
  IconRocket,
  IconRoute,
  IconRouter,
  IconServer2,
  IconShield,
  IconShieldCheck,
  IconStack2,
  IconTopologyBus,
  IconUser,
  IconUsers,
} from '@tabler/icons-react'

type SidebarGroupKey =
  | 'sidebar.groups.workloads'
  | 'sidebar.groups.traffic'
  | 'sidebar.groups.storage'
  | 'sidebar.groups.config'
  | 'sidebar.groups.security'
  | 'sidebar.groups.other'

export const resourceIconMap = {
  IconBox,
  IconRocket,
  IconStack2,
  IconTopologyBus,
  IconPlayerPlay,
  IconClockHour4,
  IconRouter,
  IconShield,
  IconNetwork,
  IconLoadBalancer,
  IconRoute,
  IconFileDatabase,
  IconDatabase,
  IconMap,
  IconLock,
  IconArrowsHorizontal,
  IconUser,
  IconUsers,
  IconShieldCheck,
  IconKey,
  IconBoxMultiple,
  IconServer2,
  IconBell,
  IconCode,
} as const

export type ResourceIconName = keyof typeof resourceIconMap

interface ResourceCatalogEntryBase {
  type: string
  singular: string
  singularLabel: string
  pluralLabel: string
  shortLabel?: string
  clusterScope: boolean
  titleKey?: string
  icon?: ResourceIconName
  sidebar?: {
    groupKey: SidebarGroupKey
    order: number
    titleKey?: string
  }
}

export const sidebarGroupOrder = [
  'sidebar.groups.workloads',
  'sidebar.groups.traffic',
  'sidebar.groups.storage',
  'sidebar.groups.config',
  'sidebar.groups.security',
  'sidebar.groups.other',
] as const satisfies readonly SidebarGroupKey[]

export const resourceCatalog = [
  {
    type: 'pods',
    singular: 'pod',
    singularLabel: 'Pod',
    pluralLabel: 'Pods',
    clusterScope: false,
    titleKey: 'nav.pods',
    icon: 'IconBox',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 0 },
  },
  {
    type: 'deployments',
    singular: 'deployment',
    singularLabel: 'Deployment',
    pluralLabel: 'Deployments',
    shortLabel: 'Deploy',
    clusterScope: false,
    titleKey: 'nav.deployments',
    icon: 'IconRocket',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 1 },
  },
  {
    type: 'statefulsets',
    singular: 'statefulset',
    singularLabel: 'StatefulSet',
    pluralLabel: 'StatefulSets',
    shortLabel: 'STS',
    clusterScope: false,
    titleKey: 'nav.statefulsets',
    icon: 'IconStack2',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 2 },
  },
  {
    type: 'daemonsets',
    singular: 'daemonset',
    singularLabel: 'DaemonSet',
    pluralLabel: 'DaemonSets',
    shortLabel: 'Daemon',
    clusterScope: false,
    titleKey: 'nav.daemonsets',
    icon: 'IconTopologyBus',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 3 },
  },
  {
    type: 'jobs',
    singular: 'job',
    singularLabel: 'Job',
    pluralLabel: 'Jobs',
    shortLabel: 'Job',
    clusterScope: false,
    titleKey: 'nav.jobs',
    icon: 'IconPlayerPlay',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 4 },
  },
  {
    type: 'cronjobs',
    singular: 'cronjob',
    singularLabel: 'CronJob',
    pluralLabel: 'CronJobs',
    clusterScope: false,
    titleKey: 'nav.cronjobs',
    icon: 'IconClockHour4',
    sidebar: { groupKey: 'sidebar.groups.workloads', order: 5 },
  },
  {
    type: 'services',
    singular: 'service',
    singularLabel: 'Service',
    pluralLabel: 'Services',
    clusterScope: false,
    titleKey: 'nav.services',
    icon: 'IconNetwork',
    sidebar: { groupKey: 'sidebar.groups.traffic', order: 2 },
  },
  {
    type: 'gateways',
    singular: 'gateway',
    singularLabel: 'Gateway',
    pluralLabel: 'Gateways',
    clusterScope: false,
    titleKey: 'nav.gateways',
    icon: 'IconLoadBalancer',
    sidebar: { groupKey: 'sidebar.groups.traffic', order: 3 },
  },
  {
    type: 'httproutes',
    singular: 'httproute',
    singularLabel: 'HTTPRoute',
    pluralLabel: 'HTTPRoutes',
    clusterScope: false,
    titleKey: 'nav.httproutes',
    icon: 'IconRoute',
    sidebar: { groupKey: 'sidebar.groups.traffic', order: 4 },
  },
  {
    type: 'configmaps',
    singular: 'configmap',
    singularLabel: 'ConfigMap',
    pluralLabel: 'ConfigMaps',
    clusterScope: false,
    titleKey: 'nav.configMaps',
    icon: 'IconMap',
    sidebar: { groupKey: 'sidebar.groups.config', order: 0 },
  },
  {
    type: 'secrets',
    singular: 'secret',
    singularLabel: 'Secret',
    pluralLabel: 'Secrets',
    clusterScope: false,
    titleKey: 'nav.secrets',
    icon: 'IconLock',
    sidebar: { groupKey: 'sidebar.groups.config', order: 1 },
  },
  {
    type: 'ingresses',
    singular: 'ingress',
    singularLabel: 'Ingress',
    pluralLabel: 'Ingresses',
    clusterScope: false,
    titleKey: 'nav.ingresses',
    icon: 'IconRouter',
    sidebar: { groupKey: 'sidebar.groups.traffic', order: 0 },
  },
  {
    type: 'networkpolicies',
    singular: 'networkpolicy',
    singularLabel: 'NetworkPolicy',
    pluralLabel: 'NetworkPolicies',
    clusterScope: false,
    titleKey: 'nav.networkpolicies',
    icon: 'IconShield',
    sidebar: { groupKey: 'sidebar.groups.traffic', order: 1 },
  },
  {
    type: 'namespaces',
    singular: 'namespace',
    singularLabel: 'Namespace',
    pluralLabel: 'Namespaces',
    clusterScope: true,
    titleKey: 'nav.namespaces',
    icon: 'IconBoxMultiple',
    sidebar: { groupKey: 'sidebar.groups.other', order: 0 },
  },
  {
    type: 'crds',
    singular: 'crd',
    singularLabel: 'CRD',
    pluralLabel: 'CRDs',
    clusterScope: true,
    titleKey: 'nav.crds',
    icon: 'IconCode',
    sidebar: { groupKey: 'sidebar.groups.other', order: 3 },
  },
  {
    type: 'crs',
    singular: 'custom resource',
    singularLabel: 'Custom Resource',
    pluralLabel: 'Custom Resources',
    clusterScope: false,
    titleKey: 'nav.customResources',
    icon: 'IconCode',
  },
  {
    type: 'nodes',
    singular: 'node',
    singularLabel: 'Node',
    pluralLabel: 'Nodes',
    clusterScope: true,
    titleKey: 'nav.nodes',
    icon: 'IconServer2',
    sidebar: { groupKey: 'sidebar.groups.other', order: 1 },
  },
  {
    type: 'events',
    singular: 'event',
    singularLabel: 'Event',
    pluralLabel: 'Events',
    clusterScope: false,
    titleKey: 'nav.events',
    icon: 'IconBell',
    sidebar: { groupKey: 'sidebar.groups.other', order: 2 },
  },
  {
    type: 'persistentvolumes',
    singular: 'persistentvolume',
    singularLabel: 'PersistentVolume',
    pluralLabel: 'PersistentVolumes',
    shortLabel: 'PV',
    clusterScope: true,
    titleKey: 'nav.persistentvolumes',
    icon: 'IconDatabase',
    sidebar: {
      groupKey: 'sidebar.groups.storage',
      order: 1,
      titleKey: 'sidebar.short.pvs',
    },
  },
  {
    type: 'persistentvolumeclaims',
    singular: 'persistentvolumeclaim',
    singularLabel: 'PersistentVolumeClaim',
    pluralLabel: 'PersistentVolumeClaims',
    shortLabel: 'PVC',
    clusterScope: false,
    titleKey: 'nav.persistentvolumeclaims',
    icon: 'IconFileDatabase',
    sidebar: {
      groupKey: 'sidebar.groups.storage',
      order: 0,
      titleKey: 'sidebar.short.pvcs',
    },
  },
  {
    type: 'storageclasses',
    singular: 'storageclass',
    singularLabel: 'StorageClass',
    pluralLabel: 'StorageClasses',
    clusterScope: true,
    titleKey: 'nav.storageclasses',
    icon: 'IconFileDatabase',
    sidebar: { groupKey: 'sidebar.groups.storage', order: 2 },
  },
  {
    type: 'podmetrics',
    singular: 'podmetric',
    singularLabel: 'PodMetrics',
    pluralLabel: 'PodMetrics',
    clusterScope: false,
    icon: 'IconBox',
  },
  {
    type: 'replicasets',
    singular: 'replicaset',
    singularLabel: 'ReplicaSet',
    pluralLabel: 'ReplicaSets',
    clusterScope: false,
    titleKey: 'nav.replicasets',
    icon: 'IconBox',
  },
  {
    type: 'serviceaccounts',
    singular: 'serviceaccount',
    singularLabel: 'ServiceAccount',
    pluralLabel: 'ServiceAccounts',
    clusterScope: false,
    titleKey: 'nav.serviceaccounts',
    icon: 'IconUser',
    sidebar: { groupKey: 'sidebar.groups.security', order: 0 },
  },
  {
    type: 'roles',
    singular: 'role',
    singularLabel: 'Role',
    pluralLabel: 'Roles',
    clusterScope: false,
    titleKey: 'nav.roles',
    icon: 'IconShield',
    sidebar: { groupKey: 'sidebar.groups.security', order: 1 },
  },
  {
    type: 'rolebindings',
    singular: 'rolebinding',
    singularLabel: 'RoleBinding',
    pluralLabel: 'RoleBindings',
    clusterScope: false,
    titleKey: 'nav.rolebindings',
    icon: 'IconUsers',
    sidebar: { groupKey: 'sidebar.groups.security', order: 2 },
  },
  {
    type: 'clusterroles',
    singular: 'clusterrole',
    singularLabel: 'ClusterRole',
    pluralLabel: 'ClusterRoles',
    clusterScope: true,
    titleKey: 'nav.clusterroles',
    icon: 'IconShieldCheck',
    sidebar: { groupKey: 'sidebar.groups.security', order: 3 },
  },
  {
    type: 'clusterrolebindings',
    singular: 'clusterrolebinding',
    singularLabel: 'ClusterRoleBinding',
    pluralLabel: 'ClusterRoleBindings',
    clusterScope: true,
    titleKey: 'nav.clusterrolebindings',
    icon: 'IconKey',
    sidebar: { groupKey: 'sidebar.groups.security', order: 4 },
  },
  {
    type: 'horizontalpodautoscalers',
    singular: 'horizontalpodautoscaler',
    singularLabel: 'HorizontalPodAutoscaler',
    pluralLabel: 'HorizontalPodAutoscalers',
    shortLabel: 'HPA',
    clusterScope: false,
    titleKey: 'nav.horizontalpodautoscalers',
    icon: 'IconArrowsHorizontal',
    sidebar: { groupKey: 'sidebar.groups.config', order: 2 },
  },
  {
    type: 'poddisruptionbudgets',
    singular: 'poddisruptionbudget',
    singularLabel: 'PodDisruptionBudget',
    pluralLabel: 'PodDisruptionBudgets',
    shortLabel: 'PDB',
    clusterScope: false,
    titleKey: 'nav.poddisruptionbudgets',
    icon: 'IconShield',
    sidebar: { groupKey: 'sidebar.groups.config', order: 3 },
  },
] as const satisfies readonly ResourceCatalogEntryBase[]

export type CatalogResourceType = (typeof resourceCatalog)[number]['type']

export type ResourceType = CatalogResourceType

export type ResourceMetadata = Omit<ResourceCatalogEntryBase, 'type'> & {
  type: ResourceType
}

export const resourceMetadataList: readonly ResourceMetadata[] =
  resourceCatalog.map((item) => ({
    type: item.type,
    singular: item.singular,
    singularLabel: item.singularLabel,
    pluralLabel: item.pluralLabel,
    shortLabel: 'shortLabel' in item ? item.shortLabel : undefined,
    clusterScope: item.clusterScope,
    titleKey: 'titleKey' in item ? item.titleKey : undefined,
    icon: 'icon' in item ? item.icon : undefined,
    sidebar: 'sidebar' in item ? item.sidebar : undefined,
  }))

const resourceCatalogMap = new Map(
  resourceCatalog.map((item) => [item.type, item] as const)
)

const resourceMetadataMap = new Map(
  resourceMetadataList.flatMap((item) =>
    [item.type, item.singular, item.singularLabel, item.pluralLabel]
      .concat(item.shortLabel ? [item.shortLabel] : [])
      .map((alias) => [alias.toLowerCase(), item] as const)
  )
)

export function getResourceCatalogEntry(resource?: string | null) {
  if (!resource) {
    return undefined
  }
  return resourceCatalogMap.get(resource as CatalogResourceType)
}

export function getResourceMetadata(resource?: string | null) {
  if (!resource) {
    return undefined
  }
  return (
    resourceMetadataMap.get(resource.toLowerCase()) ??
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

export function getResourceIconComponent(iconName?: string) {
  return resourceIconMap[iconName as ResourceIconName] || IconBox
}
