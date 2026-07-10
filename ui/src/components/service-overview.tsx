import { useMemo, type ReactNode } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import {
  Endpoints,
  Event as KubernetesEvent,
  Pod,
  Service,
  ServicePort,
} from 'kubernetes-types/core/v1'
import { EndpointSlice } from 'kubernetes-types/discovery/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useRelatedResources } from '@/lib/api'
import { API_BASE_URL } from '@/lib/api-client'
import { withCurrentClusterPath } from '@/lib/current-cluster'
import { getEventTime, getOwnerInfo, getServiceExternalIP } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Column, SimpleTable } from '@/components/simple-table'
import {
  WorkloadInfoBlock,
  WorkloadInfoRow,
} from '@/components/workload-overview-parts'
import { WorkloadPodsCard } from '@/components/workload-pods-card'

import {
  CompactEventsCard,
  CompactRelatedResourcesCard,
  MetadataListCard,
} from './pod-overview-sidebar'

export function ServiceOverview({
  service,
  namespace,
  name,
  pods,
  isPodsLoading,
  endpoints,
  isEndpointsLoading,
  endpointSlices,
  isEndpointSlicesLoading,
  events,
  isEventsLoading,
}: {
  service: Service
  namespace?: string
  name: string
  pods?: Pod[]
  isPodsLoading: boolean
  endpoints?: Endpoints[]
  isEndpointsLoading: boolean
  endpointSlices?: EndpointSlice[]
  isEndpointSlicesLoading: boolean
  events?: KubernetesEvent[]
  isEventsLoading: boolean
}) {
  const { t } = useTranslation()
  const sortedEvents = useMemo(() => {
    return (events || []).slice().sort((a, b) => {
      const timeDiff = getEventTime(b).getTime() - getEventTime(a).getTime()
      if (timeDiff !== 0) {
        return timeDiff
      }
      return (
        Number(b.metadata?.resourceVersion || 0) -
        Number(a.metadata?.resourceVersion || 0)
      )
    })
  }, [events])
  const labels = service.metadata?.labels || {}
  const annotations = service.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('services', name, namespace)

  return (
    <div className="@container/service-overview space-y-3">
      <div className="grid gap-3 @4xl/service-overview:grid-cols-3">
        <div className="space-y-3 @4xl/service-overview:col-span-2">
          <WorkloadPodsCard
            title={t('common.fields.pods')}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('common.messages.loadingPods')}
            emptyText={t('common.messages.noPods')}
            ageLabel={t('common.fields.age')}
          />
          <div className="grid gap-3 xl:grid-cols-2">
            <ServiceEndpointResourceCard
              title="Endpoints"
              resourceType="endpoints"
              resources={endpoints}
              isLoading={isEndpointsLoading}
              loadingText="Loading endpoints..."
              emptyText="No endpoints found"
            />
            <ServiceEndpointResourceCard
              title="EndpointSlices"
              resourceType="endpointslices"
              resources={endpointSlices}
              isLoading={isEndpointSlicesLoading}
              loadingText="Loading endpoint slices..."
              emptyText="No endpoint slices found"
            />
          </div>
          <ServiceInformationCard service={service} namespace={namespace} />
        </div>

        <div className="space-y-3">
          <CompactEventsCard
            events={sortedEvents}
            isLoading={isEventsLoading}
          />
          <CompactRelatedResourcesCard
            resources={relatedResources || []}
            isLoading={isRelatedLoading}
          />
          {Object.keys(labels).length > 0 ? (
            <MetadataListCard title="common.fields.labels" entries={labels} />
          ) : null}
          {Object.keys(annotations).length > 0 ? (
            <MetadataListCard
              title="common.fields.annotations"
              entries={annotations}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

type ServiceEndpointResource = Endpoints | EndpointSlice

function ServiceEndpointResourceCard({
  title,
  resourceType,
  resources,
  isLoading,
  loadingText,
  emptyText,
}: {
  title: ReactNode
  resourceType: 'endpoints' | 'endpointslices'
  resources?: ServiceEndpointResource[]
  isLoading: boolean
  loadingText: ReactNode
  emptyText: string
}) {
  const columns = useMemo(
    (): Column<ServiceEndpointResource>[] => [
      {
        header: 'Name',
        accessor: (resource) => resource.metadata,
        cell: (value: unknown) => {
          const metadata = value as ServiceEndpointResource['metadata']
          return (
            <Link
              to={`/${resourceType}/${metadata!.namespace}/${metadata!.name}`}
              className="font-medium app-link"
            >
              {metadata!.name}
            </Link>
          )
        },
        align: 'left',
      },
      {
        header: 'Created',
        accessor: (resource) => resource.metadata?.creationTimestamp || '',
        cell: (value: unknown) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(value as string, true)}
          </span>
        ),
      },
    ],
    [resourceType]
  )
  const data = resources || []

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {title} ({data.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <div className="px-4 py-3 text-center text-muted-foreground">
            {loadingText}
          </div>
        ) : (
          <SimpleTable data={data} columns={columns} emptyMessage={emptyText} />
        )}
      </CardContent>
    </Card>
  )
}

function ServiceInformationCard({
  service,
  namespace,
}: {
  service: Service
  namespace?: string
}) {
  const { t } = useTranslation()
  const ownerInfo = getOwnerInfo(service.metadata)
  const selectorEntries = Object.entries(service.spec?.selector || {})

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('common.fields.information')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock label={t('common.fields.created')}>
              {service.metadata?.creationTimestamp
                ? formatDate(service.metadata.creationTimestamp)
                : '-'}
            </WorkloadInfoBlock>
            <WorkloadInfoBlock
              label={t('common.fields.owner')}
              truncate={!!ownerInfo}
            >
              {ownerInfo ? (
                <Link
                  to={ownerInfo.path}
                  className="app-link inline-block max-w-full truncate"
                >
                  {ownerInfo.kind}/{ownerInfo.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {t('common.values.none')}
                </span>
              )}
            </WorkloadInfoBlock>
            <WorkloadInfoBlock label={t('common.fields.selector')}>
              {selectorEntries.length > 0 ? (
                <div className="flex min-w-0 flex-wrap gap-1">
                  {selectorEntries.map(([key, value]) => (
                    <Badge
                      key={key}
                      variant="outline"
                      className="max-w-full truncate font-mono"
                      title={`${key}=${value}`}
                    >
                      {key}={value}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow label={t('common.fields.type')}>
              {service.spec?.type || 'ClusterIP'}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('common.fields.clusterIP')} mono>
              {service.spec?.clusterIP || '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('common.fields.externalIP')} mono>
              {getServiceExternalIP(service)}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('common.fields.resourceVersion')} mono>
              {service.metadata?.resourceVersion || '-'}
            </WorkloadInfoRow>
          </div>

          <div className="border-t border-border/60 pt-3">
            <ServicePorts
              namespace={namespace}
              name={service.metadata?.name || ''}
              ports={service.spec?.ports || []}
            />
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow
              label={t('common.fields.uid')}
              mono
              truncate={false}
              compact
            >
              <span className="break-all">{service.metadata?.uid || '-'}</span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ServicePorts({
  namespace,
  name,
  ports,
}: {
  namespace?: string
  name: string
  ports: ServicePort[]
}) {
  const { t } = useTranslation()

  if (ports.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('common.messages.noPorts')}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/70">
      {ports.map((port, index) => (
        <div
          key={`${port.name || index}-${port.port}-${port.protocol}`}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 py-2 text-sm"
        >
          <a
            href={withSubPath(
              `${API_BASE_URL}${withCurrentClusterPath(`/namespaces/${namespace}/services/${name}:${port.port}/proxy/`)}`
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="app-link inline-flex min-w-0 items-center gap-1 font-mono"
          >
            <span className="truncate">
              {port.name ? `${port.name}:` : ''}
              {port.port}
            </span>
            <IconExternalLink className="size-3 shrink-0" />
          </a>
          <span className="text-center text-xs text-muted-foreground">
            {port.protocol || 'TCP'}
          </span>
          <span className="text-right text-xs text-muted-foreground tabular-nums">
            {port.targetPort ? `-> ${port.targetPort}` : '-'}
          </span>
        </div>
      ))}
    </div>
  )
}
