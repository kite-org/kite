import { useMemo, useState } from 'react'
import { IconExternalLink } from '@tabler/icons-react'
import { CronJob, Job } from 'kubernetes-types/batch/v1'
import { Event as KubernetesEvent } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { useRelatedResources } from '@/lib/api'
import { formatJobStatusBadge, getJobStatusBadge } from '@/lib/job-status'
import { getEventTime, getOwnerInfo } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { cn, formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ContainerImagesList,
  WorkloadInfoBlock,
  WorkloadInfoRow,
  WorkloadSummaryCard,
} from '@/components/workload-overview-parts'

import {
  CompactEventsCard,
  CompactRelatedResourcesCard,
  MetadataListCard,
} from './pod-overview-sidebar'

type TranslationFn = ReturnType<typeof useTranslation>['t']

interface CronJobStatusBadge {
  key: 'suspended' | 'active' | 'idle' | 'pending'
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

export function CronJobOverview({
  cronjob,
  namespace,
  name,
  jobs,
  isJobsLoading,
  events,
  isEventsLoading,
}: {
  cronjob: CronJob
  namespace: string
  name: string
  jobs?: Job[]
  isJobsLoading: boolean
  events?: KubernetesEvent[]
  isEventsLoading: boolean
}) {
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
  const labels = cronjob.metadata?.labels || {}
  const annotations = cronjob.metadata?.annotations || {}
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('cronjobs', name, namespace)

  return (
    <div className="space-y-3">
      <CronJobSummaryGrid cronjob={cronjob} />

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <CronJobJobsCard jobs={jobs || []} isLoading={isJobsLoading} />
          <CronJobInformationCard cronjob={cronjob} />
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

function CronJobSummaryGrid({ cronjob }: { cronjob: CronJob }) {
  const { t } = useTranslation()
  const cronJobStatus = getCronJobStatusBadge(cronjob)
  const lastScheduleTime = cronjob.status?.lastScheduleTime
  const lastSuccessfulTime = cronjob.status?.lastSuccessfulTime

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <WorkloadSummaryCard
        label={t('common.status')}
        value={
          <Badge variant={cronJobStatus.variant}>
            {formatCronJobStatus(cronJobStatus, t)}
          </Badge>
        }
      />
      <WorkloadSummaryCard
        label={t('cronjobs.schedule', 'Schedule')}
        value={cronjob.spec?.schedule || '-'}
        detail={
          cronjob.spec?.timeZone ||
          t('cronjobs.clusterDefault', 'Cluster default')
        }
        mono
      />
      <WorkloadSummaryCard
        label={t('cronjobs.activeJobs', 'Active Jobs')}
        value={cronjob.status?.active?.length || 0}
        detail={t('cronjobs.jobs', 'Jobs')}
      />
      <WorkloadSummaryCard
        label={t('cronjobs.lastSchedule', 'Last Schedule')}
        value={lastScheduleTime ? getAge(lastScheduleTime) : '-'}
        detail={lastScheduleTime ? formatDate(lastScheduleTime) : undefined}
      />
      <WorkloadSummaryCard
        label={t('cronjobs.lastSuccessful', 'Last Successful')}
        value={lastSuccessfulTime ? getAge(lastSuccessfulTime) : '-'}
        detail={lastSuccessfulTime ? formatDate(lastSuccessfulTime) : undefined}
      />
      <WorkloadSummaryCard
        label={t('common.created')}
        value={
          cronjob.metadata?.creationTimestamp
            ? t('common.timeAgo', {
                time: getAge(cronjob.metadata.creationTimestamp),
              })
            : '-'
        }
        detail={
          cronjob.metadata?.creationTimestamp
            ? formatDate(cronjob.metadata.creationTimestamp)
            : undefined
        }
      />
    </div>
  )
}

function CronJobJobsCard({
  jobs,
  isLoading,
}: {
  jobs: Job[]
  isLoading: boolean
}) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('cronjobs.jobs', 'Jobs')} ({jobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="w-full min-w-full table-fixed">
          <colgroup>
            <col />
            <col className="w-28" />
            <col className="w-20" />
            <col className="w-32" />
            <col className="w-32" />
            <col className="w-20" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-4">
                {t('cronjobs.jobsTable.name', 'Name')}
              </TableHead>
              <TableHead className="h-8 px-1 text-center">
                {t('common.status')}
              </TableHead>
              <TableHead className="h-8 px-1 text-center">
                {t('cronjobs.jobsTable.succeeded', 'Succeeded')}
              </TableHead>
              <TableHead className="h-8 px-1 text-center">
                {t('cronjobs.jobsTable.started', 'Started')}
              </TableHead>
              <TableHead className="h-8 px-1 text-center">
                {t('cronjobs.jobsTable.completed', 'Completed')}
              </TableHead>
              <TableHead className="h-8 px-1 text-center">
                {t('cronjobs.jobsTable.age', 'Age')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="px-4 py-3 text-center text-muted-foreground"
                >
                  {t('cronjobs.loadingJobs', 'Loading jobs...')}
                </TableCell>
              </TableRow>
            ) : jobs.length > 0 ? (
              jobs.map((job) => (
                <CronJobJobRow
                  key={job.metadata?.uid || job.metadata?.name}
                  job={job}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="px-4 py-3 text-center text-muted-foreground"
                >
                  {t('cronjobs.noJobs', 'No jobs found for this CronJob')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function CronJobJobRow({ job }: { job: Job }) {
  const { t } = useTranslation()
  const statusBadge = getJobStatusBadge(job)
  const age = job.metadata?.creationTimestamp
    ? getAge(job.metadata.creationTimestamp)
    : '-'

  return (
    <TableRow>
      <TableCell className="px-4 py-1.5">
        <CronJobJobLink job={job} />
      </TableCell>
      <TableCell className="px-1 py-1.5 text-center">
        <Badge variant={statusBadge.variant}>
          {formatJobStatusBadge(statusBadge, t, 'cronjobs.jobStatuses')}
        </Badge>
      </TableCell>
      <TableCell className="px-1 py-1.5 text-center tabular-nums">
        {job.status?.succeeded || 0}/{job.spec?.completions ?? 1}
      </TableCell>
      <TableCell
        className="px-1 py-1.5 text-center text-muted-foreground"
        title={job.status?.startTime}
      >
        {job.status?.startTime ? formatDate(job.status.startTime) : '-'}
      </TableCell>
      <TableCell
        className="px-1 py-1.5 text-center text-muted-foreground"
        title={job.status?.completionTime}
      >
        {job.status?.completionTime
          ? formatDate(job.status.completionTime)
          : '-'}
      </TableCell>
      <TableCell
        className="px-1 py-1.5 text-center text-muted-foreground tabular-nums"
        title={
          job.metadata?.creationTimestamp
            ? formatDate(job.metadata.creationTimestamp, true)
            : undefined
        }
      >
        {age}
      </TableCell>
    </TableRow>
  )
}

function CronJobInformationCard({ cronjob }: { cronjob: CronJob }) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ownerInfo = getOwnerInfo(cronjob.metadata)
  const templateSpec = cronjob.spec?.jobTemplate?.spec?.template?.spec
  const initContainers = templateSpec?.initContainers || []
  const containers = templateSpec?.containers || []
  const templateContainers = [...initContainers, ...containers]
  const containersCount = templateContainers.length
  const volumesCount = templateSpec?.volumes?.length || 0
  const volumeTabSearchParams = new URLSearchParams(searchParams)
  volumeTabSearchParams.set('tab', 'volumes')
  const volumeTabSearch = `?${volumeTabSearchParams.toString()}`

  return (
    <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
      <CardHeader className="px-3 py-2.5 !pb-2.5">
        <CardTitle className="text-balance text-sm">
          {t('cronjobs.cronJobInformation', 'CronJob Information')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1">
        <div className="space-y-3">
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <WorkloadInfoBlock
              label={t('cronjobs.owner', 'Owner')}
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
              label={t('cronjobs.schedule', 'Schedule')}
              mono
              truncate={false}
            >
              {cronjob.spec?.schedule || '-'}
            </WorkloadInfoBlock>
            <WorkloadInfoBlock
              label={t('cronjobs.images', 'Images')}
              truncate={false}
              className="md:col-span-2"
            >
              <ContainerImagesList containers={templateContainers} />
            </WorkloadInfoBlock>
          </div>

          <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
            <WorkloadInfoRow label={t('cronjobs.suspend', 'Suspend')}>
              {cronjob.spec?.suspend ? t('common.yes') : t('common.no')}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('cronjobs.concurrencyPolicy', 'Concurrency Policy')}
            >
              {cronjob.spec?.concurrencyPolicy || 'Allow'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('cronjobs.startingDeadline', 'Starting Deadline')}
            >
              {cronjob.spec?.startingDeadlineSeconds !== undefined
                ? `${cronjob.spec.startingDeadlineSeconds}s`
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t(
                'cronjobs.successfulJobsHistoryLimit',
                'Successful Jobs History Limit'
              )}
            >
              {cronjob.spec?.successfulJobsHistoryLimit ?? 3}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t(
                'cronjobs.failedJobsHistoryLimit',
                'Failed Jobs History Limit'
              )}
            >
              {cronjob.spec?.failedJobsHistoryLimit ?? 1}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('cronjobs.lastSchedule', 'Last Schedule')}
            >
              {cronjob.status?.lastScheduleTime
                ? formatDate(cronjob.status.lastScheduleTime, true)
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow
              label={t('cronjobs.lastSuccessful', 'Last Successful')}
            >
              {cronjob.status?.lastSuccessfulTime
                ? formatDate(cronjob.status.lastSuccessfulTime, true)
                : '-'}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('cronjobs.timeZone', 'Time Zone')}>
              {cronjob.spec?.timeZone ||
                t('cronjobs.clusterDefault', 'Cluster default')}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('cronjobs.containers', 'Containers')}>
              {containersCount}
            </WorkloadInfoRow>
            <WorkloadInfoRow label={t('cronjobs.volumes', 'Volumes')}>
              {volumesCount > 0 ? (
                <Link to={volumeTabSearch} className="app-link">
                  {volumesCount}
                </Link>
              ) : (
                0
              )}
            </WorkloadInfoRow>
          </div>

          <div className="border-t border-border/60 pt-2">
            <WorkloadInfoRow label="UID" mono truncate={false} compact>
              <span className="break-all">{cronjob.metadata?.uid || '-'}</span>
            </WorkloadInfoRow>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CronJobJobLink({
  job,
  className,
}: {
  job: Job
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const jobName = job.metadata?.name || '-'
  const namespace = job.metadata?.namespace
  const path =
    namespace && job.metadata?.name
      ? `/jobs/${namespace}/${job.metadata.name}`
      : undefined

  if (!path) {
    return (
      <span
        className={cn('block max-w-full truncate font-mono', className)}
        title={jobName}
      >
        {jobName}
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'app-link block max-w-full cursor-pointer truncate text-left font-mono',
            className
          )}
          title={jobName}
        >
          {jobName}
        </button>
      </DialogTrigger>
      <DialogContent className="!h-[calc(100dvh-1rem)] !max-w-[calc(100vw-1rem)] flex min-h-0 flex-col gap-0 p-0 md:!h-[80%] md:!max-w-[60%]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3 pr-14">
          <DialogTitle>{t('cronjobs.job', 'Job')}</DialogTitle>
          <a href={withSubPath(path)} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="icon"
              aria-label="Open resource in new tab"
            >
              <IconExternalLink size={12} />
            </Button>
          </a>
        </DialogHeader>
        <iframe
          src={`${withSubPath(path)}?iframe=true`}
          className="min-h-0 w-full flex-grow border-none"
        />
      </DialogContent>
    </Dialog>
  )
}

function getCronJobStatusBadge(cronjob: CronJob): CronJobStatusBadge {
  if (cronjob.spec?.suspend) {
    return { key: 'suspended', label: 'Suspended', variant: 'secondary' }
  }
  if ((cronjob.status?.active?.length || 0) > 0) {
    return { key: 'active', label: 'Active', variant: 'default' }
  }
  if (cronjob.status?.lastSuccessfulTime) {
    return { key: 'idle', label: 'Idle', variant: 'outline' }
  }
  return { key: 'pending', label: 'Pending', variant: 'outline' }
}

function formatCronJobStatus(badge: CronJobStatusBadge, t: TranslationFn) {
  return t(`cronjobs.statuses.${badge.key}`, {
    defaultValue: badge.label,
  })
}
