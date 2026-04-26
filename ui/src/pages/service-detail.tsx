import { useMemo } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { Service, ServicePort } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource } from '@/lib/api'
import { getServiceExternalIP } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { Badge } from '@/components/ui/badge'
import { EventTable } from '@/components/event-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { ResourceOverview } from '@/components/resource-overview'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function ServiceDetail(props: { name: string; namespace?: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()

  const { data, isLoading, isError, error, refetch } = useResource(
    'services',
    name,
    namespace
  )

  const handleSaveYaml = async (content: Service) => {
    await updateResource('services', name, namespace, content)
    toast.success('YAML saved successfully')
    await refetch()
  }

  const tabs = useMemo<ResourceDetailShellTab<Service>[]>(
    () => [
      {
        value: 'related',
        label: 'Related',
        content: (
          <RelatedResourcesTable
            resource="services"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: 'Events',
        content: (
          <EventTable resource="services" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'history',
        label: 'History',
        content: data ? (
          <ResourceHistoryTable
            resourceType="services"
            name={name}
            namespace={namespace}
            currentResource={data}
          />
        ) : null,
      },
    ],
    [data, name, namespace]
  )

  return (
    <ResourceDetailShell
      resourceType="services"
      resourceLabel="Service"
      name={name}
      namespace={namespace}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        data ? (
          <ResourceOverview
            resourceType="services"
            name={name}
            namespace={namespace}
            metadata={data.metadata}
            fields={[
              {
                label: t('resourceDetail.type'),
                value: data.spec?.type || 'ClusterIP',
              },
              {
                label: t('resourceDetail.clusterIP'),
                value: data.spec?.clusterIP || '-',
                mono: true,
              },
              {
                label: t('resourceDetail.externalIP'),
                value: getServiceExternalIP(data),
                mono: true,
              },
              {
                label: t('resourceDetail.selector'),
                value: <ServiceSelector labels={data.spec?.selector || {}} />,
                truncate: false,
              },
              {
                label: t('resourceDetail.resourceVersion'),
                value: data.metadata?.resourceVersion || '-',
                mono: true,
              },
            ]}
          >
            <ServicePorts
              namespace={namespace}
              name={name}
              ports={data.spec?.ports || []}
            />
          </ResourceOverview>
        ) : null
      }
      extraTabs={tabs}
    />
  )
}

function ServiceSelector({ labels }: { labels: Record<string, string> }) {
  const entries = Object.entries(labels)
  if (entries.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {entries.map(([key, value]) => (
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
        {t('resourceDetail.noPorts')}
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
              `/api/v1/namespaces/${namespace}/services/${name}:${port.port}/proxy/`
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
