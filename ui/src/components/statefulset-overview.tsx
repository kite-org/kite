import { useMemo } from 'react'
import { StatefulSet } from 'kubernetes-types/apps/v1'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { DeploymentStatusType } from '@/types/k8s'
import { useRelatedResources } from '@/lib/api'
import { getEventTime, getOwnerInfo } from '@/lib/k8s'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeploymentStatusIcon } from '@/components/deployment-status-icon'
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

export function StatefulSetOverview({
  statefulset,
  namespace,
  name,
  pods,
  isPodsLoading,
  events,
  isEventsLoading,
}: {
  statefulset: StatefulSet
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
  const labels = statefulset.metadata?.labels || {}
  const annotations = statefulset.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('statefulsets', name, namespace)

  return (
    <div className="space-y-3">
      <StatefulSetSummaryGrid statefulset={statefulset} />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <WorkloadPodsCard
            title={t('common.fields.pods', { defaultValue: 'Pods' })}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('common.messages.loadingPods', {
              defaultValue: 'Loading pods...',
            })}
            emptyText={t('common.messages.noPods', {
              defaultValue: 'No pods found',
            })}
            ageLabel={t('common.fields.age', { defaultValue: 'Age' })}
          />
          <StatefulSetInformationCard statefulset={statefulset} />
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

function StatefulSetSummaryGrid({ statefulset }: { statefulset: StatefulSet }) {
  const { t } = useTranslation()
  const status = statefulset.status
  const desiredReplicas = statefulset.spec?.replicas ?? 0
  const statefulSetStatus = getStatefulSetStatus(statefulset)

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.fields.status')}
        value={
          <span className="inline-flex min-w-0 items-center gap-2">
            <DeploymentStatusIcon
              status={statefulSetStatus}
              className="size-4 shrink-0"
            />
            <span className="truncate">
              {formatStatefulSetStatus(statefulSetStatus, t)}
            </span>
          </span>
        }
      />
      <WorkloadSummaryCard
        label={t('common.fields.desired')}
        value={desiredReplicas}
        detail={t('common.fields.replicas', { defaultValue: 'Replicas' })}
      />
      <WorkloadSummaryCard
        label={t('common.fields.ready', { defaultValue: 'Ready' })}
        value={`${status?.readyReplicas || 0}/${desiredReplicas}`}
        detail={t('common.fields.replicas', { defaultValue: 'Replicas' })}
      />
      <WorkloadSummaryCard
        label={t('common.fields.current', { defaultValue: 'Current' })}
        value={status?.currentReplicas || 0}
        detail={t('common.fields.replicas', { defaultValue: 'Replicas' })}
      />
      <WorkloadSummaryCard
        label={t('common.fields.updated', { defaultValue: 'Updated' })}
        value={status?.updatedReplicas || 0}
        detail={t('common.fields.replicas', { defaultValue: 'Replicas' })}
      />
      <WorkloadSummaryCard
        label={t('common.fields.created')}
        value={
          statefulset.metadata?.creationTimestamp
            ? t('common.messages.timeAgo', {
                time: getAge(statefulset.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          statefulset.metadata?.creationTimestamp
            ? formatDate(statefulset.metadata.creationTimestamp)
            : t('common.messages.notCreated')
        }
      />
    </div>
  )
}

function StatefulSetInformationCard({
  statefulset,
}: {
  statefulset: StatefulSet
}) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(statefulset.metadata)
  const selectorEntries = Object.entries(
    statefulset.spec?.selector?.matchLabels || {}
  )
  const templateSpec = statefulset.spec?.template?.spec
  const templateContainers = [
    ...(templateSpec?.initContainers || []),
    ...(templateSpec?.containers || []),
  ]
  const containersCount = templateContainers.length
  const volumesCount = templateSpec?.volumes?.length || 0
  const persistentVolumeClaimsCount =
    statefulset.spec?.volumeClaimTemplates?.length || 0
  const revision =
    statefulset.metadata?.annotations?.['statefulset.kubernetes.io/revision']
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('common.fields.information', {
            defaultValue: 'Information',
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock
              label={t('common.fields.owner', { defaultValue: 'Owner' })}
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
            <WorkloadInfoBlock
              label={t('common.fields.selector', { defaultValue: 'Selector' })}
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
              label={t('common.fields.images', { defaultValue: 'Images' })}
              truncate={false}
              className="md:col-span-2"
            >
              <ContainerImagesList containers={templateContainers} />
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow
              label={t('common.fields.serviceName', {
                defaultValue: 'Service Name',
              })}
              mono
            >
              {statefulset.spec?.serviceName || '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('common.fields.strategy', { defaultValue: 'Strategy' })}
            >
              {statefulset.spec?.updateStrategy?.type || 'RollingUpdate'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('statefulsets.podManagementPolicy', {
                defaultValue: 'Pod Management Policy',
              })}
            >
              {statefulset.spec?.podManagementPolicy || 'OrderedReady'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('common.fields.persistentVolumeClaims', {
                defaultValue: 'Persistent Volume Claims',
              })}
            >
              {persistentVolumeClaimsCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('common.fields.serviceAccount', {
                defaultValue: 'Service Account',
              })}
              mono
            >
              {templateSpec?.serviceAccountName || 'default'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('common.fields.containers', {
                defaultValue: 'Containers',
              })}
            >
              {containersCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('common.fields.volumes', { defaultValue: 'Volumes' })}
            >
              {volumesCount > 0 ? (
                <Link to={volumeTabSearch} className="app-link">
                  {volumesCount}
                </Link>
              ) : (
                0
              )}
            </WorkloadInfoRow>
            {revision ? (
              <WorkloadInfoRow
                label={t('common.fields.revision', {
                  defaultValue: 'Revision',
                })}
                mono
              >
                {revision}
              </WorkloadInfoRow>
            ) : null}
            {statefulset.status?.currentRevision ? (
              <WorkloadInfoRow
                label={t('common.fields.currentRevision', {
                  defaultValue: 'Current Revision',
                })}
                mono
              >
                {statefulset.status.currentRevision}
              </WorkloadInfoRow>
            ) : null}
            {statefulset.status?.updateRevision ? (
              <WorkloadInfoRow
                label={t('common.fields.updateRevision', {
                  defaultValue: 'Update Revision',
                })}
                mono
              >
                {statefulset.status.updateRevision}
              </WorkloadInfoRow>
            ) : null}
            {statefulset.status?.observedGeneration !== undefined ? (
              <WorkloadInfoRow
                label={t('common.fields.observedGeneration', {
                  defaultValue: 'Observed Generation',
                })}
              >
                {statefulset.status.observedGeneration}
              </WorkloadInfoRow>
            ) : null}
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">
                {statefulset.metadata?.uid || '-'}
              </span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function getStatefulSetStatus(statefulset: StatefulSet): DeploymentStatusType {
  if (statefulset.metadata?.deletionTimestamp) {
    return 'Terminating'
  }

  const desiredReplicas = statefulset.spec?.replicas ?? 0
  if (desiredReplicas === 0) {
    return 'Scaled Down'
  }

  if (!statefulset.status) {
    return 'Unknown'
  }

  const status = statefulset.status
  const replicas = status.replicas || 0
  const readyReplicas = status.readyReplicas || 0
  const updatedReplicas = status.updatedReplicas || 0

  if (
    replicas === desiredReplicas &&
    readyReplicas === desiredReplicas &&
    updatedReplicas === desiredReplicas
  ) {
    return 'Available'
  }

  return 'Progressing'
}

function formatStatefulSetStatus(value: string, t: TranslationFn) {
  const key = value
    .replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^./, (letter) => letter.toLowerCase())
  return t(`status.${key}`, { defaultValue: value })
}
