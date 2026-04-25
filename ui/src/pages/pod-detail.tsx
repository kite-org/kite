import { useEffect, useMemo, useState } from 'react'
import { IconAdjustments } from '@tabler/icons-react'
import { Container, Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  resizePod,
  updateResource,
  useResource,
  useResourcesEvents,
} from '@/lib/api'
import { isVersionAtLeast, translateError } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ContainerInfoCard } from '@/components/container-info-card'
import { ResourceEditor } from '@/components/editors/resource-editor'
import { EventTable } from '@/components/event-table'
import { LogViewer } from '@/components/log-viewer'
import { PodFileBrowser } from '@/components/pod-file-browser'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodOverview } from '@/components/pod-overview'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ContainerSelector } from '@/components/selector/container-selector'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function PodDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
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
    refetch,
  } = useResource('pods', name, namespace)
  const { data: podEvents, isLoading: isEventsLoading } = useResourcesEvents(
    'pods',
    name,
    namespace
  )

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
    await updateResource('pods', name, namespace, content)
    toast.success(t('pods.yamlSavedSuccess'))
    await refetch()
  }

  const handleResizeSave = async () => {
    if (!resizeContainer) return
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
      await refetch()
      setIsResizeDialogOpen(false)
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsResizing(false)
    }
  }

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
  const extraTabs = useMemo<ResourceDetailShellTab<Pod>[]>(
    () => [
      {
        value: 'containers',
        label: (
          <>
            {t('pods.tabs.containers')}
            <Badge variant="secondary">
              {(pod?.spec?.containers?.length || 0) +
                (pod?.spec?.initContainers?.length || 0)}
            </Badge>
          </>
        ),
        content: (
          <div className="space-y-4">
            {pod?.spec?.initContainers &&
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
                {pod?.spec?.containers?.map((container) => (
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
        value: 'logs',
        label: t('pods.tabs.logs'),
        content: (
          <LogViewer
            namespace={namespace}
            podName={name}
            containers={pod?.spec?.containers}
            initContainers={pod?.spec?.initContainers}
          />
        ),
      },
      {
        value: 'terminal',
        label: t('pods.tabs.terminal'),
        content: (
          <Terminal
            namespace={namespace}
            podName={name}
            containers={pod?.spec?.containers}
            initContainers={pod?.spec?.initContainers}
          />
        ),
      },
      {
        value: 'files',
        label: t('pods.tabs.files'),
        content: (
          <PodFileBrowser
            namespace={namespace}
            podName={name}
            containers={pod?.spec?.containers}
            initContainers={pod?.spec?.initContainers}
          />
        ),
      },
      {
        value: 'volumes',
        label: (
          <>
            {t('pods.tabs.volumes')}
            {pod?.spec?.volumes && (
              <Badge variant="secondary">{pod.spec.volumes.length}</Badge>
            )}
          </>
        ),
        content: (
          <VolumeTable
            namespace={namespace}
            volumes={pod?.spec?.volumes}
            containers={pod?.spec?.containers}
            isLoading={isLoading}
          />
        ),
      },
      {
        value: 'related',
        label: t('pods.tabs.related'),
        content: (
          <RelatedResourcesTable
            resource="pods"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'events',
        label: t('pods.tabs.events'),
        content: (
          <EventTable resource="pods" name={name} namespace={namespace} />
        ),
      },
      {
        value: 'monitor',
        label: t('pods.tabs.monitor'),
        content: (
          <PodMonitoring
            namespace={namespace}
            podName={name}
            containers={pod?.spec?.containers}
            initContainers={pod?.spec?.initContainers}
          />
        ),
      },
    ],
    [isLoading, name, namespace, pod, t]
  )
  return (
    <>
      <ResourceDetailShell
        resourceType="pods"
        resourceLabel="Pod"
        name={name}
        namespace={namespace}
        data={pod}
        isLoading={isLoading}
        error={isError ? podError : null}
        onRefresh={refetch}
        onSaveYaml={handleSaveYaml}
        overview={
          pod ? (
            <PodOverview
              pod={pod}
              namespace={namespace}
              name={name}
              events={podEvents}
              isEventsLoading={isEventsLoading}
            />
          ) : null
        }
        headerActions={
          resizeAvailable ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsResizeDialogOpen(true)}
            >
              <IconAdjustments className="w-4 h-4" />
              {t('pods.resizeResources')}
            </Button>
          ) : null
        }
        preYamlTabs={extraTabs.filter((tab) => tab.value === 'containers')}
        extraTabs={extraTabs.filter((tab) => tab.value !== 'containers')}
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
    </>
  )
}
