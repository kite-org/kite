import { useEffect, useState } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconLoader,
  IconRefresh,
  IconReload,
  IconScale,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
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
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ContainerTable } from '@/components/container-table'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { LogViewer } from '@/components/log-viewer'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodTable } from '@/components/pod-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'

export function StatefulSetDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [isScalePopoverOpen, setIsScalePopoverOpen] = useState(false)
  const [scaleReplicas, setScaleReplicas] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number>(0)

  const { t } = useTranslation()

  // Fetch statefulset data
  const {
    data: statefulset,
    isLoading: isLoadingStatefulSet,
    isError: isStatefulSetError,
    error: statefulsetError,
    refetch: refetchStatefulSet,
  } = useResource('statefulsets', name, namespace, {
    refreshInterval,
  })

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
      setYamlContent(yaml.dump(statefulset, { indent: 2 }))
      setScaleReplicas(statefulset.spec?.replicas || 0)
    }
  }, [statefulset])

  // Auto-reset refresh interval when statefulset reaches stable state
  useEffect(() => {
    if (statefulset && refreshInterval > 0) {
      const { status } = statefulset
      const readyReplicas = status?.readyReplicas || 0
      const replicas = status?.replicas || 0
      const updatedReplicas = status?.updatedReplicas || 0

      // Check if statefulset is in a stable state
      const isStable =
        readyReplicas === replicas && updatedReplicas === replicas
      console.log(`StatefulSet ${name} stability check:`, {
        readyReplicas,
        replicas,
        updatedReplicas,
        isStable,
      })
      if (isStable) {
        setRefreshInterval(0)
      }
    }
  }, [statefulset, refreshInterval, name])

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1)
    refetchStatefulSet()
  }

  const handleSaveYaml = async () => {
    setIsSavingYaml(true)
    try {
      const parsedYaml = yaml.load(yamlContent) as StatefulSet
      await updateResource('statefulsets', name, namespace, parsedYaml)
      toast.success('StatefulSet YAML saved successfully')
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to save YAML:', error)
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleScale = async () => {
    if (!statefulset) return

    try {
      const updatedStatefulSet = { ...statefulset } as StatefulSet
      if (!updatedStatefulSet.spec) {
        updatedStatefulSet.spec = {
          selector: { matchLabels: {} },
          template: { spec: { containers: [] } },
          serviceName: '',
        }
      }

      // Update the replica count
      updatedStatefulSet.spec.replicas = scaleReplicas

      await updateResource('statefulsets', name, namespace, updatedStatefulSet)
      toast.success(`StatefulSet scaled to ${scaleReplicas} replicas`)
      setIsScalePopoverOpen(false)
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to scale statefulset:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleRestart = async () => {
    if (!statefulset) return

    try {
      const updatedStatefulSet = { ...statefulset } as StatefulSet
      if (!updatedStatefulSet.spec) {
        updatedStatefulSet.spec = {
          selector: { matchLabels: {} },
          template: { spec: { containers: [] } },
          serviceName: '',
        }
      }
      if (!updatedStatefulSet.spec.template) {
        updatedStatefulSet.spec.template = { spec: { containers: [] } }
      }
      if (!updatedStatefulSet.spec.template.metadata) {
        updatedStatefulSet.spec.template.metadata = {}
      }
      if (!updatedStatefulSet.spec.template.metadata.annotations) {
        updatedStatefulSet.spec.template.metadata.annotations = {}
      }

      // Add restart annotation to trigger pod restart
      updatedStatefulSet.spec.template.metadata.annotations[
        'kite.kubernetes.io/restartedAt'
      ] = new Date().toISOString()

      await updateResource('statefulsets', name, namespace, updatedStatefulSet)
      toast.success('StatefulSet restart initiated')
      setIsRestartPopoverOpen(false)
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to restart statefulset:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleContainerUpdate = async (
    updatedContainer: Container,
    init = false
  ) => {
    try {
      const updatedStatefulSet = { ...statefulset } as StatefulSet

      if (init) {
        if (updatedStatefulSet.spec?.template?.spec?.initContainers) {
          const containerIndex =
            updatedStatefulSet.spec.template.spec.initContainers.findIndex(
              (c: Container) => c.name === updatedContainer.name
            )
          if (containerIndex !== -1) {
            updatedStatefulSet.spec.template.spec.initContainers[
              containerIndex
            ] = updatedContainer
          }
        }
      } else {
        if (updatedStatefulSet.spec?.template?.spec?.containers) {
          const containerIndex =
            updatedStatefulSet.spec.template.spec.containers.findIndex(
              (c: Container) => c.name === updatedContainer.name
            )
          if (containerIndex !== -1) {
            updatedStatefulSet.spec.template.spec.containers[containerIndex] =
              updatedContainer
          }
        }
      }
      await updateResource('statefulsets', name, namespace, updatedStatefulSet)
      toast.success('Container updated successfully')
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to update container:', error)
      toast.error(translateError(error, t))
    }
  }

  if (isLoadingStatefulSet) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading StatefulSet details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isStatefulSetError || !statefulset) {
    return (
      <ErrorMessage
        resourceName={'StatefulSet'}
        error={statefulsetError}
        refetch={handleRefresh}
      />
    )
  }

  const { metadata, spec, status } = statefulset
  const readyReplicas = status?.readyReplicas || 0
  const replicas = status?.replicas || 0
  const currentReplicas = status?.currentReplicas || 0
  const updatedReplicas = status?.updatedReplicas || 0

  const isAvailable = readyReplicas === replicas && replicas > 0
  const isPending = currentReplicas < replicas

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{metadata?.name}</h1>
          <p className="text-muted-foreground">
            Namespace: <span className="font-medium">{namespace}</span>
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button
            disabled={isLoadingStatefulSet}
            variant="outline"
            size="sm"
            onClick={handleRefresh}
          >
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog
            resourceType="statefulsets"
            namespace={namespace}
            name={name}
          />
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
              <div className="space-y-6">
                {/* Status Overview */}
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
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
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

                {/* StatefulSet Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>StatefulSet Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Created</Label>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(metadata?.creationTimestamp || '')}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">
                          Service Name
                        </Label>
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
                      labels={metadata?.labels || {}}
                      annotations={metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                {/* Init Containers */}
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
                              onContainerUpdate={(updatedContainer) =>
                                handleContainerUpdate(updatedContainer, true)
                              }
                              init
                            />
                          )
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Containers */}
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
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor
                  key={refreshKey}
                  value={yamlContent}
                  title="StatefulSet Configuration"
                  onSave={handleSaveYaml}
                  onChange={handleYamlChange}
                  isSaving={isSavingYaml}
                />
              </div>
            ),
          },
          ...(relatedPods
            ? [
                {
                  value: 'pods',
                  label: (
                    <>
                      Pods{' '}
                      {relatedPods && (
                        <Badge variant="secondary">{relatedPods.length}</Badge>
                      )}
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
                    <div className="space-y-6">
                      <LogViewer
                        namespace={namespace}
                        pods={relatedPods}
                        containers={spec?.template.spec?.containers}
                        initContainers={spec?.template.spec?.initContainers}
                        labelSelector={labelSelector}
                      />
                    </div>
                  ),
                },
                {
                  value: 'terminal',
                  label: 'Terminal',
                  content: (
                    <div className="space-y-6">
                      {relatedPods && relatedPods.length > 0 && (
                        <Terminal
                          namespace={namespace}
                          pods={relatedPods}
                          containers={spec?.template.spec?.containers}
                          initContainers={spec?.template.spec?.initContainers}
                        />
                      )}
                    </div>
                  ),
                },
              ]
            : []),
          ...(spec?.template?.spec?.volumes
            ? [
                {
                  value: 'volumes',
                  label: (
                    <>
                      Volumes
                      {spec.template.spec.volumes && (
                        <Badge variant="secondary">
                          {spec.template.spec.volumes.length}
                        </Badge>
                      )}
                    </>
                  ),
                  content: (
                    <div className="space-y-6">
                      <VolumeTable
                        namespace={namespace}
                        volumes={spec.template.spec?.volumes}
                        containers={spec.template.spec?.containers}
                        isLoading={isLoadingStatefulSet}
                      />
                    </div>
                  ),
                },
              ]
            : []),
          {
            value: 'Related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource={'statefulsets'}
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
            content: (
              <ResourceHistoryTable
                resourceType="statefulsets"
                name={name}
                namespace={namespace}
                currentResource={statefulset}
              />
            ),
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
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={metadata?.name || ''}
        resourceType="statefulsets"
        namespace={namespace}
      />
    </div>
  )
}
