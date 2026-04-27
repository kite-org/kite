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
    toast.success('YAML saved successfully')
  }

  const handleRefresh = async () => {
    await refetch()
    await refetchRelated()
  }

  const handleDrain = async () => {
    try {
      const result = await drainNode(name, drainOptions)
      toast.success(
        `Node ${name} drained successfully (${result.pods} pod${result.pods === 1 ? '' : 's'})`
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
      toast.success(`Node ${name} cordoned successfully`)
      setIsCordonPopoverOpen(false)
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleUncordon = async () => {
    try {
      await uncordonNode(name)
      toast.success(`Node ${name} uncordoned successfully`)
      setIsCordonPopoverOpen(false)
      refetch()
    } catch (err) {
      toast.error(translateError(err, t))
    }
  }

  const handleTaint = async () => {
    if (!taintData.key.trim()) {
      toast.error('Taint key is required')
      return
    }
    try {
      await taintNode(name, taintData)
      toast.success(`Node ${name} tainted successfully`)
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
      toast.error('Taint key is required')
      return
    }
    try {
      await untaintNode(name, taintKey)
      toast.success(`Taint removed from node ${name} successfully`)
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
                Pods <Badge variant="secondary">{relatedPods.length}</Badge>
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
      label: 'Monitor',
      content: <NodeMonitoring name={name} />,
    },
    {
      value: 'terminal',
      label: 'Terminal',
      content: <Terminal type="node" nodeName={name} />,
    },
    {
      value: 'events',
      label: 'Events',
      content: (
        <EventTable resource="nodes" namespace={undefined} name={name} />
      ),
    },
  ]

  return (
    <ResourceDetailShell
      resourceType="nodes"
      resourceLabel="Node"
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
                Drain
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">Drain Node</h4>
                  <p className="text-sm text-muted-foreground">
                    Safely evict all pods from this node.
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
                      Force drain
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
                      Delete local data
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
                      Ignore DaemonSets
                    </Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gracePeriod" className="text-sm">
                      Grace Period (seconds)
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
                    Drain Node
                  </Button>
                  <Button
                    onClick={() => setIsDrainPopoverOpen(false)}
                    size="sm"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {data?.spec?.unschedulable ? (
            <Button onClick={handleUncordon} variant="outline" size="sm">
              <IconReload className="w-4 h-4" />
              Uncordon
            </Button>
          ) : (
            <Popover
              open={isCordonPopoverOpen}
              onOpenChange={setIsCordonPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <IconBan className="w-4 h-4" />
                  Cordon
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium">Cordon Node</h4>
                    <p className="text-sm text-muted-foreground">
                      Mark this node as unschedulable.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCordon}
                      size="sm"
                      variant="destructive"
                    >
                      Cordon Node
                    </Button>
                    <Button
                      onClick={() => setIsCordonPopoverOpen(false)}
                      size="sm"
                      variant="outline"
                    >
                      Cancel
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
                Taint
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium">Taint Node</h4>
                  <p className="text-sm text-muted-foreground">
                    Add a taint to prevent pods from being scheduled.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="taintKey" className="text-sm">
                      Key *
                    </Label>
                    <Input
                      id="taintKey"
                      value={taintData.key}
                      onChange={(e) =>
                        setTaintData({ ...taintData, key: e.target.value })
                      }
                      placeholder="e.g., node.kubernetes.io/maintenance"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taintValue" className="text-sm">
                      Value
                    </Label>
                    <Input
                      id="taintValue"
                      value={taintData.value}
                      onChange={(e) =>
                        setTaintData({ ...taintData, value: e.target.value })
                      }
                      placeholder="Optional value"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taintEffect" className="text-sm">
                      Effect
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
                    Add Taint
                  </Button>
                  <Button
                    onClick={() => setIsTaintPopoverOpen(false)}
                    size="sm"
                    variant="outline"
                  >
                    Cancel
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
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
                {isReady ? 'Ready' : 'Not Ready'}
              </span>
            </span>
          }
          detail={node.spec?.unschedulable ? 'SchedulingDisabled' : undefined}
        />
        <WorkloadSummaryCard label="Role" value={role} />
        <WorkloadSummaryCard label="Internal IP" value={internalIP} mono />
        <WorkloadSummaryCard
          label="Pods"
          value={`${podCount} / ${podAllocatable}`}
          detail="Assigned / Allocatable"
        />
        <WorkloadSummaryCard
          label="CPU"
          value={
            node.status?.allocatable?.cpu
              ? formatCPU(node.status.allocatable.cpu)
              : '-'
          }
          detail={
            node.status?.capacity?.cpu
              ? `Capacity ${formatCPU(node.status.capacity.cpu)}`
              : undefined
          }
        />
        <WorkloadSummaryCard
          label="Memory"
          value={
            node.status?.allocatable?.memory
              ? formatMemory(node.status.allocatable.memory)
              : '-'
          }
          detail={
            node.status?.capacity?.memory
              ? `Capacity ${formatMemory(node.status.capacity.memory)}`
              : undefined
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
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
                  <WorkloadInfoBlock label="Hostname" mono>
                    {hostname}
                  </WorkloadInfoBlock>
                </div>

                <div className="grid gap-x-8 gap-y-2 border-t border-border/60 pt-3 md:grid-cols-2">
                  <WorkloadInfoRow label="External IP" mono>
                    {externalIP}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Pod CIDR" mono>
                    {node.spec?.podCIDR || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Kubelet Version" mono>
                    {node.status?.nodeInfo?.kubeletVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Kube Proxy Version">
                    {node.status?.nodeInfo?.kubeProxyVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="OS Image" truncate={false}>
                    {node.status?.nodeInfo?.osImage || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Kernel Version">
                    {node.status?.nodeInfo?.kernelVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Architecture">
                    {node.status?.nodeInfo?.architecture || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Container Runtime">
                    {node.status?.nodeInfo?.containerRuntimeVersion || '-'}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Pod Capacity">
                    {podAllocatable} / {podCapacity}
                  </WorkloadInfoRow>
                  <WorkloadInfoRow label="Storage">
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
                  <WorkloadInfoRow label="UID" mono truncate={false} compact>
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
                  Node Taints ({node.spec.taints.length})
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
                      Remove
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
                  Node Conditions ({conditions.length})
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
                      {condition.message || condition.reason || 'No message'}
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
