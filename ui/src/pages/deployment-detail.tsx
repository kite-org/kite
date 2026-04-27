import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconReload, IconScale } from '@tabler/icons-react'
import { Deployment } from 'kubernetes-types/apps/v1'
import type { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  patchResource,
  updateResource,
  useResource,
  useResourcesEvents,
  useResourcesWatch,
} from '@/lib/api'
import { getDeploymentStatus, toSimpleContainer } from '@/lib/k8s'
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
import { DeploymentOverview } from '@/components/deployment-overview'
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

export function DeploymentDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [scaleReplicas, setScaleReplicas] = useState(1)
  const [isScalePopoverOpen, setIsScalePopoverOpen] = useState(false)
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(0)
  const { t } = useTranslation()

  const {
    data: deployment,
    isLoading,
    isError,
    error,
    refetch,
  } = useResource('deployments', name, namespace, { refreshInterval })

  const labelSelector = deployment?.spec?.selector.matchLabels
    ? Object.entries(deployment.spec.selector.matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(',')
    : undefined

  const { data: relatedPods, isLoading: isLoadingPods } = useResourcesWatch(
    'pods',
    namespace,
    {
      labelSelector,
      enabled: !!deployment?.spec?.selector.matchLabels,
    }
  )
  const { data: deploymentEvents, isLoading: isEventsLoading } =
    useResourcesEvents('deployments', name, namespace)

  useEffect(() => {
    if (deployment) {
      setScaleReplicas(deployment.spec?.replicas || 1)
    }
  }, [deployment])

  useEffect(() => {
    if (deployment) {
      const status = getDeploymentStatus(deployment)
      const isStable =
        status === 'Available' ||
        status === 'Scaled Down' ||
        status === 'Paused'
      if (isStable) {
        const timer = setTimeout(() => setRefreshInterval(0), 2000)
        return () => clearTimeout(timer)
      } else {
        setRefreshInterval(1000)
      }
    }
  }, [deployment, refreshInterval])

  const handleSaveYaml = async (content: Deployment) => {
    await updateResource('deployments', name, namespace, content)
    toast.success(t('common.messages.yamlSaved'))
    setRefreshInterval(1000)
  }

  const handleRestart = useCallback(async () => {
    if (!deployment) return
    try {
      const updated = { ...deployment } as Deployment
      if (!updated.spec!.template?.metadata?.annotations) {
        updated.spec!.template!.metadata!.annotations = {}
      }
      updated.spec!.template!.metadata!.annotations![
        'kite.kubernetes.io/restartedAt'
      ] = new Date().toISOString()
      await updateResource('deployments', name, namespace, updated)
      toast.success(
        t('detail.status.restartInitiated', { resource: 'Deployment' })
      )
      setIsRestartPopoverOpen(false)
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }, [t, deployment, name, namespace])

  const handleScale = useCallback(async () => {
    if (!deployment) return
    try {
      await patchResource('deployments', name, namespace, {
        spec: { replicas: scaleReplicas },
      })
      toast.success(
        t('detail.status.scaledTo', {
          resource: 'Deployment',
          replicas: scaleReplicas,
        })
      )
      setIsScalePopoverOpen(false)
      setRefreshInterval(1000)
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }, [t, deployment, name, namespace, scaleReplicas])

  const handleContainerUpdate = useCallback(
    async (updatedContainer: Container, init: boolean) => {
      if (!deployment) return
      try {
        const updated = JSON.parse(JSON.stringify(deployment)) as Deployment
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

        await updateResource('deployments', name, namespace, updated)
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
    [deployment, name, namespace, t]
  )

  const extraTabs = useMemo<ResourceDetailShellTab<Deployment>[]>(() => {
    const tabs: ResourceDetailShellTab<Deployment>[] = []
    const pods = relatedPods || []
    const containers = deployment?.spec?.template.spec?.containers || []
    const initContainers = deployment?.spec?.template.spec?.initContainers || []

    tabs.push(
      {
        value: 'pods',
        label: (
          <>
            {t('common.tabs.pods')}
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
            {t('common.tabs.containers')}
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
        label: t('common.tabs.logs'),
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
        label: t('common.tabs.terminal'),
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

    tabs.push(
      {
        value: 'related',
        label: t('common.tabs.related'),
        content: (
          <RelatedResourcesTable
            resource="deployments"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'history',
        label: t('common.tabs.history'),
        content: deployment ? (
          <ResourceHistoryTable
            resourceType="deployments"
            name={name}
            namespace={namespace}
            currentResource={deployment}
          />
        ) : null,
      }
    )

    if (deployment?.spec?.template?.spec?.volumes) {
      tabs.push({
        value: 'volumes',
        label: (
          <>
            {t('common.tabs.volumes')}
            <Badge variant="secondary">
              {deployment.spec.template.spec.volumes.length}
            </Badge>
          </>
        ),
        content: (
          <VolumeTable
            namespace={namespace}
            volumes={deployment.spec.template.spec.volumes}
            containers={toSimpleContainer(
              deployment.spec.template.spec.initContainers,
              deployment.spec.template.spec.containers
            )}
            isLoading={isLoading}
          />
        ),
      })
    }

    tabs.push(
      {
        value: 'events',
        label: t('common.tabs.events'),
        content: (
          <EventTable
            resource="deployments"
            name={name}
            namespace={namespace}
          />
        ),
      },
      {
        value: 'monitor',
        label: t('common.tabs.monitor'),
        content: (
          <PodMonitoring
            namespace={namespace}
            pods={pods}
            containers={containers}
            initContainers={initContainers}
            labelSelector={labelSelector}
          />
        ),
      }
    )

    return tabs
  }, [
    deployment,
    isLoading,
    isLoadingPods,
    labelSelector,
    handleContainerUpdate,
    name,
    namespace,
    relatedPods,
    t,
  ])

  return (
    <ResourceDetailShell
      resourceType="deployments"
      resourceLabel="Deployment"
      name={name}
      namespace={namespace}
      data={deployment}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={refetch}
      onSaveYaml={handleSaveYaml}
      overview={
        deployment ? (
          <DeploymentOverview
            deployment={deployment}
            namespace={namespace}
            name={name}
            pods={relatedPods}
            isPodsLoading={isLoadingPods}
            events={deploymentEvents}
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
                {t('common.actions.scale')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">
                    {t('detail.dialogs.scaleDeployment.title')}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.dialogs.scaleDeployment.description')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="replicas">
                    {t('common.fields.replicas')}
                  </Label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="size-9 p-0"
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
                      className="size-9 p-0"
                      onClick={() => setScaleReplicas(scaleReplicas + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
                <Button onClick={handleScale} className="w-full">
                  <IconScale className="w-4 h-4 mr-2" />
                  {t('common.actions.scale')}
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
                {t('common.actions.restart')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">
                    {t('detail.dialogs.restartDeployment.title')}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.dialogs.restartDeployment.description')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsRestartPopoverOpen(false)}
                    className="flex-1"
                  >
                    {t('common.actions.cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      handleRestart()
                      setIsRestartPopoverOpen(false)
                    }}
                    className="flex-1"
                  >
                    <IconReload className="w-4 h-4 mr-2" />
                    {t('common.actions.restart')}
                  </Button>
                </div>
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
