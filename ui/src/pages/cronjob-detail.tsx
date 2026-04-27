import { useMemo, useState } from 'react'
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
} from '@tabler/icons-react'
import { CronJob, Job } from 'kubernetes-types/batch/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  createResource,
  updateResource,
  useResource,
  useResources,
  useResourcesEvents,
} from '@/lib/api'
import {
  formatJobStatusBadge,
  getJobStatusBadge,
  type JobStatusBadge,
} from '@/lib/job-status'
import { formatDate, getAge, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ContainerInfoCard } from '@/components/container-info-card'
import { CronJobJobLink, CronJobOverview } from '@/components/cronjob-overview'
import { EventTable } from '@/components/event-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { Column, SimpleTable } from '@/components/simple-table'
import { VolumeTable } from '@/components/volume-table'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function CronJobDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [isTogglingSuspend, setIsTogglingSuspend] = useState(false)
  const [isRunningNow, setIsRunningNow] = useState(false)
  const { t } = useTranslation()

  const {
    data: cronjob,
    isLoading,
    isError,
    error: cronJobError,
    refetch: refetchCronJob,
  } = useResource('cronjobs', name, namespace)

  const {
    data: jobs,
    isLoading: isLoadingJobs,
    refetch: refetchJobs,
  } = useResources('jobs', namespace, {
    disable: !namespace,
  })
  const { data: cronJobEvents, isLoading: isEventsLoading } =
    useResourcesEvents('cronjobs', name, namespace)

  const cronJobJobs = useMemo(() => {
    if (!jobs) return [] as Job[]
    return jobs.filter((job) =>
      job.metadata?.ownerReferences?.some(
        (owner) => owner.kind === 'CronJob' && owner.name === name
      )
    )
  }, [jobs, name])

  const sortedJobs = useMemo(() => {
    return [...cronJobJobs].sort((a, b) => {
      const aTime = new Date(a.metadata?.creationTimestamp || 0).getTime()
      const bTime = new Date(b.metadata?.creationTimestamp || 0).getTime()
      return bTime - aTime
    })
  }, [cronJobJobs])

  const jobColumns = useMemo<Column<Job>[]>(
    () => [
      {
        header: t('common.fields.name', 'Name'),
        accessor: (job) => job,
        align: 'left',
        cell: (value) => {
          const job = value as Job
          return <CronJobJobLink job={job} />
        },
      },
      {
        header: t('common.fields.status'),
        accessor: (job) => getJobStatusBadge(job),
        cell: (value) => {
          const badge = value as JobStatusBadge
          return (
            <Badge variant={badge.variant}>
              {formatJobStatusBadge(badge, t, 'status')}
            </Badge>
          )
        },
      },
      {
        header: t('common.fields.succeeded', 'Succeeded'),
        accessor: (job) => {
          const succeeded = job.status?.succeeded || 0
          const completions = job.spec?.completions ?? 1
          return `${succeeded}/${completions}`
        },
        cell: (value) => <span className="text-sm">{value as string}</span>,
      },
      {
        header: t('common.fields.started', 'Started'),
        accessor: (job) => job.status?.startTime,
        cell: (value) =>
          value ? (
            <span className="text-sm text-muted-foreground">
              {formatDate(value as string)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      },
      {
        header: t('common.fields.completed', 'Completed'),
        accessor: (job) => job.status?.completionTime,
        cell: (value) =>
          value ? (
            <span className="text-sm text-muted-foreground">
              {formatDate(value as string)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      },
      {
        header: t('common.fields.age', 'Age'),
        accessor: (job) => job.metadata?.creationTimestamp,
        cell: (value) =>
          value ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {getAge(value as string)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
      },
    ],
    [t]
  )

  const handleRefresh = async () => {
    await Promise.all([refetchCronJob(), refetchJobs()])
  }

  const handleSaveYaml = async (content: CronJob) => {
    await updateResource('cronjobs', name, namespace, content)
    toast.success('CronJob YAML saved successfully')
    await refetchCronJob()
  }

  const handleToggleSuspend = async () => {
    if (!cronjob || !cronjob.spec) {
      toast.error('CronJob spec is missing, unable to update suspend state')
      return
    }
    setIsTogglingSuspend(true)
    try {
      const updated = JSON.parse(JSON.stringify(cronjob)) as CronJob
      updated.spec!.suspend = !(cronjob.spec?.suspend ?? false)
      await updateResource('cronjobs', name, namespace, updated)
      toast.success(
        updated.spec?.suspend ? 'CronJob suspended' : 'CronJob resumed'
      )
      await Promise.all([refetchCronJob(), refetchJobs()])
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsTogglingSuspend(false)
    }
  }

  const handleRunNow = async () => {
    if (!cronjob?.spec?.jobTemplate?.spec || !namespace) {
      toast.error('CronJob template is incomplete, unable to run now')
      return
    }
    setIsRunningNow(true)
    try {
      const jobTemplateSpec = JSON.parse(
        JSON.stringify(cronjob.spec.jobTemplate.spec)
      ) as Job['spec']

      const manualJob: Job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          namespace,
          name: `${name}-manual-${Date.now()}`,
          labels: {
            ...(cronjob.spec.jobTemplate.metadata?.labels || {}),
            'cronjob.kubernetes.io/name': name,
          },
          annotations: {
            ...(cronjob.spec.jobTemplate.metadata?.annotations || {}),
            'kite.kubernetes.io/run-now': new Date().toISOString(),
          },
          ownerReferences: cronjob.metadata?.uid
            ? [
                {
                  apiVersion: cronjob.apiVersion || 'batch/v1',
                  kind: 'CronJob',
                  name,
                  uid: cronjob.metadata.uid,
                  controller: true,
                  blockOwnerDeletion: true,
                },
              ]
            : undefined,
        },
        spec: jobTemplateSpec,
      }

      await createResource('jobs', namespace, manualJob)
      toast.success('Job created successfully')
      await refetchJobs()
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsRunningNow(false)
    }
  }

  const templateSpec =
    cronjob?.spec?.jobTemplate?.spec?.template?.spec || undefined
  const initContainers = useMemo(
    () => templateSpec?.initContainers || [],
    [templateSpec?.initContainers]
  )
  const containers = useMemo(
    () => templateSpec?.containers || [],
    [templateSpec?.containers]
  )
  const volumes = useMemo(
    () => templateSpec?.volumes || [],
    [templateSpec?.volumes]
  )
  const allContainers = useMemo(
    () => [...initContainers, ...containers],
    [containers, initContainers]
  )

  const extraTabs = useMemo<ResourceDetailShellTab<CronJob>[]>(() => {
    const tabs: ResourceDetailShellTab<CronJob>[] = [
      {
        value: 'jobs',
        label: (
          <>
            {t('common.tabs.jobs', 'Jobs')}
            <Badge variant="secondary">{cronJobJobs.length}</Badge>
          </>
        ),
        content: (
          <Card>
            <CardContent className="pt-6">
              <SimpleTable<Job>
                data={sortedJobs}
                columns={jobColumns}
                emptyMessage={t(
                  'cronjobs.noJobs',
                  'No jobs found for this CronJob'
                )}
                pagination={{
                  enabled: true,
                  pageSize: 20,
                  showPageInfo: true,
                }}
              />
            </CardContent>
          </Card>
        ),
      },
      {
        value: 'containers',
        label: (
          <>
            {t('common.tabs.containers', 'Containers')}
            <Badge variant="secondary">
              {containers.length + initContainers.length}
            </Badge>
          </>
        ),
        content: (
          <div className="space-y-4">
            {initContainers.length > 0 ? (
              <div className="space-y-3">
                {initContainers.map((container) => (
                  <ContainerInfoCard
                    key={container.name}
                    container={container}
                    init
                  />
                ))}
              </div>
            ) : null}
            <div className="space-y-3">
              {containers.map((container) => (
                <ContainerInfoCard key={container.name} container={container} />
              ))}
            </div>
          </div>
        ),
      },
      {
        value: 'volumes',
        label: (
          <>
            {t('common.tabs.volumes', 'Volumes')}
            <Badge variant="secondary">{volumes.length}</Badge>
          </>
        ),
        content: (
          <VolumeTable
            namespace={namespace}
            volumes={volumes}
            containers={allContainers}
            isLoading={isLoading}
          />
        ),
      },
      {
        value: 'related',
        label: t('common.tabs.related', 'Related'),
        content: (
          <RelatedResourcesTable
            resource="cronjobs"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: t('common.tabs.history', 'History'),
        content: cronjob ? (
          <ResourceHistoryTable
            resourceType="cronjobs"
            name={name}
            namespace={namespace}
            currentResource={cronjob}
          />
        ) : null,
      },
      {
        value: 'events',
        label: t('common.tabs.events', 'Events'),
        content: (
          <EventTable resource="cronjobs" name={name} namespace={namespace} />
        ),
      },
    ]

    return tabs
  }, [
    allContainers,
    cronJobJobs,
    cronjob,
    containers,
    initContainers,
    isLoading,
    jobColumns,
    name,
    namespace,
    sortedJobs,
    t,
    volumes,
  ])

  return (
    <ResourceDetailShell
      resourceType="cronjobs"
      resourceLabel="CronJob"
      name={name}
      namespace={namespace}
      data={cronjob}
      isLoading={isLoading}
      error={isError ? cronJobError : null}
      onRefresh={handleRefresh}
      onSaveYaml={handleSaveYaml}
      overview={
        cronjob ? (
          <CronJobOverview
            cronjob={cronjob}
            namespace={namespace}
            name={name}
            jobs={sortedJobs}
            isJobsLoading={isLoadingJobs}
            events={cronJobEvents}
            isEventsLoading={isEventsLoading}
          />
        ) : null
      }
      headerActions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunNow}
            disabled={isRunningNow}
          >
            <IconPlayerPlayFilled className="w-4 h-4" />
            Run Now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleSuspend}
            disabled={isTogglingSuspend}
          >
            {cronjob?.spec?.suspend ? (
              <IconPlayerPlay className="w-4 h-4" />
            ) : (
              <IconPlayerPause className="w-4 h-4" />
            )}
            {cronjob?.spec?.suspend ? 'Resume' : 'Suspend'}
          </Button>
        </>
      }
      preYamlTabs={extraTabs.filter((tab) =>
        ['jobs', 'containers'].includes(tab.value)
      )}
      extraTabs={extraTabs.filter(
        (tab) => !['jobs', 'containers'].includes(tab.value)
      )}
    />
  )
}
