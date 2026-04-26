import { useMemo, type ReactNode } from 'react'
import type { ObjectMeta } from 'kubernetes-types/meta/v1'
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

export interface ResourceOverviewField {
  label: ReactNode
  value: ReactNode
  mono?: boolean
  truncate?: boolean
}

export function ResourceOverview({
  resourceType,
  name,
  namespace,
  metadata,
  fields,
  children,
}: {
  resourceType: ResourceType
  name: string
  namespace?: string
  metadata?: ObjectMeta
  fields?: ResourceOverviewField[]
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const labels = metadata?.labels || {}
  const annotations = metadata?.annotations || {}
  const { data: events, isLoading: isEventsLoading } = useResourcesEvents(
    resourceType,
    name,
    namespace
  )
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources(resourceType, name, namespace)
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
    <div className="grid gap-3 xl:grid-cols-3">
      <div className="space-y-3 xl:col-span-2">
        <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
          <CardHeader className="px-3 py-2.5 !pb-2.5">
            <CardTitle className="text-balance text-sm">
              {t('resourceDetail.information')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-1">
            <div className="space-y-3">
              <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                <WorkloadInfoBlock label={t('common.created')}>
                  {metadata?.creationTimestamp
                    ? formatDate(metadata.creationTimestamp)
                    : '-'}
                </WorkloadInfoBlock>
                <WorkloadInfoBlock
                  label={t('resourceDetail.owner')}
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
                      {t('common.none')}
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
                <div className="border-t border-border/60 pt-3">{children}</div>
              ) : null}

              <div className="border-t border-border/60 pt-2">
                <WorkloadInfoRow
                  label={t('resourceDetail.uid')}
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
        <CompactEventsCard events={sortedEvents} isLoading={isEventsLoading} />
        <CompactRelatedResourcesCard
          resources={relatedResources || []}
          isLoading={isRelatedLoading}
        />
        {Object.keys(labels).length > 0 ? (
          <MetadataListCard title="pods.labels" entries={labels} />
        ) : null}
        {Object.keys(annotations).length > 0 ? (
          <MetadataListCard title="pods.annotations" entries={annotations} />
        ) : null}
      </div>
    </div>
  )
}
