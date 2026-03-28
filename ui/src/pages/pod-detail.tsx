import { useEffect, useMemo, useState } from 'react'
import {
  IconAdjustments,
  IconExternalLink,
  IconLoader,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Container, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { resizePod, updateResource, useResource } from '@/lib/api'
import { getOwnerInfo, getPodErrorMessage, getPodStatus } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { formatDate, translateError } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ContainerInfoCard } from '@/components/container-info-card'
import { ContainerTable } from '@/components/container-table'
import { DescribeDialog } from '@/components/describe-dialog'
import { ResourceEditor } from '@/components/editors/resource-editor'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { LogViewer } from '@/components/log-viewer'
import { PodFileBrowser } from '@/components/pod-file-browser'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ContainerSelector } from '@/components/selector/container-selector'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'

export function PodDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isResizeDialogOpen, setIsResizeDialogOpen] = useState(false)
  const [selectedContainerName, setSelectedContainerName] = useState<string>()
  const [resizeContainer, setResizeContainer] = useState<Container | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const { t } = useTranslation()
  const { clusters, currentCluster } = useCluster()

  const {
    data: pod,
    isLoading,
    isError,
    error: podError,
    refetch: handleRefresh,
  } = useResource('pods', name, namespace)

  useEffect(() => {
    if (pod) {
      setYamlContent(yaml.dump(pod, { indent: 2 }))
    }
  }, [pod])

  useEffect(() => {
    if (!pod || !pod?.spec?.containers?.length) {
      setSelectedContainerName(undefined)
      setResizeContainer(null)
      return
    }
    setSelectedContainerName((prev) => prev || pod.spec?.containers[0].name)
  }, [pod])

  useEffect(() => {
    if (!pod || !selectedContainerName) {
      setResizeContainer(null)
      return
    }
    const container = pod.spec?.containers.find(
      (item) => item.name === selectedContainerName
    )
    setResizeContainer(
      container ? (JSON.parse(JSON.stringify(container)) as Container) : null
    )
  }, [pod, selectedContainerName])

  const handleSaveYaml = async (content: Pod) => {
    setIsSavingYaml(true)
    try {
      await updateResource('pods', name, namespace, content)
      toast.success('YAML saved successfully')
      // Refresh data after successful save
      await handleRefresh()
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleResizeSave = async () => {
    if (!resizeContainer) {
      return
    }
    setIsResizing(true)
    try {
      await resizePod(namespace, name, {
        spec: {
          containers: [
            {
              name: resizeContainer.name,
              resources: resizeContainer.resources,
            },
          ],
        },
      })
      toast.success(t('pods.resizeResourcesSuccess'))
      await handleRefresh()
      setIsResizeDialogOpen(false)
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsResizing(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleManualRefresh = async () => {
    // Increment refresh key to force YamlEditor re-render
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
  }

  const podStatus = useMemo(() => {
    return getPodStatus(pod)
  }, [pod])

  const clusterVersion = useMemo(
    () => clusters.find((cluster) => cluster.name === currentCluster)?.version,
    [clusters, currentCluster]
  )
  const resizeSupported = useMemo(
    () => isVersionAtLeast(clusterVersion, '1.35.0'),
    [clusterVersion]
  )
  const resizeAvailable =
    resizeSupported && (pod?.spec?.containers?.length ?? 0) > 0

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading pod details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !pod) {
    return (
      <ErrorMessage
        resourceName={'Pod'}
        error={podError}
        refetch={handleRefresh}
      />
    )
  }

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
            resourceType="pods"
            namespace={namespace}
            name={name}
          />
          {resizeAvailable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsResizeDialogOpen(true)}
            >
              <IconAdjustments className="w-4 h-4" />
              {t('pods.resizeResources')}
            </Button>
          )}
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
                {/* Status Overview */}
                <Card>
                  <CardHeader>
                    <CardTitle>Status Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <PodStatusIcon
                            status={podStatus?.reason}
                            className="w-4 h-4"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Phase</p>
                          <p className="text-sm font-medium">
                            {podStatus.reason}
                          </p>
                          <p className="text-xs text-red-500">
                            {getPodErrorMessage(pod)}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Ready Containers
                        </p>
                        <p className="text-sm font-medium">
                          {podStatus.readyContainers} /{' '}
                          {podStatus.totalContainers}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Restart Count
                        </p>
                        <p className="text-sm font-medium">
                          {podStatus.restartString}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">Node</p>
                        <p className="text-sm font-medium truncate">
                          {pod.spec?.nodeName ? (
                            <Link
                              to={`/nodes/${pod.spec.nodeName}`}
                              className="app-link"
                            >
                              {pod.spec.nodeName}
                            </Link>
                          ) : (
                            'Not assigned'
                          )}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {/* Pod Info */}
                <Card>
                  <CardHeader>
                    <CardTitle>Pod Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            pod.metadata?.creationTimestamp || '',
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Started
                        </Label>
                        <p className="text-sm">
                          {pod.status?.startTime
                            ? formatDate(pod.status.startTime)
                            : 'Not started'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Pod IP
                        </Label>
                        <p className="text-sm font-mono">
                          {pod.status?.podIP || 'Not assigned'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Host IP
                        </Label>
                        <p className="text-sm font-mono">
                          {pod.status?.hostIP || 'Not assigned'}
                        </p>
                      </div>
                      {getOwnerInfo(pod.metadata) && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Owner
                          </Label>
                          <p className="text-sm">
                            {(() => {
                              const ownerInfo = getOwnerInfo(pod.metadata)
                              if (!ownerInfo) {
                                return 'No owner'
                              }
                              return (
                                <Link to={ownerInfo.path} className="app-link">
                                  {ownerInfo.kind}/{ownerInfo.name}
                                </Link>
                              )
                            })()}
                          </p>
                        </div>
                      )}
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Ports
                        </Label>
                        <div className="flex flex-wrap items-center gap-1">
                          {pod.spec?.containers
                            .flatMap((c) => c.ports || [])
                            .map((port, index, array) => (
                              <span
                                key={`${port.containerPort}-${port.protocol}`}
                              >
                                <a
                                  href={withSubPath(
                                    `/api/v1/namespaces/${namespace}/pods/${name}:${port.containerPort}/proxy/`
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono app-link inline-flex items-center gap-1"
                                >
                                  {port.name && `${port.name}:`}
                                  {port.containerPort}
                                  <IconExternalLink className="w-3 h-3" />
                                </a>
                                {index < array.length - 1 && ', '}
                              </span>
                            ))}
                          {(!pod.spec?.containers ||
                            pod.spec.containers.length === 0 ||
                            pod.spec.containers.every(
                              (c) => !c.ports || c.ports.length === 0
                            )) && <span>No ports defined</span>}
                        </div>
                      </div>
                    </div>
                    <LabelsAnno
                      labels={pod.metadata?.labels || {}}
                      annotations={pod.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                {pod.spec?.initContainers &&
                  pod.spec.initContainers.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          Init Containers (
                          {pod?.spec?.initContainers?.length || 0})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-6">
                          <div className="space-y-4">
                            {pod?.spec?.initContainers?.map((container) => (
                              <ContainerTable
                                key={container.name}
                                container={container}
                                init
                              />
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Containers ({pod?.spec?.containers?.length || 0})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="space-y-4">
                        {pod?.spec?.containers?.map((container) => (
                          <ContainerTable
                            key={container.name}
                            container={container}
                          />
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Pod Conditions */}
                {pod.status?.conditions && pod.status.conditions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Conditions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {pod.status.conditions.map((condition, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-2 border rounded"
                          >
                            <Badge
                              variant={
                                condition.status === 'True'
                                  ? 'default'
                                  : 'secondary'
                              }
                            >
                              {condition.type}
                            </Badge>
                            <span className="text-sm">{condition.message}</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {formatDate(condition.lastTransitionTime || '')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ),
          },
          {
            value: 'containers',
            label: (
              <>
                Containers
                <Badge variant="secondary">
                  {(pod.spec?.containers?.length || 0) +
                    (pod.spec?.initContainers?.length || 0)}
                </Badge>
              </>
            ),
            content: (
              <div className="space-y-4">
                {pod.spec?.initContainers &&
                  pod.spec.initContainers.length > 0 && (
                    <Card>
                      <CardContent className="space-y-3 pt-4">
                        {pod.spec.initContainers.map((container) => (
                          <ContainerInfoCard
                            key={container.name}
                            container={container}
                            status={pod.status?.initContainerStatuses?.find(
                              (s) => s.name === container.name
                            )}
                            init
                          />
                        ))}
                      </CardContent>
                    </Card>
                  )}
                <Card>
                  <CardContent className="space-y-3 pt-4">
                    {pod.spec?.containers?.map((container) => (
                      <ContainerInfoCard
                        key={container.name}
                        container={container}
                        status={pod.status?.containerStatuses?.find(
                          (s) => s.name === container.name
                        )}
                      />
                    ))}
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor<'pods'>
                  key={refreshKey}
                  value={yamlContent}
                  title="YAML Configuration"
                  onSave={handleSaveYaml}
                  onChange={handleYamlChange}
                  isSaving={isSavingYaml}
                />
              </div>
            ),
          },
          {
            value: 'logs',
            label: 'Logs',
            content: (
              <LogViewer
                namespace={namespace}
                podName={name}
                containers={pod.spec?.containers}
                initContainers={pod.spec?.initContainers}
              />
            ),
          },
          {
            value: 'terminal',
            label: 'Terminal',
            content: (
              <div className="space-y-6">
                <Terminal
                  namespace={namespace}
                  podName={name}
                  containers={pod.spec?.containers}
                  initContainers={pod.spec?.initContainers}
                />
              </div>
            ),
          },
          {
            value: 'files',
            label: 'Files',
            content: (
              <PodFileBrowser
                namespace={namespace}
                podName={name}
                containers={pod.spec?.containers}
                initContainers={pod.spec?.initContainers}
              />
            ),
          },
          {
            value: 'volumes',
            label: (
              <>
                Volumes
                {pod.spec?.volumes && (
                  <Badge variant="secondary">{pod.spec.volumes.length}</Badge>
                )}
              </>
            ),
            content: (
              <div className="space-y-6">
                <VolumeTable
                  namespace={namespace}
                  volumes={pod.spec?.volumes}
                  containers={pod.spec?.containers}
                  isLoading={isLoading}
                />
              </div>
            ),
          },
          {
            value: 'Related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource={'pods'}
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable resource="pods" name={name} namespace={namespace} />
            ),
          },
          {
            value: 'monitor',
            label: 'Monitor',
            content: (
              <div className="space-y-6">
                <PodMonitoring
                  namespace={namespace}
                  podName={name}
                  containers={pod.spec?.containers}
                  initContainers={pod.spec?.initContainers}
                />
              </div>
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={name}
        resourceType="pods"
        namespace={namespace}
      />
      <Dialog open={isResizeDialogOpen} onOpenChange={setIsResizeDialogOpen}>
        <DialogContent className="!max-w-3xl max-h-[90vh] overflow-y-auto sm:!max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('pods.resizeResourcesTitle')}</DialogTitle>
            <DialogDescription>
              {t('pods.resizeResourcesDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('pods.container')}</Label>
              <ContainerSelector
                containers={(pod?.spec?.containers || []).map((item) => ({
                  name: item.name,
                  image: item.image || '',
                  init: false,
                }))}
                selectedContainer={selectedContainerName}
                onContainerChange={setSelectedContainerName}
                showAllOption={false}
                placeholder={t('pods.selectContainer')}
              />
            </div>
            {resizeContainer ? (
              <ResourceEditor
                container={resizeContainer}
                onUpdate={(updates) =>
                  setResizeContainer((prev) =>
                    prev ? { ...prev, ...updates } : prev
                  )
                }
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                {t('pods.selectContainer')}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsResizeDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleResizeSave}
              disabled={!resizeContainer || isResizing}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const isVersionAtLeast = (version: string | undefined, target: string) => {
  const parsed = parseVersion(version)
  const targetParsed = parseVersion(target)
  if (!parsed || !targetParsed) {
    return false
  }
  for (let i = 0; i < 3; i += 1) {
    if (parsed[i] > targetParsed[i]) {
      return true
    }
    if (parsed[i] < targetParsed[i]) {
      return false
    }
  }
  return true
}

const parseVersion = (version: string | undefined) => {
  if (!version) {
    return null
  }
  const cleaned = version.trim().replace(/^v/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
