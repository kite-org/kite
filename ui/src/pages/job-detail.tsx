import { useMemo } from 'react'
import { formatDistance } from 'date-fns'
import { Job } from 'kubernetes-types/batch/v1'
import { toast } from 'sonner'

import { updateResource, useResource, useResources } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ContainerTable } from '@/components/container-table'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { LogViewer } from '@/components/log-viewer'
import { OwnerInfoDisplay } from '@/components/owner-info-display'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodTable } from '@/components/pod-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

interface JobStatusBadge {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

function getJobStatusBadge(job?: Job | null): JobStatusBadge {
  if (!job) {
    return { label: '-', variant: 'secondary' }
  }

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

const getJobDuration = (job?: Job | null): string => {
  if (!job?.status?.startTime) {
    return '-'
  }

  const start = new Date(job.status.startTime)

  if (job.status.completionTime) {
    const end = new Date(job.status.completionTime)
    return formatDistance(end, start)
  }

  return `${formatDistance(new Date(), start)} (running)`
}

export function JobDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props

  const {
    data: job,
    isLoading,
    isError,
    error: jobError,
    refetch: refetchJob,
  } = useResource('jobs', name, namespace)

  const { data: pods, refetch: refetchPods } = useResources('pods', namespace, {
    labelSelector: `job-name=${name}`,
    disable: !namespace || !name,
  })

  const jobStatus = useMemo(() => getJobStatusBadge(job), [job])

  const templateSpec = job?.spec?.template?.spec
  const initContainers = useMemo(
    () => templateSpec?.initContainers || [],
    [templateSpec]
  )
  const containers = useMemo(
    () => templateSpec?.containers || [],
    [templateSpec]
  )
  const volumes = useMemo(() => templateSpec?.volumes || [], [templateSpec])

  const handleSaveYaml = async (content: Job) => {
    await updateResource('jobs', name, namespace, content)
    toast.success('Job YAML saved successfully')
    await refetchJob()
  }

  const handleRefresh = async () => {
    await Promise.all([refetchJob(), refetchPods()])
  }

  const tabs = useMemo<ResourceDetailShellTab<Job>[]>(() => {
    const baseTabs: ResourceDetailShellTab<Job>[] = [
      {
        value: 'pods',
        label: (
          <>Pods {pods && <Badge variant="secondary">{pods.length}</Badge>}</>
        ),
        content: <PodTable pods={pods || []} />,
      },
      {
        value: 'logs',
        label: 'Logs',
        content: (
          <LogViewer
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={`job-name=${name}`}
          />
        ),
      },
      {
        value: 'terminal',
        label: 'Terminal',
        content: (
          <Terminal
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
          />
        ),
      },
      {
        value: 'related',
        label: 'Related',
        content: (
          <RelatedResourcesTable
            resource="jobs"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: 'Events',
        content: (
          <EventTable resource="jobs" namespace={namespace} name={name} />
        ),
      },
      {
        value: 'history',
        label: 'History',
        content: job ? (
          <ResourceHistoryTable
            resourceType="jobs"
            name={name}
            namespace={namespace}
            currentResource={job}
          />
        ) : null,
      },
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
      {
        value: 'monitor',
        label: 'Monitor',
        content: (
          <PodMonitoring
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={`job-name=${name}`}
          />
        ),
      },
    ]

    return baseTabs
  }, [containers, initContainers, job, namespace, name, pods, volumes])

  return (
    <ResourceDetailShell
      resourceType="jobs"
      resourceLabel="Job"
      name={name}
      namespace={namespace}
      data={job}
      isLoading={isLoading}
      error={isError ? jobError : null}
      onRefresh={handleRefresh}
      onSaveYaml={handleSaveYaml}
      overview={
        job ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Status Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Status
                    </Label>
                    <Badge variant={jobStatus.variant}>{jobStatus.label}</Badge>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Completions
                    </Label>
                    <p className="text-sm font-medium">
                      {`${job.status?.succeeded || 0}/${job.spec?.completions || 1}`}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Start Time
                    </Label>
                    <p className="text-sm font-medium">
                      {job.status?.startTime
                        ? formatDate(job.status.startTime, false)
                        : '-'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Completion Time
                    </Label>
                    <p className="text-sm font-medium">
                      {job.status?.completionTime
                        ? `${formatDate(job.status.completionTime, false)} (duration: ${getJobDuration(job)})`
                        : '-'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Job Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm">
                      {formatDate(job.metadata?.creationTimestamp || '', true)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">UID</Label>
                    <p className="text-sm font-mono">{job.metadata?.uid}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Parallelism
                    </Label>
                    <p className="text-sm">{job.spec?.parallelism ?? 1}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Backoff Limit
                    </Label>
                    <p className="text-sm">{job.spec?.backoffLimit ?? 6}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Active Deadline Seconds
                    </Label>
                    <p className="text-sm">
                      {job.spec?.activeDeadlineSeconds
                        ? `${job.spec.activeDeadlineSeconds} seconds`
                        : 'Not set'}
                    </p>
                  </div>
                  <OwnerInfoDisplay metadata={job.metadata} />
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      TTL After Finished
                    </Label>
                    <p className="text-sm">
                      {job.spec?.ttlSecondsAfterFinished
                        ? `${job.spec.ttlSecondsAfterFinished} seconds`
                        : 'Not set'}
                    </p>
                  </div>
                </div>
                <LabelsAnno
                  labels={job.metadata?.labels || {}}
                  annotations={job.metadata?.annotations || {}}
                />
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

            {containers.length > 0 && (
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
            )}
          </div>
        ) : null
      }
      extraTabs={tabs}
    />
  )
}
