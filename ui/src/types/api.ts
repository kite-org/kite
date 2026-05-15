// API types for Custom Resources

import {
  CustomResourceDefinition,
  CustomResourceDefinitionList,
} from 'kubernetes-types/apiextensions/v1'
import {
  DaemonSet,
  DaemonSetList,
  Deployment,
  DeploymentList,
  ReplicaSet,
  ReplicaSetList,
  StatefulSet,
  StatefulSetList,
} from 'kubernetes-types/apps/v1'
import {
  HorizontalPodAutoscaler,
  HorizontalPodAutoscalerList,
} from 'kubernetes-types/autoscaling/v2'
import { CronJob, CronJobList, Job, JobList } from 'kubernetes-types/batch/v1'
import {
  ConfigMap,
  ConfigMapList,
  Endpoints,
  EndpointsList,
  Event,
  EventList,
  Namespace,
  NamespaceList,
  Node,
  PersistentVolume,
  PersistentVolumeClaim,
  PersistentVolumeClaimList,
  PersistentVolumeList,
  Pod,
  Secret,
  SecretList,
  Service,
  ServiceAccount,
  ServiceAccountList,
  ServiceList,
} from 'kubernetes-types/core/v1'
import { EndpointSlice, EndpointSliceList } from 'kubernetes-types/discovery/v1'
import {
  Ingress,
  IngressList,
  NetworkPolicy,
  NetworkPolicyList,
} from 'kubernetes-types/networking/v1'
import {
  PodDisruptionBudget,
  PodDisruptionBudgetList,
} from 'kubernetes-types/policy/v1'
import {
  ClusterRole,
  ClusterRoleBinding,
  ClusterRoleBindingList,
  ClusterRoleList,
  Role as RawRole,
  RoleBinding,
  RoleBindingList,
  RoleList,
} from 'kubernetes-types/rbac/v1'
import { StorageClass, StorageClassList } from 'kubernetes-types/storage/v1'

import type { ResourceType } from '@/lib/resource-metadata'

import { Gateway, HTTPRoute } from './gateway'

export type { ResourceType } from '@/lib/resource-metadata'

export interface CustomResource {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace?: string
    creationTimestamp: string
    uid?: string
    resourceVersion?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
}

export interface CustomResourceList {
  apiVersion: string
  kind: string
  items: CustomResource[]
  metadata?: {
    continue?: string
    remainingItemCount?: number
  }
}

export interface DeploymentRelatedResource {
  events: Event[]
  pods: Pod[]
  services: Service[]
}

export interface HelmReleaseResource {
  apiVersion: string
  kind: string
  name: string
  namespace?: string
}

export interface HelmReleaseHistoryItem {
  revision: number
  status: string
  chart: string
  chartName: string
  chartVersion: string
  appVersion?: string
  values?: Record<string, unknown>
  description?: string
  firstDeployed?: string
  lastDeployed?: string
  deleted?: string
}

export interface HelmReleaseHistoryResponse {
  items: HelmReleaseHistoryItem[]
}

export interface HelmRelease {
  apiVersion: 'v1'
  kind: 'HelmRelease'
  metadata: {
    name: string
    namespace: string
    uid?: string
    resourceVersion?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec: {
    releaseName: string
    namespace: string
    chart: string
    chartName: string
    chartVersion: string
    appVersion?: string
    icon?: string
    revision: number
    values?: Record<string, unknown>
    defaultValues?: Record<string, unknown>
    manifest?: string
    notes?: string
    description?: string
  }
  status: {
    status: string
    firstDeployed?: string
    lastDeployed?: string
    deleted?: string
    resources?: HelmReleaseResource[]
  }
}

export interface HelmReleaseList {
  apiVersion: 'v1'
  kind: 'HelmReleaseList'
  items: HelmRelease[]
  metadata?: listMetadataType
}

export interface HelmRepository {
  id: number
  name: string
  url: string
  username?: string
  hasAuth: boolean
  createdAt: string
  updatedAt: string
}

export interface HelmChart {
  repositoryId: number
  repositoryName: string
  repositoryUrl: string
  source?: 'repository' | 'artifacthub'
  name: string
  version: string
  appVersion?: string
  kubeVersion?: string
  description?: string
  icon?: string
  home?: string
  artifactHubUrl?: string
  chartUrl?: string
  sources?: string[]
  keywords?: string[]
  maintainers?: {
    name: string
    email?: string
    url?: string
  }[]
  deprecated?: boolean
  updatedAt?: string
}

export interface HelmChartVersion {
  version: string
  appVersion?: string
  publishedAt?: string
}

export interface HelmChartList {
  items: HelmChart[]
  total?: number
}

export type HelmChartContentType = 'values' | 'templates'

export interface HelmChartTemplate {
  path: string
  content: string
}

export interface HelmChartContent {
  content?: string
  templates?: HelmChartTemplate[]
}

export interface HelmChartDetail extends HelmChart {
  readme?: string
  versions: HelmChartVersion[]
}

export interface HelmReleaseInstallRequest {
  releaseName: string
  namespace?: string
  chartUrl: string
  repositoryName?: string
  source?: 'repository' | 'artifacthub'
  values?: Record<string, unknown>
  description?: string
  createNamespace?: boolean
  wait?: boolean
}

export interface HelmReleaseUpgradeRequest {
  chartUrl?: string
  repositoryName?: string
  source?: 'repository' | 'artifacthub'
  values?: Record<string, unknown>
  description?: string
  forceConflicts?: boolean
  wait?: boolean
  rollbackOnFailure?: boolean
}

export interface HelmReleaseAutoUpgrade {
  clusterName: string
  namespace: string
  releaseName: string
  enabled: boolean
  scheduleType: 'interval' | 'daily'
  intervalMinutes: number
  scheduleTime: string
  timeoutMinutes: number
  rollbackOnFailure: boolean
  source?: 'repository' | 'artifacthub'
  repositoryName?: string
  chartName?: string
  lastCheckedAt?: string
  lastUpgradedAt?: string
  lastError?: string
}

export interface HelmReleaseAutoUpgradeRequest {
  enabled: boolean
  scheduleType: 'interval' | 'daily'
  intervalMinutes: number
  scheduleTime: string
  timeoutMinutes: number
  rollbackOnFailure: boolean
  source?: 'repository' | 'artifacthub'
  repositoryName?: string
  chartName?: string
}

export interface HelmReleaseDryRunResource {
  path: string
  content: string
  originalContent?: string
  modifiedContent?: string
  status?: 'added' | 'deleted' | 'changed' | 'unchanged'
  apiVersion?: string
  kind?: string
  name?: string
  namespace?: string
}

export interface HelmReleaseDryRunResponse {
  resources: HelmReleaseDryRunResource[]
}

type listMetadataType = {
  continue?: string
  remainingItemCount?: number
}

export interface KubernetesResource {
  apiVersion?: string
  kind?: string
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    uid?: string
    resourceVersion?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  [key: string]: unknown
}

export interface KubernetesResourceList {
  apiVersion?: string
  kind?: string
  items: KubernetesResource[]
  metadata?: listMetadataType
}

// Define resource type mappings
export interface ResourcesTypeMap {
  pods: {
    items: PodWithMetrics[]
    metadata?: listMetadataType
  }
  deployments: DeploymentList
  statefulsets: StatefulSetList
  daemonsets: DaemonSetList
  jobs: JobList
  cronjobs: CronJobList
  services: ServiceList
  endpoints: EndpointsList
  endpointslices: EndpointSliceList
  podtemplates: KubernetesResourceList
  replicationcontrollers: KubernetesResourceList
  limitranges: KubernetesResourceList
  resourcequotas: KubernetesResourceList
  componentstatuses: KubernetesResourceList
  gateways: {
    items: Gateway[]
    metadata?: listMetadataType
  }
  httproutes: {
    items: HTTPRoute[]
    metadata?: listMetadataType
  }
  configmaps: ConfigMapList
  secrets: SecretList
  persistentvolumeclaims: PersistentVolumeClaimList
  ingresses: IngressList
  networkpolicies: NetworkPolicyList
  namespaces: NamespaceList
  crds: CustomResourceDefinitionList
  crs: {
    items: CustomResource[]
    metadata?: listMetadataType
  }
  nodes: {
    items: NodeWithMetrics[]
    metadata?: listMetadataType
  }
  events: EventList
  persistentvolumes: PersistentVolumeList
  storageclasses: StorageClassList
  volumeattachments: KubernetesResourceList
  csidrivers: KubernetesResourceList
  csinodes: KubernetesResourceList
  csistoragecapacities: KubernetesResourceList
  volumeattributesclasses: KubernetesResourceList
  podmetrics: {
    items: PodMetrics[]
    metadata?: listMetadataType
  }
  replicasets: ReplicaSetList
  controllerrevisions: KubernetesResourceList
  poddisruptionbudgets: PodDisruptionBudgetList
  serviceaccounts: ServiceAccountList
  roles: RoleList
  rolebindings: RoleBindingList
  clusterroles: ClusterRoleList
  clusterrolebindings: ClusterRoleBindingList
  certificatesigningrequests: KubernetesResourceList
  clustertrustbundles: KubernetesResourceList
  podcertificaterequests: KubernetesResourceList
  leases: KubernetesResourceList
  leasecandidates: KubernetesResourceList
  runtimeclasses: KubernetesResourceList
  priorityclasses: KubernetesResourceList
  workloads: KubernetesResourceList
  podgroups: KubernetesResourceList
  flowschemas: KubernetesResourceList
  prioritylevelconfigurations: KubernetesResourceList
  validatingadmissionpolicies: KubernetesResourceList
  validatingadmissionpolicybindings: KubernetesResourceList
  validatingwebhookconfigurations: KubernetesResourceList
  mutatingwebhookconfigurations: KubernetesResourceList
  mutatingadmissionpolicies: KubernetesResourceList
  mutatingadmissionpolicybindings: KubernetesResourceList
  resourceslices: KubernetesResourceList
  resourceclaims: KubernetesResourceList
  deviceclasses: KubernetesResourceList
  resourceclaimtemplates: KubernetesResourceList
  devicetaintrules: KubernetesResourceList
  resourcepoolstatusrequests: KubernetesResourceList
  storageversions: KubernetesResourceList
  storageversionmigrations: KubernetesResourceList
  ingressclasses: KubernetesResourceList
  ipaddresses: KubernetesResourceList
  servicecidrs: KubernetesResourceList
  horizontalpodautoscalers: HorizontalPodAutoscalerList
  helmrelease: HelmReleaseList
}

export interface PodMetrics {
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    creationTimestamp?: string
    uid?: string
    resourceVersion?: string
  }
  containers: {
    name: string // container name
    usage: {
      cpu: string // 214572390n
      memory: string // 2956516Ki
    }
  }[]
}

export type MetricsData = {
  cpuUsage?: number
  memoryUsage?: number
  cpuLimit?: number
  memoryLimit?: number
  cpuRequest?: number
  memoryRequest?: number
  pods?: number
  podsLimit?: number
}

export type PodWithMetrics = Pod & {
  metrics?: MetricsData
}

export type NodeWithMetrics = Node & {
  metrics?: MetricsData
}

export interface ResourceTypeMap {
  pods: PodWithMetrics
  deployments: Deployment
  statefulsets: StatefulSet
  daemonsets: DaemonSet
  jobs: Job
  cronjobs: CronJob
  services: Service
  endpoints: Endpoints
  endpointslices: EndpointSlice
  podtemplates: KubernetesResource
  replicationcontrollers: KubernetesResource
  limitranges: KubernetesResource
  resourcequotas: KubernetesResource
  componentstatuses: KubernetesResource
  gateways: Gateway
  httproutes: HTTPRoute
  configmaps: ConfigMap
  secrets: Secret
  persistentvolumeclaims: PersistentVolumeClaim
  ingresses: Ingress
  networkpolicies: NetworkPolicy
  namespaces: Namespace
  crds: CustomResourceDefinition
  crs: CustomResource
  nodes: NodeWithMetrics
  events: Event
  persistentvolumes: PersistentVolume
  storageclasses: StorageClass
  volumeattachments: KubernetesResource
  csidrivers: KubernetesResource
  csinodes: KubernetesResource
  csistoragecapacities: KubernetesResource
  volumeattributesclasses: KubernetesResource
  replicasets: ReplicaSet
  controllerrevisions: KubernetesResource
  poddisruptionbudgets: PodDisruptionBudget
  podmetrics: PodMetrics
  serviceaccounts: ServiceAccount
  roles: RawRole
  rolebindings: RoleBinding
  clusterroles: ClusterRole
  clusterrolebindings: ClusterRoleBinding
  certificatesigningrequests: KubernetesResource
  clustertrustbundles: KubernetesResource
  podcertificaterequests: KubernetesResource
  leases: KubernetesResource
  leasecandidates: KubernetesResource
  runtimeclasses: KubernetesResource
  priorityclasses: KubernetesResource
  workloads: KubernetesResource
  podgroups: KubernetesResource
  flowschemas: KubernetesResource
  prioritylevelconfigurations: KubernetesResource
  validatingadmissionpolicies: KubernetesResource
  validatingadmissionpolicybindings: KubernetesResource
  validatingwebhookconfigurations: KubernetesResource
  mutatingwebhookconfigurations: KubernetesResource
  mutatingadmissionpolicies: KubernetesResource
  mutatingadmissionpolicybindings: KubernetesResource
  resourceslices: KubernetesResource
  resourceclaims: KubernetesResource
  deviceclasses: KubernetesResource
  resourceclaimtemplates: KubernetesResource
  devicetaintrules: KubernetesResource
  resourcepoolstatusrequests: KubernetesResource
  storageversions: KubernetesResource
  storageversionmigrations: KubernetesResource
  ingressclasses: KubernetesResource
  ipaddresses: KubernetesResource
  servicecidrs: KubernetesResource
  horizontalpodautoscalers: HorizontalPodAutoscaler
  helmrelease: HelmRelease
}

export interface RecentEvent {
  type: string
  reason: string
  message: string
  involvedObjectKind: string
  involvedObjectName: string
  namespace?: string
  timestamp: string
}

export interface UsageDataPoint {
  timestamp: string
  value: number
}

export interface ResourceUsageHistory {
  cpu: UsageDataPoint[]
  memory: UsageDataPoint[]
  networkIn: UsageDataPoint[]
  networkOut: UsageDataPoint[]
  diskRead: UsageDataPoint[]
  diskWrite: UsageDataPoint[]
}

// Pod monitoring types
export interface PodMetrics {
  cpu: UsageDataPoint[]
  memory: UsageDataPoint[]
  networkIn?: UsageDataPoint[]
  networkOut?: UsageDataPoint[]
  diskRead?: UsageDataPoint[]
  diskWrite?: UsageDataPoint[]
  fallback?: boolean
}

export interface OverviewData {
  totalNodes: number
  readyNodes: number
  totalPods: number
  runningPods: number
  totalNamespaces: number
  totalServices: number
  prometheusEnabled: boolean
  resource: {
    cpu: {
      allocatable: number
      requested: number
      limited: number
    }
    memory: {
      allocatable: number
      requested: number
      limited: number
    }
  }
}

// Pagination types
export interface PaginationInfo {
  hasNextPage: boolean
  nextContinueToken?: string
  remainingItems?: number
}

export interface PaginationOptions {
  limit?: number
  continueToken?: string
}

// Pod current metrics types
export interface PodCurrentMetrics {
  podName: string
  namespace: string
  cpu: number // CPU cores
  memory: number // Memory in MB
}

export interface ImageTagInfo {
  name: string
  timestamp?: string
}

export interface RelatedResources {
  type: ResourceType
  name: string
  namespace?: string
  apiVersion?: string
}

export interface Cluster {
  id: number
  name: string
  description?: string
  version?: string
  config?: string
  enabled: boolean
  inCluster: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
  prometheusURL?: string
  error?: string
}

export interface OAuthProvider {
  id: number
  name: string
  clientId: string
  clientSecret: string
  authUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  scopes?: string
  issuer?: string
  usernameClaim?: string
  groupsClaim?: string
  allowedGroups?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RoleAssignment {
  id: number
  roleId: number
  subjectType: 'user' | 'group'
  subject: string
  createdAt: string
  updatedAt: string
}

export interface Role {
  id: number
  name: string
  description?: string
  isSystem?: boolean
  clusters: string[]
  namespaces: string[]
  resources: string[]
  verbs: string[]
  assignments?: RoleAssignment[]
  createdAt: string
  updatedAt: string
}

export interface UserItem {
  id: number
  username: string
  sub?: string
  provider: string
  createdAt: string
  lastLoginAt?: string
  enabled?: boolean
  avatar_url?: string
  name?: string
  roles?: Role[]
}

export interface FetchUserListResponse {
  users: UserItem[]
  total: number
  page: number
  size: number
}

export interface APIKey {
  id: number
  username: string
  apiKey: string
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
  roles?: Role[]
}

// Resource History types
export interface ResourceHistory {
  id: number
  clusterName: string
  resourceType: string
  resourceName: string
  namespace: string
  operationType: string
  operationSource: string
  resourceYaml: string
  previousYaml: string
  success: boolean
  errorMessage: string
  operatorId: number
  operator: {
    username: string
    provider: string
  }
  createdAt: string
  updatedAt: string
}

export interface ResourceHistoryResponse {
  data: ResourceHistory[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface AuditLogResponse {
  data: ResourceHistory[]
  total: number
  page: number
  size: number
}
export interface ResourceTemplate {
  id: number
  name: string
  description: string
  yaml: string
}
