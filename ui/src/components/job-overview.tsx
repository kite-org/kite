import { useMemo } from 'react'
import { Job } from 'kubernetes-types/batch/v1'
import { Event as KubernetesEvent, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useRelatedResources } from '@/lib/api'
import { formatJobStatusBadge, getJobStatusBadge } from '@/lib/job-status'
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

export function JobOverview({
  job,
  namespace,
  name,
  pods,
  isPodsLoading,
  events,
  isEventsLoading,
}: {
  job: Job
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
  const labels = job.metadata?.labels || {}
  const annotations = job.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('jobs', name, namespace)

  return (
    <div className="space-y-3">
      <JobSummaryGrid job={job} />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <WorkloadPodsCard
            title={t('jobs.pods', { defaultValue: 'Pods' })}
            pods={pods || []}
            isLoading={isPodsLoading}
            loadingText={t('jobs.loadingPods', {
              defaultValue: 'Loading pods...',
            })}
            emptyText={t('jobs.noPods', { defaultValue: 'No pods found' })}
            ageLabel={t('jobs.age', { defaultValue: 'Age' })}
          />
          <JobInformationCard job={job} />
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

function JobSummaryGrid({ job }: { job: Job }) {
  const { t } = useTranslation()
  const jobStatus = getJobStatusBadge(job)
  const succeeded = job.status?.succeeded || 0
  const completions = job.spec?.completions ?? 1

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.status')}
        value={
          <Badge variant={jobStatus.variant}>
            {formatJobStatusBadge(jobStatus, t)}
          </Badge>
        }
        detail={
          job.status?.completionTime
            ? formatDate(job.status.completionTime)
            : job.status?.startTime
              ? formatDate(job.status.startTime)
              : t('jobs.notStarted', { defaultValue: 'Not started' })
        }
      />
      <WorkloadSummaryCard
        label={t('jobs.completions', { defaultValue: 'Completions' })}
        value={`${succeeded}/${completions}`}
        detail={t('jobs.target', { defaultValue: 'Target' })}
      />
      <WorkloadSummaryCard
        label={t('jobs.succeeded', { defaultValue: 'Succeeded' })}
        value={succeeded}
        detail={t('jobs.pods', { defaultValue: 'Pods' })}
      />
      <WorkloadSummaryCard
        label={t('jobs.failed', { defaultValue: 'Failed' })}
        value={job.status?.failed || 0}
        detail={t('jobs.pods', { defaultValue: 'Pods' })}
      />
      <WorkloadSummaryCard
        label={t('jobs.active', { defaultValue: 'Active' })}
        value={job.status?.active || 0}
        detail={t('jobs.pods', { defaultValue: 'Pods' })}
      />
      <WorkloadSummaryCard
        label={t('common.created')}
        value={
          job.metadata?.creationTimestamp
            ? t('common.timeAgo', {
                time: getAge(job.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          job.metadata?.creationTimestamp
            ? formatDate(job.metadata.creationTimestamp)
            : t('jobs.notCreated', { defaultValue: 'Not created' })
        }
      />
    </div>
  )
}

function JobInformationCard({ job }: { job: Job }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(job.metadata)
  const templateSpec = job.spec?.template?.spec
  const templateContainers = [
    ...(templateSpec?.initContainers || []),
    ...(templateSpec?.containers || []),
  ]
  const selectorEntries = getJobSelectorEntries(job)
  const containersCount = templateContainers.length
  const volumesCount = templateSpec?.volumes?.length || 0
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('jobs.jobInformation', { defaultValue: 'Information' })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock
              label={t('jobs.owner', { defaultValue: 'Owner' })}
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
              label={t('jobs.selector', { defaultValue: 'Selector' })}
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
              label={t('jobs.images', { defaultValue: 'Images' })}
              truncate={false}
              className="md:col-span-2"
            >
              <ContainerImagesList containers={templateContainers} />
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow
              label={t('jobs.parallelism', { defaultValue: 'Parallelism' })}
            >
              {job.spec?.parallelism ?? 1}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.completions', { defaultValue: 'Completions' })}
            >
              {job.spec?.completions ?? 1}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.succeeded', { defaultValue: 'Succeeded' })}
            >
              {job.status?.succeeded || 0}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.failed', { defaultValue: 'Failed' })}
            >
              {job.status?.failed || 0}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.active', { defaultValue: 'Active' })}
            >
              {job.status?.active || 0}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.backoffLimit', {
                defaultValue: 'Backoff Limit',
              })}
            >
              {job.spec?.backoffLimit ?? 6}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.activeDeadline', {
                defaultValue: 'Active Deadline',
              })}
            >
              {job.spec?.activeDeadlineSeconds !== undefined
                ? `${job.spec.activeDeadlineSeconds}s`
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.ttlAfterFinished', {
                defaultValue: 'TTL After Finished',
              })}
            >
              {job.spec?.ttlSecondsAfterFinished !== undefined
                ? `${job.spec.ttlSecondsAfterFinished}s`
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.serviceAccount', {
                defaultValue: 'Service Account',
              })}
              mono
            >
              {templateSpec?.serviceAccountName || 'default'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.containers', { defaultValue: 'Containers' })}
            >
              {containersCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('jobs.volumes', { defaultValue: 'Volumes' })}
            >
              <Link to={volumeTabSearch} className="app-link">
                {volumesCount}
              </Link>
            </WorkloadInfoRow>
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">{job.metadata?.uid || '-'}</span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function getJobSelectorEntries(job: Job): Array<[string, string]> {
  const selectorEntries = Object.entries(job.spec?.selector?.matchLabels || {})
  if (selectorEntries.length > 0) {
    return selectorEntries
  }

  const labels = {
    ...(job.metadata?.labels || {}),
    ...(job.spec?.template?.metadata?.labels || {}),
  }
  const jobNameLabel =
    labels['job-name'] || labels['batch.kubernetes.io/job-name']
  if (!jobNameLabel) {
    return []
  }

  return [
    [
      labels['job-name'] ? 'job-name' : 'batch.kubernetes.io/job-name',
      jobNameLabel,
    ],
  ]
}
