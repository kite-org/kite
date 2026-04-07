import type { ReactNode } from 'react'

import {
  getResourcePluralLabel,
  getResourceShortLabel,
  getResourceSingularLabel,
  isClusterScopedResource,
  resourceCatalog,
  type ResourceMetadata,
  type ResourceType,
} from '@/lib/resource-catalog'

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

type ResourceViewDefinition = Pick<
  ResourceDefinition,
  'listPage' | 'detailPage'
>

type ResourceDetailProps = { name: string; namespace?: string }

function getResourceViews(resourceType: ResourceType): ResourceViewDefinition {
  switch (resourceType) {
    case 'pods':
      return {
        listPage: () => <PodListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <PodDetail namespace={namespace!} name={name} />
        ),
      }
    case 'deployments':
      return {
        listPage: () => <DeploymentListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <DeploymentDetail namespace={namespace!} name={name} />
        ),
      }
    case 'statefulsets':
      return {
        listPage: () => <StatefulSetListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <StatefulSetDetail namespace={namespace!} name={name} />
        ),
      }
    case 'daemonsets':
      return {
        listPage: () => <DaemonSetListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <DaemonSetDetail namespace={namespace!} name={name} />
        ),
      }
    case 'jobs':
      return {
        listPage: () => <JobListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <JobDetail namespace={namespace!} name={name} />
        ),
      }
    case 'cronjobs':
      return {
        listPage: () => <CronJobListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <CronJobDetail namespace={namespace!} name={name} />
        ),
      }
    case 'services':
      return {
        listPage: () => <ServiceListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <ServiceDetail namespace={namespace} name={name} />
        ),
      }
    case 'configmaps':
      return {
        listPage: () => <ConfigMapListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <ConfigMapDetail namespace={namespace!} name={name} />
        ),
      }
    case 'secrets':
      return {
        listPage: () => <SecretListPage />,
        detailPage: ({ name, namespace }: ResourceDetailProps) => (
          <SecretDetail namespace={namespace!} name={name} />
        ),
      }
    case 'ingresses':
      return {
        listPage: () => <IngressListPage />,
      }
    case 'namespaces':
      return {
        listPage: () => <NamespaceListPage />,
      }
    case 'crds':
      return {
        listPage: () => <CRDListPage />,
      }
    case 'nodes':
      return {
        listPage: () => <NodeListPage />,
        detailPage: ({ name }: ResourceDetailProps) => (
          <NodeDetail name={name} />
        ),
      }
    case 'events':
      return {
        listPage: () => <EventListPage />,
      }
    case 'persistentvolumes':
      return {
        listPage: () => <PVListPage />,
      }
    case 'persistentvolumeclaims':
      return {
        listPage: () => <PVCListPage />,
      }
    case 'horizontalpodautoscalers':
      return {
        listPage: () => <HorizontalPodAutoscalerListPage />,
      }
    case 'gateways':
      return {
        listPage: () => <GatewayListPage />,
      }
    case 'httproutes':
      return {
        listPage: () => <HTTPRouteListPage />,
      }
    default:
      return {}
  }
}

export const resourceDefinitions: readonly ResourceDefinition[] =
  resourceCatalog.map(
    (entry): ResourceDefinition => ({
      ...entry,
      ...getResourceViews(entry.type),
    })
  )

export function getResourceDefinition(resourceType: string) {
  return resourceDefinitions.find(
    (definition) => definition.type === resourceType
  )
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
