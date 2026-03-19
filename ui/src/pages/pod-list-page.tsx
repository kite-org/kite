import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Pod } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { PodWithMetrics } from '@/types/api'
import { getPodStatus, getPodResources } from '@/lib/k8s'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MetricCell } from '@/components/metrics-cell'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { ResourceTable } from '@/components/resource-table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function PodListPage() {
  const { t } = useTranslation()
  const [metricMode, setMetricMode] = useState<'usage' | 'request' | 'limit'>(
    'usage'
  )

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<PodWithMetrics>()

  const MetricModeSelector = useMemo(
    () => (
      <ToggleGroup
        type="single"
        value={metricMode}
        onValueChange={(value) => {
          if (value) setMetricMode(value as 'usage' | 'request' | 'limit')
        }}
        variant="outline"
        size="sm"
        className="bg-background"
      >
        <ToggleGroupItem value="usage" className="px-3">
          Usage
        </ToggleGroupItem>
        <ToggleGroupItem value="request" className="px-3">
          Request
        </ToggleGroupItem>
        <ToggleGroupItem value="limit" className="px-3">
          Limit
        </ToggleGroupItem>
      </ToggleGroup>
    ),
    [metricMode]
  )

  // Define columns for the pod table - moved outside render cycle for better performance
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/pods/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.status?.containerStatuses, {
        id: 'containers',
        header: t('pods.ready'),
        cell: ({ row }) => {
          const status = getPodStatus(row.original)
          return (
            <div>
              {status.readyContainers} / {status.totalContainers}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => row.status?.phase, {
        header: t('common.status'),
        enableColumnFilter: true,
        cell: ({ row }) => {
          const status = getPodStatus(row.original)
          return (
            <Badge variant="outline" className="text-muted-foreground px-1.5">
              <PodStatusIcon status={status.reason} />
              {status.reason}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => row.status, {
        id: 'restarts',
        header: t('pods.restarts'),
        cell: ({ row }) => {
          const status = getPodStatus(row.original)
          return (
            <span className="text-muted-foreground text-sm">
              {status.restartString}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.cpuUsage || 0, {
        id: 'cpu',
        header: 'CPU',
        cell: ({ row }) => {
          const metrics = { ...row.original.metrics }
          const resources = getPodResources(row.original)
          metrics.cpuRequest = metrics.cpuRequest || resources.cpuRequest
          metrics.cpuLimit = metrics.cpuLimit || resources.cpuLimit

          return (
            <MetricCell metrics={metrics} type="cpu" mode={metricMode} />
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.memoryUsage || 0, {
        id: 'memory',
        header: 'Memory',
        cell: ({ row }) => {
          const metrics = { ...row.original.metrics }
          const resources = getPodResources(row.original)
          metrics.memoryRequest = metrics.memoryRequest || resources.memoryRequest
          metrics.memoryLimit = metrics.memoryLimit || resources.memoryLimit

          return (
            <MetricCell metrics={metrics} type="memory" mode={metricMode} />
          )
        },
      }),
      columnHelper.accessor((row) => row.status?.podIP, {
        id: 'podIP',
        header: 'IP',
        cell: ({ getValue }) => {
          const ip = getValue() || '-'
          return (
            <span className="text-muted-foreground text-sm font-mono">
              {ip}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.spec?.nodeName, {
        id: 'nodeName',
        header: t('pods.node'),
        enableColumnFilter: true,
        cell: ({ row }) => {
          if (row.original.spec?.nodeName) {
            return (
              <div className="font-medium app-link">
                <Link to={`/nodes/${row.original.spec?.nodeName}`}>
                  {row.original.spec?.nodeName}
                </Link>
              </div>
            )
          }
          return '-'
        },
      }),
      columnHelper.accessor((row) => row.metadata?.creationTimestamp, {
        id: 'creationTimestamp',
        header: t('common.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-muted-foreground text-sm">
                  {getAge(getValue() || '')}
                </span>
              </TooltipTrigger>
              <TooltipContent>{dateStr}</TooltipContent>
            </Tooltip>
          )
        },
      }),
    ],
    [columnHelper, t, metricMode]
  )

  // Custom filter for pod search
  const podSearchFilter = useCallback((pod: Pod, query: string) => {
    return (
      pod.metadata?.name?.toLowerCase().includes(query) ||
      (pod.spec?.nodeName?.toLowerCase() || '').includes(query) ||
      (pod.status?.podIP?.toLowerCase() || '').includes(query)
    )
  }, [])

  return (
    <ResourceTable<Pod>
      resourceName="Pods"
      columns={columns}
      clusterScope={false}
      searchQueryFilter={podSearchFilter}
      extraToolbars={[MetricModeSelector]}
    />
  )
}
