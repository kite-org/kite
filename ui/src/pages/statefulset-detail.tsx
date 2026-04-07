import { useEffect, useMemo, useState } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconLoader,
  IconReload,
  IconScale,
} from '@tabler/icons-react'
import { StatefulSet } from 'kubernetes-types/apps/v1'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource, useResourcesWatch } from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

  const handleContainerUpdate = async (
    updatedContainer: Container,
    init = false
  ) => {
    try {
      const updated = { ...statefulset } as StatefulSet
      const containers = init
        ? updated.spec?.template?.spec?.initContainers
        : updated.spec?.template?.spec?.containers
      if (containers) {
        const idx = containers.findIndex(
          (c: Container) => c.name === updatedContainer.name
        )
        if (idx !== -1) containers[idx] = updatedContainer
      }
      await updateResource('statefulsets', name, namespace, updated)
      toast.success('Container updated successfully')
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const spec = statefulset?.spec
  const status = statefulset?.status
  const readyReplicas = status?.readyReplicas || 0
  const replicas = status?.replicas || 0
  const currentReplicas = status?.currentReplicas || 0
  const updatedReplicas = status?.updatedReplicas || 0
  const isAvailable = readyReplicas === replicas && replicas > 0
  const isPending = currentReplicas < replicas

  const extraTabs = useMemo<ResourceDetailShellTab<StatefulSet>[]>(() => {
    const tabs: ResourceDetailShellTab<StatefulSet>[] = []

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
            resource="statefulsets"
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
            resource="statefulsets"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: 'History',
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
    isLoading,
    isLoadingPods,
    labelSelector,
    name,
    namespace,
    relatedPods,
    spec,
    statefulset,
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
                      {readyReplicas} / {replicas}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Current Replicas
                    </p>
                    <p className="text-sm font-medium">{currentReplicas}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Updated Replicas
                    </p>
                    <p className="text-sm font-medium">{updatedReplicas}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>StatefulSet Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Created</Label>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(
                        statefulset.metadata?.creationTimestamp || ''
                      )}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Service Name</Label>
                    <p className="text-sm text-muted-foreground">
                      {spec?.serviceName || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      Update Strategy
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {spec?.updateStrategy?.type || 'RollingUpdate'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      Pod Management Policy
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {spec?.podManagementPolicy || 'OrderedReady'}
                    </p>
                  </div>
                </div>
                <LabelsAnno
                  labels={statefulset.metadata?.labels || {}}
                  annotations={statefulset.metadata?.annotations || {}}
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
                    {spec.template.spec.initContainers.map(
                      (container: Container) => (
                        <ContainerTable
                          key={container.name}
                          container={container}
                          onContainerUpdate={(c) =>
                            handleContainerUpdate(c, true)
                          }
                          init
                        />
                      )
                    )}
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
                    {spec.template.spec.containers.map(
                      (container: Container) => (
                        <ContainerTable
                          key={container.name}
                          container={container}
                          onContainerUpdate={handleContainerUpdate}
                        />
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
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
      extraTabs={extraTabs}
    />
  )
}
