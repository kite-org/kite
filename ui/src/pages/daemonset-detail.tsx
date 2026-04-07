import { useEffect, useMemo, useState } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconLoader,
  IconReload,
} from '@tabler/icons-react'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource, useResourcesWatch } from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ContainerTable } from '@/components/container-table'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
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

  const handleContainerUpdate = async (
    updatedContainer: Container,
    init = false
  ) => {
    if (!daemonset) return
    try {
      const updated = JSON.parse(JSON.stringify(daemonset)) as DaemonSet
      const containers = init
        ? updated.spec?.template?.spec?.initContainers
        : updated.spec?.template?.spec?.containers
      if (containers) {
        const idx = containers.findIndex(
          (c) => c.name === updatedContainer.name
        )
        if (idx !== -1) containers[idx] = updatedContainer
      }
      await updateResource('daemonsets', name, namespace, updated)
      toast.success('Container updated successfully')
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const spec = daemonset?.spec
  const status = daemonset?.status
  const readyReplicas = status?.numberReady || 0
  const desiredReplicas = status?.desiredNumberScheduled || 0
  const currentReplicas = status?.currentNumberScheduled || 0
  const isAvailable = (status?.numberAvailable || 0) > 0
  const isPending = currentReplicas < desiredReplicas

  const extraTabs = useMemo<ResourceDetailShellTab<DaemonSet>[]>(() => {
    const tabs: ResourceDetailShellTab<DaemonSet>[] = []

    if (relatedPods) {
      tabs.push(
        {
          value: 'pods',
          label: (
            <>
              Pods <Badge variant="secondary">{relatedPods.length}</Badge>
            </>
          ),
          content: (
            <PodTable
              pods={relatedPods}
              isLoading={isLoadingPods}
              labelSelector={labelSelector}
            />
          ),
        },
        {
          value: 'logs',
          label: 'Logs',
          content: (
            <LogViewer
              namespace={namespace}
              pods={relatedPods}
              containers={spec?.template.spec?.containers}
              initContainers={spec?.template.spec?.initContainers}
              labelSelector={labelSelector}
            />
          ),
        },
        {
          value: 'terminal',
          label: 'Terminal',
          content:
            relatedPods.length > 0 ? (
              <Terminal
                namespace={namespace}
                pods={relatedPods}
                containers={spec?.template.spec?.containers}
                initContainers={spec?.template.spec?.initContainers}
              />
            ) : null,
        }
      )
    }

    if (spec?.template?.spec?.volumes) {
      tabs.push({
        value: 'volumes',
        label: (
          <>
            Volumes{' '}
            <Badge variant="secondary">
              {spec.template.spec.volumes.length}
            </Badge>
          </>
        ),
        content: (
          <VolumeTable
            namespace={namespace}
            volumes={spec.template.spec.volumes}
            containers={spec.template.spec?.containers}
            isLoading={isLoading}
          />
        ),
      })
    }

    tabs.push(
      {
        value: 'related',
        label: 'Related',
        content: (
          <RelatedResourcesTable
            resource="daemonsets"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: 'Events',
        content: (
          <EventTable resource="daemonsets" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'history',
        label: 'History',
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
        value: 'monitor',
        label: 'Monitor',
        content: (
          <PodMonitoring
            namespace={namespace}
            pods={relatedPods}
            containers={spec?.template.spec?.containers}
            initContainers={spec?.template.spec?.initContainers}
            defaultQueryName={relatedPods?.[0]?.metadata?.generateName}
            labelSelector={labelSelector}
          />
        ),
      }
    )

    return tabs
  }, [
    daemonset,
    isLoading,
    isLoadingPods,
    labelSelector,
    name,
    namespace,
    relatedPods,
    spec,
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
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {isPending ? (
                        <IconExclamationCircle className="w-4 h-4 fill-gray-500" />
                      ) : isAvailable ? (
                        <IconCircleCheckFilled className="w-4 h-4 fill-green-500" />
                      ) : (
                        <IconLoader className="w-4 h-4 animate-spin fill-amber-500" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="text-sm font-medium">
                        {isPending
                          ? 'Pending'
                          : isAvailable
                            ? 'Available'
                            : 'In Progress'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Ready Replicas
                    </p>
                    <p className="text-sm font-medium">
                      {readyReplicas} / {desiredReplicas}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Current Scheduled
                    </p>
                    <p className="text-sm font-medium">{currentReplicas}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Desired Scheduled
                    </p>
                    <p className="text-sm font-medium">{desiredReplicas}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>DaemonSet Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm">
                      {formatDate(
                        daemonset.metadata?.creationTimestamp || '',
                        true
                      )}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Strategy
                    </Label>
                    <p className="text-sm">
                      {spec?.updateStrategy?.type || 'RollingUpdate'}
                    </p>
                  </div>
                </div>
                <LabelsAnno
                  labels={daemonset.metadata?.labels || {}}
                  annotations={daemonset.metadata?.annotations || {}}
                />
              </CardContent>
            </Card>
            {spec?.template?.spec?.initContainers && (
              <Card>
                <CardHeader>
                  <CardTitle>Init Containers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {spec.template.spec.initContainers.map((container) => (
                      <ContainerTable
                        key={container.name}
                        container={container}
                        onContainerUpdate={(c) =>
                          handleContainerUpdate(c, true)
                        }
                        init
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {spec?.template?.spec?.containers && (
              <Card>
                <CardHeader>
                  <CardTitle>Containers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {spec.template.spec.containers.map((container) => (
                      <ContainerTable
                        key={container.name}
                        container={container}
                        onContainerUpdate={(c) =>
                          handleContainerUpdate(c, false)
                        }
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
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
      extraTabs={extraTabs}
    />
  )
}
