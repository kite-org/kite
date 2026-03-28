import { useMemo, useState } from 'react'
import { Container, Pod } from 'kubernetes-types/core/v1'

import { usePodMetrics } from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContainerSelector } from '@/components/selector/container-selector'

import CPUUsageChart from './chart/cpu-usage-chart'
import DiskIOUsageChart from './chart/disk-io-usage-chart'
import MemoryUsageChart from './chart/memory-usage-chart'
import NetworkUsageChart from './chart/network-usage-chart'
import { PodSelector } from './selector/pod-selector'

interface PodMonitoringProps {
  namespace: string
  podName?: string
  defaultQueryName?: string
  pods?: Pod[]
  containers?: Container[]
  initContainers?: Container[]
  labelSelector?: string
}

export function PodMonitoring({
  namespace,
  podName,
  defaultQueryName,
  pods,
  containers: _containers = [],
  initContainers = [],
  labelSelector,
}: PodMonitoringProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])
  const [selectedPod, setSelectedPod] = useState<string | undefined>(
    podName || undefined
  )
  const [timeRange, setTimeRange] = useState('30m')
  const [selectedContainer, setSelectedContainer] = useState<
    string | undefined
  >(undefined)
  const [refreshInterval, setRefreshInterval] = useState(30 * 1000)

  const queryPodName = useMemo(() => {
    return (
      selectedPod ||
      podName ||
      defaultQueryName ||
      pods?.[0]?.metadata?.generateName?.split('-').slice(0, -2).join('-') ||
      ''
    )
  }, [selectedPod, podName, defaultQueryName, pods])

  const { data, isLoading, error } = usePodMetrics(
    namespace,
    queryPodName,
    timeRange,
    {
      container: selectedContainer,
      refreshInterval: refreshInterval,
      labelSelector: labelSelector,
    }
  )

  const timeRangeOptions = [
    { value: '30m', label: 'Last 30 min' },
    { value: '1h', label: 'Last 1 hour' },
    { value: '24h', label: 'Last 24 hours' },
  ]

  const refreshIntervalOptions = [
    { value: 0, label: 'Off' },
    { value: 5 * 1000, label: '5 seconds' },
    { value: 10 * 1000, label: '10 seconds' },
    { value: 30 * 1000, label: '30 seconds' },
    { value: 60 * 1000, label: '60 seconds' },
  ]

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap">
        <div className="w-full space-y-2 md:w-auto">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              {timeRangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full space-y-2 md:w-auto">
          <Select
            value={refreshInterval.toString()}
            onValueChange={(value) => setRefreshInterval(Number(value))}
          >
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="Select refresh interval" />
            </SelectTrigger>
            <SelectContent>
              {refreshIntervalOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full space-y-2 md:w-auto md:min-w-[220px]">
          <ContainerSelector
            containers={containers}
            selectedContainer={selectedContainer}
            onContainerChange={setSelectedContainer}
          />
        </div>
        {pods && pods.length > 1 && (
          <div className="w-full space-y-2 md:w-auto md:min-w-[220px]">
            {/* Pod Selector */}
            <PodSelector
              pods={pods}
              showAllOption={true}
              selectedPod={selectedPod}
              onPodChange={(podName) => {
                setSelectedPod(podName)
              }}
            />
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {data?.fallback && (
          <div className="xl:col-span-2 rounded bg-yellow-100 text-yellow-800 px-4 py-2 text-sm border border-yellow-300">
            Current data is from metrics-server, limited historical data.
          </div>
        )}
        <CPUUsageChart
          data={data?.cpu || []}
          isLoading={isLoading}
          syncId="resource-usage"
          error={error}
        />
        <MemoryUsageChart
          data={data?.memory || []}
          isLoading={isLoading}
          syncId="resource-usage"
        />
        <NetworkUsageChart
          networkIn={data?.networkIn || []}
          networkOut={data?.networkOut || []}
          isLoading={isLoading}
          syncId="resource-usage"
        />
        <DiskIOUsageChart
          diskRead={data?.diskRead || []}
          diskWrite={data?.diskWrite || []}
          isLoading={isLoading}
          syncId="resource-usage"
        />
      </div>
    </div>
  )
}
