import { useMemo } from 'react'
import { Deployment } from 'kubernetes-types/apps/v1'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useRelatedResources } from '@/lib/api'
import { getDeploymentStatus, getEventTime, getOwnerInfo } from '@/lib/k8s'
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

export function DeploymentOverview({
  deployment,
  namespace,
  name,
  pods,
  isPodsLoading,
  events,
  isEventsLoading,
}: {
  deployment: Deployment
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
  const labels = deployment.metadata?.labels || {}
  const annotations = deployment.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('deployments', name, namespace)

  return (
    <div className="space-y-3">
      <DeploymentSummaryGrid deployment={deployment} />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <WorkloadPodsCard
            title={t('deployments.pods')}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('deployments.loadingPods')}
            emptyText={t('deployments.noPods')}
            ageLabel={t('deployments.age')}
          />
          <DeploymentInformationCard deployment={deployment} />
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

function DeploymentSummaryGrid({ deployment }: { deployment: Deployment }) {
  const { t } = useTranslation()
  const status = deployment.status
  const desiredReplicas = deployment.spec?.replicas ?? 0
  const deploymentStatus = getDeploymentStatus(deployment)

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.status')}
        value={
          <span className="inline-flex min-w-0 items-center gap-2">
            <DeploymentStatusIcon
              status={deploymentStatus}
              className="size-4 shrink-0"
            />
            <span className="truncate">
              {formatDeploymentStatus(deploymentStatus, t)}
            </span>
          </span>
        }
        detail={deployment.spec?.paused ? t('deployments.paused') : undefined}
      />
      <WorkloadSummaryCard
        label={t('common.desired')}
        value={desiredReplicas}
        detail={t('deployments.replicas')}
      />
      <WorkloadSummaryCard
        label={t('deployments.ready')}
        value={`${status?.readyReplicas || 0}/${desiredReplicas}`}
        detail={t('deployments.replicas')}
      />
      <WorkloadSummaryCard
        label={t('deployments.upToDate')}
        value={status?.updatedReplicas || 0}
        detail={t('deployments.replicas')}
      />
      <WorkloadSummaryCard
        label={t('deployments.available')}
        value={status?.availableReplicas || 0}
        detail={t('deployments.replicas')}
      />
      <WorkloadSummaryCard
        label={t('common.created')}
        value={
          deployment.metadata?.creationTimestamp
            ? t('common.timeAgo', {
                time: getAge(deployment.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          deployment.metadata?.creationTimestamp
            ? formatDate(deployment.metadata.creationTimestamp)
            : t('pods.notCreated')
        }
      />
    </div>
  )
}

function DeploymentInformationCard({ deployment }: { deployment: Deployment }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(deployment.metadata)
  const selectorEntries = Object.entries(
    deployment.spec?.selector?.matchLabels || {}
  )
  const templateSpec = deployment.spec?.template?.spec
  const templateContainers = [
    ...(templateSpec?.initContainers || []),
    ...(templateSpec?.containers || []),
  ]
  const containersCount = templateContainers.length
  const volumesCount = templateSpec?.volumes?.length || 0
  const strategy = deployment.spec?.strategy
  const rollingUpdate = strategy?.rollingUpdate
  const revision =
    deployment.metadata?.annotations?.['deployment.kubernetes.io/revision']
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('deployments.deploymentInformation')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock
              label={t('deployments.owner')}
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
              label={t('deployments.selector')}
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
              label={t('deployments.images')}
              truncate={false}
              className="md:col-span-2"
            >
              <ContainerImagesList containers={templateContainers} />
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow label={t('deployments.strategy')}>
              {strategy?.type || 'RollingUpdate'}
            </WorkloadInfoRow>
            {revision ? (
              <WorkloadInfoRow label={t('deployments.revision')}>
                {revision}
              </WorkloadInfoRow>
            ) : null}
            {rollingUpdate?.maxSurge !== undefined ? (
              <WorkloadInfoRow label={t('deployments.maxSurge')}>
                {String(rollingUpdate.maxSurge)}
              </WorkloadInfoRow>
            ) : null}
            {rollingUpdate?.maxUnavailable !== undefined ? (
              <WorkloadInfoRow label={t('deployments.maxUnavailable')}>
                {String(rollingUpdate.maxUnavailable)}
              </WorkloadInfoRow>
            ) : null}
            <WorkloadInfoRow label={t('deployments.serviceAccount')} mono>
              {templateSpec?.serviceAccountName || 'default'}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('deployments.containers')}>
              {containersCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('deployments.volumes')}>
              {volumesCount > 0 ? (
                <Link to={volumeTabSearch} className="app-link">
                  {volumesCount}
                </Link>
              ) : (
                0
              )}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('deployments.minReadySeconds')}>
              {deployment.spec?.minReadySeconds ?? 0}s
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('deployments.progressDeadline')}>
              {deployment.spec?.progressDeadlineSeconds !== undefined
                ? `${deployment.spec.progressDeadlineSeconds}s`
                : '-'}
            </WorkloadInfoRow>
            {deployment.spec?.paused ? (
              <WorkloadInfoRow label={t('deployments.paused')}>
                {t('common.yes')}
              </WorkloadInfoRow>
            ) : null}
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">
                {deployment.metadata?.uid || '-'}
              </span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function formatDeploymentStatus(value: string, t: TranslationFn) {
  const key = value
    .replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^./, (letter) => letter.toLowerCase())
  return t(`deployments.statuses.${key}`, { defaultValue: value })
}
