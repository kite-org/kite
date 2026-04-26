import { useMemo } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconLoader,
  IconTrash,
} from '@tabler/icons-react'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useRelatedResources } from '@/lib/api'
import { getEventTime, getOwnerInfo } from '@/lib/k8s'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ContainerImagesList,
  WorkloadInfoBlock,
  WorkloadInfoRow,
  WorkloadSummaryCard,
} from '@/components/workload-overview-parts'
import { WorkloadPodsCard } from '@/components/workload-pods-card'

import {
  CompactEventsCard,
  CompactRelatedResourcesCard,
  MetadataListCard,
} from './pod-overview-sidebar'

type TranslationFn = ReturnType<typeof useTranslation>['t']
type DaemonSetStatus =
  | 'Available'
  | 'Progressing'
  | 'Pending'
  | 'Terminating'
  | 'Unknown'

export function DaemonSetOverview({
  daemonset,
  namespace,
  name,
  pods,
  isPodsLoading,
  events,
  isEventsLoading,
}: {
  daemonset: DaemonSet
  namespace: string
  name: string
  pods?: Pod[]
  isPodsLoading: boolean
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
  const labels = daemonset.metadata?.labels || {}
  const annotations = daemonset.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('daemonsets', name, namespace)

  return (
    <div className="space-y-3">
      <DaemonSetSummaryGrid daemonset={daemonset} />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <WorkloadPodsCard
            title={t('daemonsets.pods', { defaultValue: 'Pods' })}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('daemonsets.loadingPods', {
              defaultValue: 'Loading pods...',
            })}
            emptyText={t('daemonsets.noPods', {
              defaultValue: 'No pods found',
            })}
            ageLabel={t('daemonsets.age', { defaultValue: 'Age' })}
          />
          <DaemonSetInformationCard daemonset={daemonset} />
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
            <MetadataListCard title="pods.labels" entries={labels} />
          ) : null}
          {Object.keys(annotations).length > 0 ? (
            <MetadataListCard title="pods.annotations" entries={annotations} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DaemonSetSummaryGrid({ daemonset }: { daemonset: DaemonSet }) {
  const { t } = useTranslation()
  const status = daemonset.status
  const desiredPods = status?.desiredNumberScheduled || 0
  const daemonsetStatus = getDaemonSetStatus(daemonset)

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.status')}
        value={
          <span className="inline-flex min-w-0 items-center gap-2">
            <DaemonSetStatusIcon
              status={daemonsetStatus}
              className="size-4 shrink-0"
            />
            <span className="truncate">
              {formatDaemonSetStatus(daemonsetStatus, t)}
            </span>
          </span>
        }
      />
      <WorkloadSummaryCard
        label={t('common.desired')}
        value={desiredPods}
        detail={t('daemonsets.podUnits', { defaultValue: 'pods' })}
      />
      <WorkloadSummaryCard
        label={t('daemonsets.ready', { defaultValue: 'Ready' })}
        value={`${status?.numberReady || 0}/${desiredPods}`}
        detail={t('daemonsets.podUnits', { defaultValue: 'pods' })}
      />
      <WorkloadSummaryCard
        label={t('daemonsets.upToDate', { defaultValue: 'Up to date' })}
        value={status?.updatedNumberScheduled || 0}
        detail={t('daemonsets.podUnits', { defaultValue: 'pods' })}
      />
      <WorkloadSummaryCard
        label={t('daemonsets.available', { defaultValue: 'Available' })}
        value={status?.numberAvailable || 0}
        detail={t('daemonsets.podUnits', { defaultValue: 'pods' })}
      />
      <WorkloadSummaryCard
        label={t('common.created')}
        value={
          daemonset.metadata?.creationTimestamp
            ? t('common.timeAgo', {
                time: getAge(daemonset.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          daemonset.metadata?.creationTimestamp
            ? formatDate(daemonset.metadata.creationTimestamp)
            : t('daemonsets.notCreated', { defaultValue: 'Not created' })
        }
      />
    </div>
  )
}

function DaemonSetInformationCard({ daemonset }: { daemonset: DaemonSet }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(daemonset.metadata)
  const selectorEntries = Object.entries(
    daemonset.spec?.selector?.matchLabels || {}
  )
  const templateSpec = daemonset.spec?.template?.spec
  const templateContainers = [
    ...(templateSpec?.initContainers || []),
    ...(templateSpec?.containers || []),
  ]
  const containersCount = templateContainers.length
  const volumesCount = templateSpec?.volumes?.length || 0
  const updateStrategy = daemonset.spec?.updateStrategy
  const rollingUpdate = updateStrategy?.rollingUpdate
  const revision =
    daemonset.metadata?.annotations?.['daemonset.kubernetes.io/revision'] ||
    daemonset.metadata?.annotations?.[
      'deprecated.daemonset.template.generation'
    ]
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('daemonsets.daemonSetInformation', {
            defaultValue: 'DaemonSet Information',
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock
              label={t('daemonsets.owner', { defaultValue: 'Owner' })}
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
            <WorkloadInfoBlock
              label={t('daemonsets.selector', { defaultValue: 'Selector' })}
              truncate={selectorEntries.length === 0}
            >
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
            <WorkloadInfoBlock
              label={t('daemonsets.images', { defaultValue: 'Images' })}
              truncate={false}
              className="md:col-span-2"
            >
              <ContainerImagesList containers={templateContainers} />
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow
              label={t('daemonsets.strategy', { defaultValue: 'Strategy' })}
            >
              {updateStrategy?.type || 'RollingUpdate'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.maxUnavailable', {
                defaultValue: 'maxUnavailable',
              })}
            >
              {rollingUpdate?.maxUnavailable !== undefined
                ? String(rollingUpdate.maxUnavailable)
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.serviceAccount', {
                defaultValue: 'Service Account',
              })}
              mono
            >
              {templateSpec?.serviceAccountName || 'default'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.containers', {
                defaultValue: 'Containers',
              })}
            >
              {containersCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.volumes', { defaultValue: 'Volumes' })}
            >
              {volumesCount > 0 ? (
                <Link to={volumeTabSearch} className="app-link">
                  {volumesCount}
                </Link>
              ) : (
                0
              )}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.minReadySeconds', {
                defaultValue: 'minReadySeconds',
              })}
            >
              {daemonset.spec?.minReadySeconds ?? 0}s
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('daemonsets.observedGeneration', {
                defaultValue: 'observedGeneration',
              })}
            >
              {daemonset.status?.observedGeneration ?? '-'}
            </WorkloadInfoRow>
            {revision ? (
              <WorkloadInfoRow
                label={t('daemonsets.revision', { defaultValue: 'Revision' })}
              >
                {revision}
              </WorkloadInfoRow>
            ) : null}
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">
                {daemonset.metadata?.uid || '-'}
              </span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DaemonSetStatusIcon({
  status,
  className,
}: {
  status: DaemonSetStatus
  className?: string
}) {
  switch (status) {
    case 'Available':
      return (
        <IconCircleCheckFilled
          className={`fill-green-500 dark:fill-green-400 ${className || ''}`}
        />
      )
    case 'Progressing':
      return (
        <IconLoader
          className={`animate-spin text-blue-500 dark:text-blue-400 ${className || ''}`}
        />
      )
    case 'Terminating':
      return (
        <IconTrash
          className={`text-orange-500 dark:text-orange-400 ${className || ''}`}
        />
      )
    default:
      return (
        <IconExclamationCircle
          className={`fill-gray-500 dark:fill-gray-400 ${className || ''}`}
        />
      )
  }
}

function getDaemonSetStatus(daemonset: DaemonSet): DaemonSetStatus {
  if (daemonset.metadata?.deletionTimestamp) {
    return 'Terminating'
  }

  const status = daemonset.status
  if (!status) {
    return 'Unknown'
  }

  const desired = status.desiredNumberScheduled || 0
  if (desired === 0) {
    return 'Pending'
  }

  const ready = status.numberReady || 0
  const available = status.numberAvailable || 0
  const updated = status.updatedNumberScheduled || 0
  const current = status.currentNumberScheduled || 0

  if (
    ready === desired &&
    available === desired &&
    updated === desired &&
    current === desired
  ) {
    return 'Available'
  }

  return 'Progressing'
}

function formatDaemonSetStatus(value: DaemonSetStatus, t: TranslationFn) {
  const key = value
    .replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^./, (letter) => letter.toLowerCase())
  return t(`daemonsets.statuses.${key}`, { defaultValue: value })
}
