import { useMemo } from 'react'
import { Job } from 'kubernetes-types/batch/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  updateResource,
  useResource,
  useResourcesEvents,
  useResourcesWatch,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ContainerInfoCard } from '@/components/container-info-card'
import { EventTable } from '@/components/event-table'
import { JobOverview } from '@/components/job-overview'
import { LogViewer } from '@/components/log-viewer'
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

export function JobDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const { t } = useTranslation()

  const {
    data: job,
    isLoading,
    isError,
    error: jobError,
    refetch: refetchJob,
  } = useResource('jobs', name, namespace)

  const labelSelector = useMemo(() => {
    const selectorEntries = Object.entries(
      job?.spec?.selector?.matchLabels || {}
    )
    if (selectorEntries.length > 0) {
      return selectorEntries.map(([key, value]) => `${key}=${value}`).join(',')
    }
    return name ? `job-name=${name}` : undefined
  }, [job, name])

  const {
    data: pods,
    isLoading: isLoadingPods,
    refetch: refetchPods,
  } = useResourcesWatch('pods', namespace, {
    labelSelector,
    enabled: !!namespace && !!labelSelector,
  })
  const {
    data: jobEvents,
    isLoading: isEventsLoading,
    refetch: refetchEvents,
  } = useResourcesEvents('jobs', name, namespace)

  const templateSpec = job?.spec?.template?.spec
  const initContainers = useMemo(
    () => templateSpec?.initContainers || [],
    [templateSpec]
  )
  const containers = useMemo(
    () => templateSpec?.containers || [],
    [templateSpec]
  )
  const allContainers = useMemo(
    () => [...initContainers, ...containers],
    [containers, initContainers]
  )
  const volumes = useMemo(() => templateSpec?.volumes || [], [templateSpec])

  const handleSaveYaml = async (content: Job) => {
    await updateResource('jobs', name, namespace, content)
    toast.success(
      t('jobs.yamlSavedSuccess', {
        defaultValue: 'Job YAML saved successfully',
      })
    )
    await refetchJob()
  }

  const handleRefresh = async () => {
    refetchPods()
    await Promise.all([refetchJob(), refetchEvents()])
  }

  const tabs = useMemo<ResourceDetailShellTab<Job>[]>(() => {
    const currentPods = pods || []

    return [
      {
        value: 'pods',
        label: (
          <>
            {t('jobs.tabs.pods', { defaultValue: 'Pods' })}
            <Badge variant="secondary">{currentPods.length}</Badge>
          </>
        ),
        content: (
          <PodTable
            pods={currentPods}
            isLoading={isLoadingPods}
            labelSelector={labelSelector}
          />
        ),
      },
      {
        value: 'containers',
        label: (
          <>
            {t('jobs.tabs.containers', { defaultValue: 'Containers' })}
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
        value: 'logs',
        label: t('jobs.tabs.logs', { defaultValue: 'Logs' }),
        content: (
          <LogViewer
            namespace={namespace}
            pods={currentPods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={labelSelector}
          />
        ),
      },
      {
        value: 'terminal',
        label: t('jobs.tabs.terminal', { defaultValue: 'Terminal' }),
        content: (
          <Terminal
            namespace={namespace}
            pods={currentPods}
            containers={containers}
            initContainers={initContainers}
          />
        ),
      },
      {
        value: 'volumes',
        label: (
          <>
            {t('jobs.tabs.volumes', { defaultValue: 'Volumes' })}
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
        label: t('jobs.tabs.related', { defaultValue: 'Related' }),
        content: (
          <RelatedResourcesTable
            resource="jobs"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: t('jobs.tabs.history', { defaultValue: 'History' }),
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
        value: 'events',
        label: t('jobs.tabs.events', { defaultValue: 'Events' }),
        content: (
          <EventTable resource="jobs" namespace={namespace} name={name} />
        ),
      },
      {
        value: 'monitor',
        label: t('jobs.tabs.monitor', { defaultValue: 'Monitor' }),
        content: (
          <PodMonitoring
            namespace={namespace}
            pods={currentPods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={labelSelector}
          />
        ),
      },
    ]
  }, [
    allContainers,
    containers,
    initContainers,
    isLoading,
    isLoadingPods,
    job,
    labelSelector,
    name,
    namespace,
    pods,
    t,
    volumes,
  ])

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
          <JobOverview
            job={job}
            namespace={namespace}
            name={name}
            pods={pods}
            isPodsLoading={isLoadingPods}
            events={jobEvents}
            isEventsLoading={isEventsLoading}
          />
        ) : null
      }
      preYamlTabs={tabs.filter((tab) =>
        ['pods', 'containers'].includes(tab.value)
      )}
      extraTabs={tabs.filter(
        (tab) => !['pods', 'containers'].includes(tab.value)
      )}
    />
  )
}
