import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconReload } from '@tabler/icons-react'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import type { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  updateResource,
  useResource,
  useResourcesEvents,
  useResourcesWatch,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ContainerInfoCard } from '@/components/container-info-card'
import { DaemonSetOverview } from '@/components/daemonset-overview'
import { EventTable } from '@/components/event-table'
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

export function DaemonSetDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(0)
  const { t } = useTranslation()

  const {
    data: daemonset,
    isLoading,
    isError,
    error,
    refetch,
  } = useResource('daemonsets', name, namespace, { refreshInterval })

  useEffect(() => {
    if (daemonset && refreshInterval > 0) {
      const { status } = daemonset
      const isStable =
        (status?.numberReady || 0) === (status?.desiredNumberScheduled || 0) &&
        (status?.currentNumberScheduled || 0) ===
          (status?.desiredNumberScheduled || 0)
      if (isStable) setRefreshInterval(0)
    }
  }, [daemonset, refreshInterval])

  const labelSelector = daemonset?.spec?.selector.matchLabels
    ? Object.entries(daemonset.spec.selector.matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(',')
    : undefined

  const { data: relatedPods, isLoading: isLoadingPods } = useResourcesWatch(
    'pods',
    namespace,
    {
      labelSelector,
      enabled: !!daemonset?.spec?.selector.matchLabels,
    }
  )
  const { data: daemonsetEvents, isLoading: isEventsLoading } =
    useResourcesEvents('daemonsets', name, namespace)

  const handleSaveYaml = async (content: DaemonSet) => {
    await updateResource('daemonsets', name, namespace, content)
    toast.success('DaemonSet YAML saved successfully')
    setRefreshInterval(1000)
    await refetch()
  }

  const handleRestart = async () => {
    if (!daemonset) return
    try {
      const updated = { ...daemonset }
      if (!updated.spec!.template!.metadata!.annotations) {
        updated.spec!.template!.metadata!.annotations = {}
      }
      updated.spec!.template!.metadata!.annotations[
        'kite.kubernetes.io/restartedAt'
      ] = new Date().toISOString()
      await updateResource('daemonsets', name, namespace, updated)
      toast.success('DaemonSet restart initiated')
      setIsRestartPopoverOpen(false)
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleContainerUpdate = useCallback(
    async (updatedContainer: Container, init: boolean) => {
      if (!daemonset) return
      try {
        const updated = JSON.parse(JSON.stringify(daemonset)) as DaemonSet
        const templateSpec = updated.spec!.template.spec!

        if (init) {
          templateSpec.initContainers = (templateSpec.initContainers || []).map(
            (container) =>
              container.name === updatedContainer.name
                ? updatedContainer
                : container
          )
        } else {
          templateSpec.containers = templateSpec.containers.map((container) =>
            container.name === updatedContainer.name
              ? updatedContainer
              : container
          )
        }

        await updateResource('daemonsets', name, namespace, updated)
        toast.success(
          t('common.messages.containerUpdated', {
            defaultValue: 'Container updated successfully',
          })
        )
        setRefreshInterval(1000)
      } catch (err) {
        toast.error(translateError(err, t))
      }
    },
    [daemonset, name, namespace, t]
  )

  const extraTabs = useMemo<ResourceDetailShellTab<DaemonSet>[]>(() => {
    const tabs: ResourceDetailShellTab<DaemonSet>[] = []
    const pods = relatedPods || []
    const templateSpec = daemonset?.spec?.template.spec
    const containers = templateSpec?.containers || []
    const initContainers = templateSpec?.initContainers || []

    tabs.push(
      {
        value: 'pods',
        label: (
          <>
            {t('common.tabs.pods', { defaultValue: 'Pods' })}
            <Badge variant="secondary">{pods.length}</Badge>
          </>
        ),
        content: (
          <PodTable
            pods={pods}
            isLoading={isLoadingPods}
            labelSelector={labelSelector}
          />
        ),
      },
      {
        value: 'containers',
        label: (
          <>
            {t('common.tabs.containers', { defaultValue: 'Containers' })}
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
                    onContainerUpdate={(updatedContainer) =>
                      handleContainerUpdate(updatedContainer, true)
                    }
                  />
                ))}
              </div>
            ) : null}
            <div className="space-y-3">
              {containers.map((container) => (
                <ContainerInfoCard
                  key={container.name}
                  container={container}
                  onContainerUpdate={(updatedContainer) =>
                    handleContainerUpdate(updatedContainer, false)
                  }
                />
              ))}
            </div>
          </div>
        ),
      },
      {
        value: 'logs',
        label: t('common.tabs.logs', { defaultValue: 'Logs' }),
        content: (
          <LogViewer
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={labelSelector}
          />
        ),
      },
      {
        value: 'terminal',
        label: t('common.tabs.terminal', { defaultValue: 'Terminal' }),
        content:
          pods.length > 0 ? (
            <Terminal
              namespace={namespace}
              pods={pods}
              containers={containers}
              initContainers={initContainers}
            />
          ) : null,
      }
    )

    if (templateSpec?.volumes) {
      tabs.push({
        value: 'volumes',
        label: (
          <>
            {t('common.tabs.volumes', { defaultValue: 'Volumes' })}
            <Badge variant="secondary">{templateSpec.volumes.length}</Badge>
          </>
        ),
        content: (
          <VolumeTable
            namespace={namespace}
            volumes={templateSpec.volumes}
            containers={[...initContainers, ...containers]}
            isLoading={isLoading}
          />
        ),
      })
    }

    tabs.push(
      {
        value: 'related',
        label: t('common.tabs.related', { defaultValue: 'Related' }),
        content: (
          <RelatedResourcesTable
            resource="daemonsets"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: t('common.tabs.history', { defaultValue: 'History' }),
        content: daemonset ? (
          <ResourceHistoryTable
            resourceType="daemonsets"
            name={name}
            namespace={namespace}
            currentResource={daemonset}
          />
        ) : null,
      },
      {
        value: 'events',
        label: t('common.tabs.events', { defaultValue: 'Events' }),
        content: (
          <EventTable resource="daemonsets" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'monitor',
        label: t('common.tabs.monitor', { defaultValue: 'Monitor' }),
        content: (
          <PodMonitoring
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
            defaultQueryName={pods[0]?.metadata?.generateName}
            labelSelector={labelSelector}
          />
        ),
      }
    )

    return tabs
  }, [
    daemonset,
    handleContainerUpdate,
    isLoading,
    isLoadingPods,
    labelSelector,
    name,
    namespace,
    relatedPods,
    t,
  ])

  return (
    <ResourceDetailShell
      resourceType="daemonsets"
      resourceLabel="DaemonSet"
      name={name}
      namespace={namespace}
      data={daemonset}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        daemonset ? (
          <DaemonSetOverview
            daemonset={daemonset}
            namespace={namespace}
            name={name}
            pods={relatedPods}
            isPodsLoading={isLoadingPods}
            events={daemonsetEvents}
            isEventsLoading={isEventsLoading}
          />
        ) : null
      }
      headerActions={
        <Popover
          open={isRestartPopoverOpen}
          onOpenChange={setIsRestartPopoverOpen}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <IconReload className="w-4 h-4" />
              Restart
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-medium">Restart DaemonSet</h4>
                <p className="text-sm text-muted-foreground">
                  This will restart all pods managed by this DaemonSet. This
                  action cannot be undone.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsRestartPopoverOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    handleRestart()
                    setIsRestartPopoverOpen(false)
                  }}
                  className="flex-1"
                >
                  <IconReload className="w-4 h-4 mr-2" />
                  Restart
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      }
      preYamlTabs={extraTabs.filter((tab) =>
        ['pods', 'containers'].includes(tab.value)
      )}
      extraTabs={extraTabs.filter(
        (tab) => !['pods', 'containers'].includes(tab.value)
      )}
    />
  )
}
