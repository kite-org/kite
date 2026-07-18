import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconReload, IconScale } from '@tabler/icons-react'
import { StatefulSet } from 'kubernetes-types/apps/v1'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ContainerInfoCard } from '@/components/container-info-card'
import { EventTable } from '@/components/event-table'
import { LogViewer } from '@/components/log-viewer'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodTable } from '@/components/pod-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { StatefulSetOverview } from '@/components/statefulset-overview'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function StatefulSetDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [isScalePopoverOpen, setIsScalePopoverOpen] = useState(false)
  const [scaleReplicas, setScaleReplicas] = useState(0)
  const [refreshInterval, setRefreshInterval] = useState(0)
  const { t } = useTranslation()

  const {
    data: statefulset,
    isLoading,
    isError,
    error,
    refetch,
  } = useResource('statefulsets', name, namespace, { refreshInterval })

  const labelSelector = statefulset?.spec?.selector.matchLabels
    ? Object.entries(statefulset.spec.selector.matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(',')
    : undefined

  const { data: relatedPods, isLoading: isLoadingPods } = useResourcesWatch(
    'pods',
    namespace,
    {
      labelSelector,
      enabled: !!statefulset?.spec?.selector.matchLabels,
    }
  )
  const { data: statefulSetEvents, isLoading: isEventsLoading } =
    useResourcesEvents('statefulsets', name, namespace)

  useEffect(() => {
    if (statefulset) {
      setScaleReplicas(statefulset.spec?.replicas || 0)
    }
  }, [statefulset])

  useEffect(() => {
    if (statefulset && refreshInterval > 0) {
      const { status } = statefulset
      const readyReplicas = status?.readyReplicas || 0
      const replicas = status?.replicas || 0
      const updatedReplicas = status?.updatedReplicas || 0
      const isStable =
        readyReplicas === replicas && updatedReplicas === replicas
      if (isStable) setRefreshInterval(0)
    }
  }, [statefulset, refreshInterval])

  const handleSaveYaml = async (content: StatefulSet) => {
    await updateResource('statefulsets', name, namespace, content)
    toast.success('StatefulSet YAML saved successfully')
    setRefreshInterval(1000)
  }

  const handleScale = async () => {
    if (!statefulset) return
    try {
      const updated = { ...statefulset } as StatefulSet
      if (!updated.spec) {
        updated.spec = {
          selector: { matchLabels: {} },
          template: { spec: { containers: [] } },
          serviceName: '',
        }
      }
      updated.spec.replicas = scaleReplicas
      await updateResource('statefulsets', name, namespace, updated)
      toast.success(`StatefulSet scaled to ${scaleReplicas} replicas`)
      setIsScalePopoverOpen(false)
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleRestart = async () => {
    if (!statefulset) return
    try {
      const updated = { ...statefulset } as StatefulSet
      if (!updated.spec) {
        updated.spec = {
          selector: { matchLabels: {} },
          template: { spec: { containers: [] } },
          serviceName: '',
        }
      }
      if (!updated.spec.template) {
        updated.spec.template = { spec: { containers: [] } }
      }
      if (!updated.spec.template.metadata) {
        updated.spec.template.metadata = {}
      }
      if (!updated.spec.template.metadata.annotations) {
        updated.spec.template.metadata.annotations = {}
      }
      updated.spec.template.metadata.annotations[
        'kite.kubernetes.io/restartedAt'
      ] = new Date().toISOString()
      await updateResource('statefulsets', name, namespace, updated)
      toast.success('StatefulSet restart initiated')
      setIsRestartPopoverOpen(false)
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleContainerUpdate = useCallback(
    async (updatedContainer: Container, init: boolean) => {
      if (!statefulset) return
      try {
        const updated = JSON.parse(JSON.stringify(statefulset)) as StatefulSet
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

        await updateResource('statefulsets', name, namespace, updated)
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
    [name, namespace, statefulset, t]
  )

  const extraTabs = useMemo<ResourceDetailShellTab<StatefulSet>[]>(() => {
    const pods = relatedPods || []
    const containers = statefulset?.spec?.template?.spec?.containers || []
    const initContainers =
      statefulset?.spec?.template?.spec?.initContainers || []
    const volumes = statefulset?.spec?.template?.spec?.volumes || []
    const allContainers = [...initContainers, ...containers]

    return [
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
            {t('common.tabs.containers', {
              defaultValue: 'Containers',
            })}
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
      },
      {
        value: 'volumes',
        label: (
          <>
            {t('common.tabs.volumes', { defaultValue: 'Volumes' })}
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
        label: t('common.tabs.related', { defaultValue: 'Related' }),
        content: (
          <RelatedResourcesTable
            resource="statefulsets"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: t('common.tabs.history', { defaultValue: 'History' }),
        content: statefulset ? (
          <ResourceHistoryTable
            resourceType="statefulsets"
            name={name}
            namespace={namespace}
            currentResource={statefulset}
          />
        ) : null,
      },
      {
        value: 'events',
        label: t('common.tabs.events', { defaultValue: 'Events' }),
        content: (
          <EventTable
            resource="statefulsets"
            name={name}
            namespace={namespace}
          />
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
      },
    ]
  }, [
    handleContainerUpdate,
    isLoading,
    isLoadingPods,
    labelSelector,
    name,
    namespace,
    relatedPods,
    statefulset,
    t,
  ])

  return (
    <ResourceDetailShell
      resourceType="statefulsets"
      resourceLabel="StatefulSet"
      name={name}
      namespace={namespace}
      data={statefulset}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        statefulset ? (
          <StatefulSetOverview
            statefulset={statefulset}
            namespace={namespace}
            name={name}
            pods={relatedPods}
            isPodsLoading={isLoadingPods}
            events={statefulSetEvents}
            isEventsLoading={isEventsLoading}
          />
        ) : null
      }
      headerActions={
        <>
          <Popover
            open={isScalePopoverOpen}
            onOpenChange={setIsScalePopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <IconScale className="w-4 h-4" />
                Scale
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Scale StatefulSet</h4>
                  <p className="text-sm text-muted-foreground">
                    Adjust the number of replicas for this StatefulSet.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="replicas">Replicas</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={() =>
                        setScaleReplicas(Math.max(0, scaleReplicas - 1))
                      }
                      disabled={scaleReplicas <= 0}
                    >
                      -
                    </Button>
                    <Input
                      id="replicas"
                      type="number"
                      min="0"
                      value={scaleReplicas}
                      onChange={(e) =>
                        setScaleReplicas(parseInt(e.target.value) || 0)
                      }
                      className="text-center"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={() => setScaleReplicas(scaleReplicas + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
                <Button onClick={handleScale} className="w-full">
                  Scale StatefulSet
                </Button>
              </div>
            </PopoverContent>
          </Popover>
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
            <PopoverContent className="w-80">
              <div className="space-y-2">
                <p className="text-sm">
                  This will restart all pods managed by this StatefulSet.
                </p>
                <Button
                  onClick={handleRestart}
                  className="w-full"
                  variant="outline"
                >
                  Confirm Restart
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
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
