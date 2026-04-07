import type { ReactNode } from 'react'

import type { ResourceType } from '@/types/api'
import {
  getResourceMetadata,
  getResourcePluralLabel,
  getResourceShortLabel,
  getResourceSingularLabel,
  isClusterScopedResource,
  type ResourceMetadata,
} from '@/lib/resource-metadata'

import { ConfigMapDetail } from './configmap-detail'
import { ConfigMapListPage } from './configmap-list-page'
import { CRDListPage } from './crd-list-page'
import { CronJobDetail } from './cronjob-detail'
import { CronJobListPage } from './cronjob-list-page'
import { DaemonSetDetail } from './daemonset-detail'
import { DaemonSetListPage } from './daemonset-list-page'
import { DeploymentDetail } from './deployment-detail'
import { DeploymentListPage } from './deployment-list-page'
import { EventListPage } from './event-list-page'
import { GatewayListPage } from './gateway-list-page'
import { HorizontalPodAutoscalerListPage } from './horizontalpodautoscaler-list-page'
import { HTTPRouteListPage } from './httproute-list-page'
import { IngressListPage } from './ingress-list-page'
import { JobDetail } from './job-detail'
import { JobListPage } from './job-list-page'
import { NamespaceListPage } from './namespace-list-page'
import { NodeDetail } from './node-detail'
import { NodeListPage } from './node-list-page'
import { PodDetail } from './pod-detail'
import { PodListPage } from './pod-list-page'
import { PVListPage } from './pv-list-page'
import { PVCListPage } from './pvc-list-page'
import { SecretDetail } from './secret-detail'
import { SecretListPage } from './secret-list-page'
import { ServiceDetail } from './service-detail'
import { ServiceListPage } from './service-list-page'
import { StatefulSetDetail } from './statefulset-detail'
import { StatefulSetListPage } from './statefulset-list-page'

export type ResourceScope = 'cluster' | 'namespace'

export interface ResourceDefinition extends ResourceMetadata {
  listPage?: () => ReactNode
  detailPage?: (props: { name: string; namespace?: string }) => ReactNode
}

type ResourceRendererMap = Partial<
  Record<ResourceType, Pick<ResourceDefinition, 'listPage' | 'detailPage'>>
>

const resourceRenderers: ResourceRendererMap = {
  pods: {
    listPage: () => <PodListPage />,
    detailPage: ({ name, namespace }) => (
      <PodDetail namespace={namespace!} name={name} />
    ),
  },
  deployments: {
    listPage: () => <DeploymentListPage />,
    detailPage: ({ name, namespace }) => (
      <DeploymentDetail namespace={namespace!} name={name} />
    ),
  },
  statefulsets: {
    listPage: () => <StatefulSetListPage />,
    detailPage: ({ name, namespace }) => (
      <StatefulSetDetail namespace={namespace!} name={name} />
    ),
  },
  daemonsets: {
    listPage: () => <DaemonSetListPage />,
    detailPage: ({ name, namespace }) => (
      <DaemonSetDetail namespace={namespace!} name={name} />
    ),
  },
  jobs: {
    listPage: () => <JobListPage />,
    detailPage: ({ name, namespace }) => (
      <JobDetail namespace={namespace!} name={name} />
    ),
  },
  cronjobs: {
    listPage: () => <CronJobListPage />,
    detailPage: ({ name, namespace }) => (
      <CronJobDetail namespace={namespace!} name={name} />
    ),
  },
  services: {
    listPage: () => <ServiceListPage />,
    detailPage: ({ name, namespace }) => (
      <ServiceDetail namespace={namespace} name={name} />
    ),
  },
  configmaps: {
    listPage: () => <ConfigMapListPage />,
    detailPage: ({ name, namespace }) => (
      <ConfigMapDetail namespace={namespace!} name={name} />
    ),
  },
  secrets: {
    listPage: () => <SecretListPage />,
    detailPage: ({ name, namespace }) => (
      <SecretDetail namespace={namespace!} name={name} />
    ),
  },
  ingresses: {
    listPage: () => <IngressListPage />,
  },
  namespaces: {
    listPage: () => <NamespaceListPage />,
  },
  crds: {
    listPage: () => <CRDListPage />,
  },
  nodes: {
    listPage: () => <NodeListPage />,
    detailPage: ({ name }) => <NodeDetail name={name} />,
  },
  events: {
    listPage: () => <EventListPage />,
  },
  persistentvolumes: {
    listPage: () => <PVListPage />,
  },
  persistentvolumeclaims: {
    listPage: () => <PVCListPage />,
  },
  horizontalpodautoscalers: {
    listPage: () => <HorizontalPodAutoscalerListPage />,
  },
  gateways: {
    listPage: () => <GatewayListPage />,
  },
  httproutes: {
    listPage: () => <HTTPRouteListPage />,
  },
}

export function getResourceDefinition(resourceType: string) {
  const metadata = getResourceMetadata(resourceType)
  if (!metadata) {
    return undefined
  }

  return {
    ...metadata,
    ...resourceRenderers[metadata.type],
  } satisfies ResourceDefinition
}

export function getResourceLabel(resourceType: string, plural = false) {
  return plural
    ? getResourcePluralLabel(resourceType)
    : getResourceSingularLabel(resourceType)
}

export function getResourceShortName(resourceType: string) {
  return getResourceShortLabel(resourceType)
}

export function getResourceScope(resourceType: string): ResourceScope {
  return isClusterScopedResource(resourceType) ? 'cluster' : 'namespace'
}
