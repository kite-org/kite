import { useEffect, useState } from 'react'
import {
  IconBan,
  IconCircleCheckFilled,
  IconDroplet,
  IconExclamationCircle,
  IconLoader,
  IconLock,
  IconRefresh,
  IconReload,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
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
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { NodeMonitoring } from '@/components/node-monitoring'
import { PodTable } from '@/components/pod-table'
import { Terminal } from '@/components/terminal'
import { YamlEditor } from '@/components/yaml-editor'

export function NodeDetail(props: { name: string }) {
  const { name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const { t } = useTranslation()

  // Node operation states
  const [isDrainPopoverOpen, setIsDrainPopoverOpen] = useState(false)
  const [isCordonPopoverOpen, setIsCordonPopoverOpen] = useState(false)
  const [isTaintPopoverOpen, setIsTaintPopoverOpen] = useState(false)

  // Drain operation options
  const [drainOptions, setDrainOptions] = useState({
    force: false,
    gracePeriod: 30,
    deleteLocalData: false,
    ignoreDaemonsets: true,
  })

  // Taint operation data
  const [taintData, setTaintData] = useState({
    key: '',
    value: '',
    effect: 'NoSchedule' as 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute',
  })

  // Untaint key
  const [untaintKey, setUntaintKey] = useState('')

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: handleRefresh,
  } = useResource('nodes', name)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const {
    data: relatedPods,
    isLoading: isLoadingRelated,
    refetch: refetchRelated,
  } = useResources('pods', undefined, {
    fieldSelector: `spec.nodeName=${name}`,
  })

  const handleSaveYaml = async (content: Node) => {
    setIsSavingYaml(true)
    try {
      await updateResource('nodes', name, undefined, content)
      toast.success('YAML saved successfully')
    } catch (error) {
      console.error('Failed to save YAML:', error)
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  // Node operation handlers
  const handleDrain = async () => {
    try {
      await drainNode(name, drainOptions)
      toast.success(`Node ${name} drained successfully`)
      setIsDrainPopoverOpen(false)
      handleRefresh()
    } catch (error) {
      console.error('Failed to drain node:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleCordon = async () => {
    try {
      await cordonNode(name)
      toast.success(`Node ${name} cordoned successfully`)
      setIsCordonPopoverOpen(false)
      handleRefresh()
    } catch (error) {
      console.error('Failed to cordon node:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleUncordon = async () => {
    try {
      await uncordonNode(name)
      toast.success(`Node ${name} uncordoned successfully`)
      setIsCordonPopoverOpen(false)
      handleRefresh()
    } catch (error) {
      console.error('Failed to uncordon node:', error)
      toast.error(translateError(error, t))
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
      handleRefresh()
    } catch (error) {
      console.error('Failed to taint node:', error)
      toast.error(translateError(error, t))
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
      handleRefresh()
    } catch (error) {
      console.error('Failed to remove taint:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
    await refetchRelated()
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading node details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorMessage resourceName="Node" error={error} refetch={handleRefresh} />
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{name}</h1>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
          <Button
            disabled={isLoading}
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
          >
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <DescribeDialog resourceType="nodes" name={name} />
          {/* Drain Node Popover */}
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

          {/* Cordon/Uncordon Toggle */}
          {data.spec?.unschedulable ? (
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

          {/* Taint Node Popover */}
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
                          {data.status?.conditions?.find(
                            (c) => c.type === 'Ready' && c.status === 'True'
                          ) ? (
                            <IconCircleCheckFilled className="w-4 h-4 fill-green-500" />
                          ) : (
                            <IconExclamationCircle className="w-4 h-4 fill-red-500" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
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
                        <p className="text-xs text-muted-foreground">
                          Internal IP
                        </p>
                        <p className="text-sm font-medium font-mono">
                          {data.status?.addresses?.find(
                            (addr) => addr.type === 'InternalIP'
                          )?.address || 'N/A'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Pod CIDR
                        </p>
                        <p className="text-sm font-medium font-mono">
                          {data.spec?.podCIDR || 'N/A'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Node Information */}
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
                          {formatDate(
                            data.metadata?.creationTimestamp || '',
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Kubelet Version
                        </Label>
                        <p className="text-sm">
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
                          {data.status?.nodeInfo?.containerRuntimeVersion ||
                            'N/A'}
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

                {/* Resource Capacity & Allocation */}
                <Card>
                  <CardHeader>
                    <CardTitle>Resource Capacity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-medium mb-3">
                          CPU & Memory
                        </h4>
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
                        <h4 className="text-sm font-medium mb-3">
                          Pods & Storage
                        </h4>
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
                                      data.status.allocatable[
                                        'ephemeral-storage'
                                      ]
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

                {/* Node Taints */}
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

                {/* Node Conditions */}
                {data.status?.conditions &&
                  data.status.conditions.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Node Conditions</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {enrichNodeConditionsWithHealth(
                            data.status.conditions
                          ).map((condition, index) => (
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
                          ))}
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
                <YamlEditor<'nodes'>
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
          ...(relatedPods && relatedPods.length > 0
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
            value: 'Terminal',
            label: 'Terminal',
            content: (
              <div className="space-y-6">
                <Terminal type="node" nodeName={name} />
              </div>
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource={'nodes'}
                namespace={undefined}
                name={name}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
