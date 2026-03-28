import { useEffect, useMemo, useState } from 'react'
import {
  IconLoader,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { CronJob, Job } from 'kubernetes-types/batch/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  createResource,
  updateResource,
  useResource,
  useResources,
} from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ContainerTable } from '@/components/container-table'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { Column, SimpleTable } from '@/components/simple-table'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'

interface JobStatusBadge {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

function getJobStatusBadge(job: Job): JobStatusBadge {
  const conditions = job.status?.conditions || []
  const completed = conditions.find(
    (condition) => condition.type === 'Complete'
  )
  const failed = conditions.find((condition) => condition.type === 'Failed')

  if (failed?.status === 'True') {
    return { label: 'Failed', variant: 'destructive' }
  }

  if (completed?.status === 'True') {
    return { label: 'Complete', variant: 'default' }
  }

  if ((job.status?.active || 0) > 0) {
    return { label: 'Running', variant: 'secondary' }
  }

  return { label: 'Pending', variant: 'outline' }
}

export function CronJobDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
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

  useEffect(() => {
    if (cronjob) {
      setYamlContent(yaml.dump(cronjob, { indent: 2 }))
    }
  }, [cronjob])

  const cronJobStatus = useMemo(() => {
    if (!cronjob) {
      return { label: '-', variant: 'secondary' as const }
    }

    if (cronjob.spec?.suspend) {
      return { label: 'Suspended', variant: 'secondary' as const }
    }

    if ((cronjob.status?.active?.length || 0) > 0) {
      return { label: 'Active', variant: 'default' as const }
    }

    if (cronjob.status?.lastSuccessfulTime) {
      return { label: 'Idle', variant: 'outline' as const }
    }

    return { label: 'Pending', variant: 'outline' as const }
  }, [cronjob])

  const cronJobJobs = useMemo(() => {
    if (!jobs) {
      return [] as Job[]
    }

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

  const activeJobs = useMemo(() => {
    if (!cronjob) {
      return [] as Job[]
    }
    const activeNames = new Set(
      (cronjob.status?.active || [])
        .map((ref) => ref.name)
        .filter((val): val is string => Boolean(val))
    )

    return cronJobJobs.filter((job) =>
      activeNames.has(job.metadata?.name || '')
    )
  }, [cronjob, cronJobJobs])

  const jobColumns = useMemo<Column<Job>[]>(
    () => [
      {
        header: 'Name',
        accessor: (job) => job,
        align: 'left',
        cell: (value) => {
          const job = value as Job
          return (
            <Link
              to={`/jobs/${job.metadata?.namespace}/${job.metadata?.name}`}
              className="app-link"
            >
              {job.metadata?.name}
            </Link>
          )
        },
      },
      {
        header: 'Status',
        accessor: (job) => getJobStatusBadge(job),
        cell: (value) => {
          const badge = value as JobStatusBadge
          return <Badge variant={badge.variant}>{badge.label}</Badge>
        },
      },
      {
        header: 'Succeeded',
        accessor: (job) => {
          const succeeded = job.status?.succeeded || 0
          const completions = job.spec?.completions || 1
          return `${succeeded}/${completions}`
        },
        cell: (value) => <span className="text-sm">{value as string}</span>,
      },
      {
        header: 'Started',
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
        header: 'Completed',
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
    ],
    []
  )

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await Promise.all([refetchCronJob(), refetchJobs()])
  }

  const handleSaveYaml = async (content: CronJob) => {
    setIsSavingYaml(true)
    try {
      await updateResource('cronjobs', name, namespace, content)
      toast.success('CronJob YAML saved successfully')
      await refetchCronJob()
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleToggleSuspend = async () => {
    if (!cronjob || !cronjob.spec) {
      toast.error('CronJob spec is missing, unable to update suspend state')
      return
    }

    setIsTogglingSuspend(true)
    try {
      const updatedCronJob = JSON.parse(JSON.stringify(cronjob)) as CronJob
      updatedCronJob.spec!.suspend = !(cronjob.spec?.suspend ?? false)
      await updateResource('cronjobs', name, namespace, updatedCronJob)
      toast.success(
        updatedCronJob.spec?.suspend ? 'CronJob suspended' : 'CronJob resumed'
      )
      await Promise.all([refetchCronJob(), refetchJobs()])
    } catch (error) {
      toast.error(translateError(error, t))
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
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsRunningNow(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading cronjob details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !cronjob) {
    return (
      <ErrorMessage
        resourceName={'CronJob'}
        error={cronJobError}
        refetch={handleManualRefresh}
      />
    )
  }

  const templateSpec =
    cronjob.spec?.jobTemplate?.spec?.template?.spec || undefined
  const initContainers = templateSpec?.initContainers || []
  const containers = templateSpec?.containers || []
  const volumes = templateSpec?.volumes

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{name}</h1>
          <p className="text-muted-foreground">
            Namespace: <span className="font-medium">{namespace}</span>
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button variant="outline" size="sm" onClick={handleManualRefresh}>
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog
            resourceType={'cronjobs'}
            namespace={namespace}
            name={name}
          />
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
            {cronjob.spec?.suspend ? (
              <IconPlayerPlay className="w-4 h-4" />
            ) : (
              <IconPlayerPause className="w-4 h-4" />
            )}
            {cronjob.spec?.suspend ? 'Resume' : 'Suspend'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <IconTrash className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>

      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Status Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Status
                        </Label>
                        <Badge variant={cronJobStatus.variant}>
                          {cronJobStatus.label}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Schedule
                        </Label>
                        <p className="text-sm font-medium">
                          {cronjob.spec?.schedule || '-'}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Active Jobs
                        </Label>
                        <p className="text-sm font-medium">
                          {cronjob.status?.active?.length || 0}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Last Schedule
                        </Label>
                        <p className="text-sm font-medium">
                          {cronjob.status?.lastScheduleTime
                            ? formatDate(cronjob.status.lastScheduleTime, true)
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>CronJob Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            cronjob.metadata?.creationTimestamp || '',
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Concurrency Policy
                        </Label>
                        <p className="text-sm">
                          {cronjob.spec?.concurrencyPolicy || 'Allow'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Starting Deadline
                        </Label>
                        <p className="text-sm">
                          {cronjob.spec?.startingDeadlineSeconds
                            ? `${cronjob.spec.startingDeadlineSeconds} seconds`
                            : 'Not set'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Successful Jobs History
                        </Label>
                        <p className="text-sm">
                          {cronjob.spec?.successfulJobsHistoryLimit ?? 3}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Failed Jobs History
                        </Label>
                        <p className="text-sm">
                          {cronjob.spec?.failedJobsHistoryLimit ?? 1}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Time Zone
                        </Label>
                        <p className="text-sm">
                          {cronjob.spec?.timeZone || 'Cluster default'}
                        </p>
                      </div>
                    </div>
                    <LabelsAnno
                      labels={cronjob.metadata?.labels || {}}
                      annotations={cronjob.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Active Jobs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingJobs ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <IconLoader className="w-4 h-4 animate-spin" />
                        Loading active jobs...
                      </div>
                    ) : activeJobs.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {activeJobs.map((job) => (
                          <Badge key={job.metadata?.uid} variant="secondary">
                            <Link
                              to={`/jobs/${job.metadata?.namespace}/${job.metadata?.name}`}
                              className="hover:underline"
                            >
                              {job.metadata?.name}
                            </Link>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No active jobs currently running.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {initContainers.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        Init Containers ({initContainers.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {initContainers.map((container) => (
                          <ContainerTable
                            key={container.name}
                            container={container}
                            init
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Containers ({containers.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {containers.map((container) => (
                        <ContainerTable
                          key={container.name}
                          container={container}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <YamlEditor<'cronjobs'>
                key={refreshKey}
                value={yamlContent}
                title="YAML Configuration"
                onSave={handleSaveYaml}
                onChange={handleYamlChange}
                isSaving={isSavingYaml}
              />
            ),
          },
          {
            value: 'jobs',
            label: (
              <>
                Jobs{' '}
                {cronJobJobs && (
                  <Badge variant="secondary">{cronJobJobs.length}</Badge>
                )}
              </>
            ),
            content: (
              <Card>
                <CardContent>
                  <SimpleTable<Job>
                    data={sortedJobs}
                    columns={jobColumns}
                    emptyMessage="No jobs found for this CronJob"
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
            value: 'related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource={'cronjobs'}
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource="cronjobs"
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable
                resourceType="cronjobs"
                name={name}
                namespace={namespace}
                currentResource={cronjob}
              />
            ),
          },
          ...(volumes
            ? [
                {
                  value: 'volumes',
                  label: 'Volumes',
                  content: (
                    <VolumeTable
                      namespace={namespace}
                      volumes={volumes}
                      containers={containers}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={name}
        resourceType="cronjobs"
        namespace={namespace}
      />
    </div>
  )
}
