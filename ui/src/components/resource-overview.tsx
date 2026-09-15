import { useMemo } from 'react'
import type { ResourceOverviewProps as PluginResourceOverviewProps } from '@kite-dev/plugin-sdk/ui'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { ResourceType } from '@/types/api'
import { useRelatedResources, useResourcesEvents } from '@/lib/api'
import { getEventTime, getOwnerInfo } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  WorkloadInfoBlock,
  WorkloadInfoRow,
} from '@/components/workload-overview-parts'

import {
  CompactEventsCard,
  CompactRelatedResourcesCard,
  MetadataListCard,
} from './pod-overview-sidebar'

interface ResourceOverviewProps extends Omit<
  PluginResourceOverviewProps,
  'resource'
> {
  resourceType: ResourceType
}

export function ResourceOverview({
  resourceType,
  name,
  namespace,
  metadata,
  fields,
  children,
  relatedResources,
}: ResourceOverviewProps) {
  const { t } = useTranslation()
  const labels = metadata?.labels || {}
  const annotations = metadata?.annotations || {}
  const { data: events, isLoading: isEventsLoading } = useResourcesEvents(
    resourceType,
    name,
    namespace
  )
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
  const ownerInfo = getOwnerInfo(metadata)

  return (
    <div className="@container/resource-overview">
      <div className="grid gap-3 @4xl/resource-overview:grid-cols-3">
        <div className="space-y-3 @4xl/resource-overview:col-span-2">
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
                    {metadata?.creationTimestamp
                      ? formatDate(metadata.creationTimestamp)
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
                </div>

                {fields && fields.length > 0 ? (
                  <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
                    {fields.map((field, index) => (
                      <WorkloadInfoRow
                        key={index}
                        label={field.label}
                        mono={field.mono}
                        truncate={field.truncate}
                      >
                        {field.value}
                      </WorkloadInfoRow>
                    ))}
                  </div>
                ) : null}

                {children ? (
                  <div className="border-t border-border/60 pt-3">
                    {children}
                  </div>
                ) : null}

                <div className="border-t border-border/60 pt-2">
                  <WorkloadInfoRow
                    label={t('common.fields.uid')}
                    mono
                    truncate={false}
                    compact
                  >
                    <span className="break-all">{metadata?.uid || '-'}</span>
                  </WorkloadInfoRow>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <CompactEventsCard
            events={sortedEvents}
            isLoading={isEventsLoading}
          />
          {relatedResources === undefined ? (
            <RelatedResourcesCard
              resourceType={resourceType}
              name={name}
              namespace={namespace}
            />
          ) : (
            relatedResources
          )}
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

function RelatedResourcesCard({
  resourceType,
  name,
  namespace,
}: {
  resourceType: ResourceType
  name: string
  namespace?: string
}) {
  const { data, isLoading } = useRelatedResources(resourceType, name, namespace)
  return (
    <CompactRelatedResourcesCard resources={data ?? []} isLoading={isLoading} />
  )
}
