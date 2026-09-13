import { useMemo, useState } from 'react'
import {
  IconBan,
  IconCircleCheckFilled,
  IconDroplet,
  IconExclamationCircle,
  IconLock,
  IconReload,
} from '@tabler/icons-react'
import { Node } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  cordonNode,
  drainNode,
  taintNode,
  uncordonNode,
  untaintNode,
  updateResource,
  useRelatedResources,
  useResource,
  useResources,
  useResourcesEvents,
} from '@/lib/api'
import { getEventTime } from '@/lib/k8s'
import {
  cn,
  enrichNodeConditionsWithHealth,
  formatCPU,
  formatDate,
  formatMemory,
  translateError,
} from '@/lib/utils'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EventTable } from '@/components/event-table'
import { NodeMonitoring } from '@/components/node-monitoring'
import {
  CompactEventsCard,
  CompactRelatedResourcesCard,
  MetadataListCard,
} from '@/components/pod-overview-sidebar'
import { PodTable } from '@/components/pod-table'
import { Terminal } from '@/components/terminal'
import {
  WorkloadInfoBlock,
  WorkloadInfoRow,
  WorkloadSummaryCard,
} from '@/components/workload-overview-parts'

import {
  ResourceDetailShell,
  type ResourceDetailShellTab,
} from './resource-detail-shell'

export function NodeDetail(props: { name: string }) {
  const { name } = props
  const { t } = useTranslation()

  const [isDrainPopoverOpen, setIsDrainPopoverOpen] = useState(false)
  const [isCordonPopoverOpen, setIsCordonPopoverOpen] = useState(false)
  const [isTaintPopoverOpen, setIsTaintPopoverOpen] = useState(false)

  const [drainOptions, setDrainOptions] = useState({
    force: false,
    gracePeriod: 30,
    deleteLocalData: false,
    ignoreDaemonsets: true,
  })

  const [taintData, setTaintData] = useState({
    key: '',
    value: '',
    effect: 'NoSchedule' as 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute',
  })

  const [untaintKey, setUntaintKey] = useState('')

  const { data, isLoading, isError, error, refetch } = useResource(
    'nodes',
    name
  )

  const {
    data: relatedPods,
    isLoading: isLoadingRelated,
    refetch: refetchRelated,
  } = useResources('pods', undefined, {
    fieldSelector: `spec.nodeName=${name}`,
  })

  const handleSaveYaml = async (content: Node) => {
    await updateResource('nodes', name, undefined, content)
    toast.success(t('common.messages.yamlSaved'))
  }

  const handleRefresh = async () => {
    await refetch()
    await refetchRelated()
  }

  const handleDrain = async () => {
    try {
      const result = await drainNode(name, drainOptions)
      toast.success(
        t('detail.status.nodeDrained', {
          name,
          pods: result.pods,
        })
      )
      if (result.warnings) toast.warning(result.warnings)
      setIsDrainPopoverOpen(false)
      await refetch()
      await refetchRelated()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleCordon = async () => {
    try {
      await cordonNode(name)
      toast.success(t('detail.status.nodeCordoned', { name }))
      setIsCordonPopoverOpen(false)
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleUncordon = async () => {
    try {
      await uncordonNode(name)
      toast.success(t('detail.status.nodeUncordoned', { name }))
      setIsCordonPopoverOpen(false)
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleTaint = async () => {
    if (!taintData.key.trim()) {
      toast.error(t('detail.status.taintKeyRequired'))
      return
    }
    try {
      await taintNode(name, taintData)
      toast.success(t('detail.status.nodeTainted', { name }))
      setIsTaintPopoverOpen(false)
      setTaintData({ key: '', value: '', effect: 'NoSchedule' })
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleUntaint = async (key?: string) => {
    const taintKey = key || untaintKey
    if (!taintKey.trim()) {
      toast.error(t('detail.status.taintKeyRequired'))
      return
    }
    try {
      await untaintNode(name, taintKey)
      toast.success(t('detail.status.nodeTaintRemoved', { name }))
      if (!key) setUntaintKey('')
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const extraTabs: ResourceDetailShellTab<Node>[] = [
    ...(relatedPods && relatedPods.length > 0
      ? [
          {
            value: 'pods',
            label: (
              <>
                {t('common.tabs.pods')}{' '}
                <Badge variant="secondary">{relatedPods.length}</Badge>
              </>
            ),
            content: (
              <PodTable
                pods={relatedPods}
                isLoading={isLoadingRelated}
                hiddenNode
              />
            ),
          },
        ]
      : []),
    {
      value: 'monitor',
      label: t('common.tabs.monitor'),
      content: <NodeMonitoring name={name} />,
    },
    {
      value: 'terminal',
      label: t('common.tabs.terminal'),
      content: <Terminal type="node" nodeName={name} />,
    },
    {
      value: 'events',
      label: t('common.tabs.events'),
      content: (
        <EventTable resource="nodes" namespace={undefined} name={name} />
      ),
    },
  ]

  return (
    <ResourceDetailShell
      resourceType="nodes"
      resourceLabel={t('common.fields.node')}
      name={name}
      data={data}
      isLoading={isLoading}
      error={isError ? error : null}
      onRefresh={handleRefresh}
      onSaveYaml={handleSaveYaml}
      showDelete={false}
      overview={
        data ? (
          <NodeOverview
            node={data}
            podCount={relatedPods?.length || 0}
            onUntaint={handleUntaint}
          />
        ) : null
      }
      headerActions={
        <>
          <Popover
            open={isDrainPopoverOpen}
            onOpenChange={setIsDrainPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <IconDroplet className="w-4 h-4" />
                {t('common.actions.drain')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">
                    {t('detail.dialogs.drainNode.title')}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.dialogs.drainNode.description')}
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="force"
                      checked={drainOptions.force}
                      onChange={(e) =>
                        setDrainOptions({
                          ...drainOptions,
                          force: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="force" className="text-sm">
                      {t('detail.dialogs.drainNode.forceDrain')}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="deleteLocalData"
                      checked={drainOptions.deleteLocalData}
                      onChange={(e) =>
                        setDrainOptions({
                          ...drainOptions,
                          deleteLocalData: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="deleteLocalData" className="text-sm">
                      {t('detail.dialogs.drainNode.deleteLocalData')}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="ignoreDaemonsets"
                      checked={drainOptions.ignoreDaemonsets}
                      onChange={(e) =>
                        setDrainOptions({
                          ...drainOptions,
                          ignoreDaemonsets: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="ignoreDaemonsets" className="text-sm">
                      {t('detail.dialogs.drainNode.ignoreDaemonSets')}
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gracePeriod" className="text-sm">
                      {t('detail.dialogs.drainNode.gracePeriod')}
                    </Label>
                    <Input
                      id="gracePeriod"
                      type="number"
                      value={drainOptions.gracePeriod}
                      onChange={(e) =>
                        setDrainOptions({
                          ...drainOptions,
                          gracePeriod: parseInt(e.target.value) || 30,
                        })
                      }
                      min={0}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleDrain} size="sm" variant="destructive">
                    {t('detail.dialogs.drainNode.drainButton')}
                  </Button>
                  <Button
                    onClick={() => setIsDrainPopoverOpen(false)}
                    size="sm"
                    variant="outline"
                  >
                    {t('common.actions.cancel')}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {data?.spec?.unschedulable ? (
            <Button onClick={handleUncordon} variant="outline" size="sm">
              <IconReload className="w-4 h-4" />
              {t('common.actions.uncordon')}
            </Button>
          ) : (
            <Popover
              open={isCordonPopoverOpen}
              onOpenChange={setIsCordonPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <IconBan className="w-4 h-4" />
                  {t('common.actions.cordon')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium">
                      {t('detail.dialogs.cordonNode.title')}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {t('detail.dialogs.cordonNode.description')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCordon}
                      size="sm"
                      variant="destructive"
                    >
                      {t('detail.dialogs.cordonNode.cordonButton')}
                    </Button>
                    <Button
                      onClick={() => setIsCordonPopoverOpen(false)}
                      size="sm"
                      variant="outline"
                    >
                      {t('common.actions.cancel')}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          <Popover
            open={isTaintPopoverOpen}
            onOpenChange={setIsTaintPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <IconLock className="w-4 h-4" />
                {t('common.actions.taint')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">
                    {t('detail.dialogs.taintNode.title')}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.dialogs.taintNode.description')}
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="taintKey" className="text-sm">
                      {t('detail.dialogs.taintNode.key')}
                    </Label>
                    <Input
                      id="taintKey"
                      value={taintData.key}
                      onChange={(e) =>
                        setTaintData({ ...taintData, key: e.target.value })
                      }
                      placeholder={t('detail.dialogs.taintNode.keyPlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taintValue" className="text-sm">
                      {t('detail.dialogs.taintNode.value')}
                    </Label>
                    <Input
                      id="taintValue"
                      value={taintData.value}
                      onChange={(e) =>
                        setTaintData({ ...taintData, value: e.target.value })
                      }
                      placeholder={t(
                        'detail.dialogs.taintNode.valuePlaceholder'
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taintEffect" className="text-sm">
                      {t('detail.dialogs.taintNode.effect')}
                    </Label>
                    <Select
                      value={taintData.effect}
                      onValueChange={(
                        value: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute'
                      ) => setTaintData({ ...taintData, effect: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NoSchedule">NoSchedule</SelectItem>
                        <SelectItem value="PreferNoSchedule">
                          PreferNoSchedule
                        </SelectItem>
                        <SelectItem value="NoExecute">NoExecute</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleTaint} size="sm" variant="destructive">
                    {t('detail.dialogs.taintNode.addTaintButton')}
                  </Button>
                  <Button
                    onClick={() => setIsTaintPopoverOpen(false)}
                    size="sm"
                    variant="outline"
                  >
                    {t('common.actions.cancel')}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </>
      }
      extraTabs={extraTabs}
    />
  )
}

function NodeOverview({
  node,
  podCount,
  onUntaint,
}: {
  node: Node
  podCount: number
  onUntaint: (key?: string) => void
}) {
  const { t } = useTranslation()
  const name = node.metadata?.name || ''
  const labels = node.metadata?.labels || {}
  const annotations = node.metadata?.annotations || {}
  const { data: events, isLoading: isEventsLoading } = useResourcesEvents(
    'nodes',
    name
  )
  const { data: relatedResources, isLoading: isRelatedLoading } =
    useRelatedResources('nodes', name)
  const sortedEvents = useMemo(() => {
    return (events || []).slice().sort((a, b) => {
      const timeDiff = getEventTime(b).getTime() - getEventTime(a).getTime()
      if (timeDiff !== 0) {
        return timeDiff
      }
      return (
        Number(b.metadata?.resourceVersion || 0) -
        Number(a.metadata?.resourceVersion || 0)
      )
    })
  }, [events])
  const isReady = node.status?.conditions?.some(
    (condition) => condition.type === 'Ready' && condition.status === 'True'
  )
  const role =
    Object.keys(labels)
      .find((key) => key.startsWith('node-role.kubernetes.io/'))
      ?.replace('node-role.kubernetes.io/', '') || '-'
  const internalIP =
    node.status?.addresses?.find((addr) => addr.type === 'InternalIP')
      ?.address || '-'
  const hostname =
    node.status?.addresses?.find((addr) => addr.type === 'Hostname')?.address ||
    '-'
  const externalIP =
    node.status?.addresses?.find((addr) => addr.type === 'ExternalIP')
      ?.address || '-'
  const podAllocatable = node.status?.allocatable?.pods || '-'
  const podCapacity = node.status?.capacity?.pods || '-'
  const conditions = enrichNodeConditionsWithHealth(
    node.status?.conditions || []
  )

  return (
    <div className="@container/node-overview space-y-3">
      <div className="grid gap-3 md:grid-cols-2 @4xl/node-overview:grid-cols-6">
        <WorkloadSummaryCard
          label={t('common.fields.status')}
          value={
            <span className="inline-flex min-w-0 items-center gap-2">
              {isReady ? (
                <IconCircleCheckFilled className="size-4 shrink-0 fill-green-500" />
              ) : (
                <IconExclamationCircle className="size-4 shrink-0 fill-red-500" />
              )}
              <span className="truncate">
                {isReady
                  ? t('common.fields.ready')
                  : t('common.messages.notReady')}
              </span>
            </span>
          }
          detail={
            node.spec?.unschedulable
              ? t('detail.fields.schedulingDisabled')
              : undefined
          }
        />
        <WorkloadSummaryCard label={t('common.fields.role')} value={role} />
        <WorkloadSummaryCard
          label={t('common.fields.internalIP')}
          value={internalIP}
          mono
        />
        <WorkloadSummaryCard
          label={t('common.fields.pods')}
          value={`${podCount} / ${podAllocatable}`}
          detail={`${t('common.messages.assigned')} / ${t('common.fields.allocatable')}`}
        />
        <WorkloadSummaryCard
          label={t('common.fields.cpu')}
          value={
            node.status?.allocatable?.cpu
              ? formatCPU(node.status.allocatable.cpu)
              : '-'
          }
          detail={
            node.status?.capacity?.cpu
              ? `${t('common.fields.capacity')} ${formatCPU(node.status.capacity.cpu)}`
              : undefined
          }
        />
        <WorkloadSummaryCard
          label={t('common.fields.memory')}
          value={
            node.status?.allocatable?.memory
              ? formatMemory(node.status.allocatable.memory)
              : '-'
          }
          detail={
            node.status?.capacity?.memory
              ? `${t('common.fields.capacity')} ${formatMemory(node.status.capacity.memory)}`
              : undefined
          }
        />
      </div>

      <div className="grid gap-3 @4xl/node-overview:grid-cols-3">
        <div className="space-y-3 @4xl/node-overview:col-span-2">
          <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
            <CardHeader className="px-3 py-2.5 !pb-2.5">
              <CardTitle className="text-balance text-sm">
                {t('common.fields.information')}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-1">
              <div className="space-y-3">
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  <WorkloadInfoBlock label={t('common.fields.created')}>
                    {node.metadata?.creationTimestamp
                      ? formatDate(node.metadata.creationTimestamp)
                      : '-'}
                  </WorkloadInfoBlock>
                  <WorkloadInfoBlock label={t('common.fields.hostname')} mono>
                    {hostname}
                  </WorkloadInfoBlock>
                </div>

                <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
                  <WorkloadInfoRow label={t('common.fields.externalIP')} mono>
                    {externalIP}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.podCIDR')} mono>
                    {node.spec?.podCIDR || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow
                    label={t('common.fields.kubeletVersion')}
                    mono
                  >
                    {node.status?.nodeInfo?.kubeletVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.kubeProxyVersion')}>
                    {node.status?.nodeInfo?.kubeProxyVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow
                    label={t('common.fields.osImage')}
                    truncate={false}
                  >
                    {node.status?.nodeInfo?.osImage || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.kernelVersion')}>
                    {node.status?.nodeInfo?.kernelVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.architecture')}>
                    {node.status?.nodeInfo?.architecture || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.containerRuntime')}>
                    {node.status?.nodeInfo?.containerRuntimeVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('detail.fields.podCapacity')}>
                    {podAllocatable} / {podCapacity}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label={t('common.fields.storage')}>
                    {node.status?.allocatable?.['ephemeral-storage']
                      ? formatMemory(
                          node.status.allocatable['ephemeral-storage']
                        )
                      : '-'}{' '}
                    /{' '}
                    {node.status?.capacity?.['ephemeral-storage']
                      ? formatMemory(node.status.capacity['ephemeral-storage'])
                      : '-'}
                  </WorkloadInfoRow>
                </div>

                <div className="border-t border-border/60 pt-2">
                  <WorkloadInfoRow
                    label={t('common.fields.uid')}
                    mono
                    truncate={false}
                    compact
                  >
                    <span className="break-all">
                      {node.metadata?.uid || '-'}
                    </span>
                  </WorkloadInfoRow>
                </div>
              </div>
            </CardContent>
          </Card>

          {node.spec?.taints && node.spec.taints.length > 0 ? (
            <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
              <CardHeader className="px-3 py-2.5 !pb-2.5">
                <CardTitle className="text-balance text-sm">
                  {t('detail.sections.nodeTaints')} ({node.spec.taints.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/70 p-0">
                {node.spec.taints.map((taint, index) => (
                  <div
                    key={`${taint.key}-${taint.effect}-${index}`}
                    className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm"
                  >
                    <Badge variant="secondary" className="shrink-0">
                      {taint.effect}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono">{taint.key}</div>
                      {taint.value ? (
                        <div className="truncate text-xs text-muted-foreground">
                          = {taint.value}
                        </div>
                      ) : null}
                    </div>
                    {taint.timeAdded ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(taint.timeAdded)}
                      </span>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUntaint(taint.key)}
                    >
                      {t('common.actions.remove')}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {conditions.length > 0 ? (
            <Card className="gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none">
              <CardHeader className="px-3 py-2.5 !pb-2.5">
                <CardTitle className="text-balance text-sm">
                  {t('detail.sections.nodeConditions')} ({conditions.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/70 p-0">
                {conditions.map((condition) => (
                  <div
                    key={condition.type}
                    className="grid min-w-0 grid-cols-[10rem_minmax(0,1fr)_4rem] items-center gap-2 px-3 py-2 text-xs"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          condition.health === 'True' && 'bg-emerald-500',
                          condition.health === 'False' && 'bg-destructive',
                          condition.health !== 'True' &&
                            condition.health !== 'False' &&
                            'bg-yellow-500'
                        )}
                      />
                      <span className="truncate font-medium">
                        {condition.type}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {condition.message ||
                        condition.reason ||
                        t('detail.fields.noMessage')}
                    </span>
                    <span className="text-right text-muted-foreground">
                      {condition.status}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-3">
          <CompactEventsCard
            events={sortedEvents}
            isLoading={isEventsLoading}
          />
          <CompactRelatedResourcesCard
            resources={relatedResources || []}
            isLoading={isRelatedLoading}
          />
          {Object.keys(labels).length > 0 ? (
            <MetadataListCard title="common.fields.labels" entries={labels} />
          ) : null}
          {Object.keys(annotations).length > 0 ? (
            <MetadataListCard
              title="common.fields.annotations"
              entries={annotations}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
