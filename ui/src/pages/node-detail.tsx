import { useState } from 'react'
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
  useResource,
  useResources,
} from '@/lib/api'
import {
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
import { LabelsAnno } from '@/components/lables-anno'
import { NodeMonitoring } from '@/components/node-monitoring'
import { PodTable } from '@/components/pod-table'
import { Terminal } from '@/components/terminal'

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
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {data.status?.conditions?.find(
                        (c) => c.type === 'Ready' && c.status === 'True'
                      ) ? (
                        <IconCircleCheckFilled className="w-4 h-4 fill-green-500" />
                      ) : (
                        <IconExclamationCircle className="w-4 h-4 fill-red-500" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="text-sm font-medium">
                        {data.status?.conditions?.find(
                          (c) => c.type === 'Ready' && c.status === 'True'
                        )
                          ? 'Ready'
                          : 'Not Ready'}
                        {data.spec?.unschedulable
                          ? ' (SchedulingDisabled)'
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Role</p>
                    <p className="text-sm">
                      {Object.keys(data.metadata?.labels || {})
                        .find((key) =>
                          key.startsWith('node-role.kubernetes.io/')
                        )
                        ?.replace('node-role.kubernetes.io/', '') || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Internal IP</p>
                    <p className="text-sm font-medium font-mono">
                      {data.status?.addresses?.find(
                        (addr) => addr.type === 'InternalIP'
                      )?.address || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pod CIDR</p>
                    <p className="text-sm font-medium font-mono">
                      {data.spec?.podCIDR || 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Node Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created
                    </Label>
                    <p className="text-sm">
                      {formatDate(data.metadata?.creationTimestamp || '', true)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Kubelet Version
                    </Label>
                    <p className="text-sm font-mono">
                      {data.status?.nodeInfo?.kubeletVersion || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Hostname
                    </Label>
                    <p className="text-sm font-mono">
                      {data.status?.addresses?.find(
                        (addr) => addr.type === 'Hostname'
                      )?.address || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      External IP
                    </Label>
                    <p className="text-sm font-mono">
                      {data.status?.addresses?.find(
                        (addr) => addr.type === 'ExternalIP'
                      )?.address || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      OS Image
                    </Label>
                    <p className="text-sm">
                      {data.status?.nodeInfo?.osImage || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Kernel Version
                    </Label>
                    <p className="text-sm">
                      {data.status?.nodeInfo?.kernelVersion || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Architecture
                    </Label>
                    <p className="text-sm">
                      {data.status?.nodeInfo?.architecture || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Container Runtime
                    </Label>
                    <p className="text-sm">
                      {data.status?.nodeInfo?.containerRuntimeVersion || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Kube Proxy Version
                    </Label>
                    <p className="text-sm">
                      {data.status?.nodeInfo?.kubeProxyVersion || 'N/A'}
                    </p>
                  </div>
                </div>
                <LabelsAnno
                  labels={data.metadata?.labels || {}}
                  annotations={data.metadata?.annotations || {}}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resource Capacity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium mb-3">CPU & Memory</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">CPU</p>
                          <p className="text-xs text-muted-foreground">
                            Capacity:{' '}
                            {data.status?.capacity?.cpu
                              ? formatCPU(data.status.capacity.cpu)
                              : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {data.status?.allocatable?.cpu
                              ? formatCPU(data.status.allocatable.cpu)
                              : 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Allocatable
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Memory</p>
                          <p className="text-xs text-muted-foreground">
                            Capacity:{' '}
                            {data.status?.capacity?.memory
                              ? formatMemory(data.status.capacity.memory)
                              : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {data.status?.allocatable?.memory
                              ? formatMemory(data.status.allocatable.memory)
                              : 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Allocatable
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-3">Pods & Storage</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Pods</p>
                          <p className="text-xs text-muted-foreground">
                            Capacity: {data.status?.capacity?.pods || 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {data.status?.allocatable?.pods || 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Allocatable
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Storage</p>
                          <p className="text-xs text-muted-foreground">
                            Capacity:{' '}
                            {data.status?.capacity?.['ephemeral-storage']
                              ? formatMemory(
                                  data.status.capacity['ephemeral-storage']
                                )
                              : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {data.status?.allocatable?.['ephemeral-storage']
                              ? formatMemory(
                                  data.status.allocatable['ephemeral-storage']
                                )
                              : 'N/A'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Allocatable
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {data.spec?.taints && data.spec.taints.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Node Taints</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {data.spec.taints.map((taint, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 border rounded-lg"
                      >
                        <Badge variant="secondary">{taint.effect}</Badge>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{taint.key}</p>
                          {taint.value && (
                            <p className="text-xs text-muted-foreground">
                              = {taint.value}
                            </p>
                          )}
                        </div>
                        {taint.timeAdded && (
                          <p className="text-xs text-muted-foreground">
                            {formatDate(taint.timeAdded)}
                          </p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUntaint(taint.key)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {data.status?.conditions && data.status.conditions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Node Conditions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {enrichNodeConditionsWithHealth(data.status.conditions).map(
                      (condition, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                condition.health === 'True'
                                  ? 'bg-green-500'
                                  : condition.health === 'False'
                                    ? 'bg-red-500'
                                    : 'bg-yellow-500'
                              }`}
                            />
                            <Badge
                              variant={
                                condition.health === 'True'
                                  ? 'default'
                                  : 'secondary'
                              }
                              className="text-xs"
                            >
                              {condition.type}
                            </Badge>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground truncate">
                              {condition.message ||
                                condition.reason ||
                                'No message'}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {condition.status}
                          </Badge>
                        </div>
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
