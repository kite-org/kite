import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v2'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { ResourceTable } from '@/components/resource-table'

function getHpaTargetInfo(hpa: HorizontalPodAutoscaler): string {
  if (!hpa.spec?.scaleTargetRef) {
    return '-'
  }
  const { kind, name } = hpa.spec.scaleTargetRef
  return `${kind}/${name}`
}

function getCurrentReplicas(hpa: HorizontalPodAutoscaler): number {
  return hpa.status?.currentReplicas || 0
}

function getMetricUtilization(hpa: HorizontalPodAutoscaler): string {
  if (!hpa.status?.currentMetrics || hpa.status.currentMetrics.length === 0) {
    return '-'
  }

  const metrics = hpa.status.currentMetrics
  const results: string[] = []

  metrics.forEach((metric) => {
    if ('resource' in metric && metric.resource) {
      const current = metric.resource.current?.averageUtilization || 0
      const target =
        hpa.spec?.metrics?.find(
          (m) => 'resource' in m && m.resource?.name === metric.resource?.name
        )?.resource?.target?.averageUtilization || 0
      results.push(`${metric.resource.name}: ${current}% / ${target}%`)
    } else if (metric.type === 'Pods') {
      results.push('Pods metric')
    } else if (metric.type === 'Object') {
      results.push('Object metric')
    } else if (metric.type === 'External') {
      results.push('External metric')
    }
  })

  return results.join(', ')
}

const horizontalPodAutoscalerSearchFilter =
  createSearchFilter<HorizontalPodAutoscaler>(
    (hpa) => hpa.metadata?.name,
    (hpa) => hpa.metadata?.namespace,
    (hpa) => getHpaTargetInfo(hpa)
  )

export function HorizontalPodAutoscalerListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<HorizontalPodAutoscaler>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/horizontalpodautoscalers/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => getHpaTargetInfo(row), {
        header: 'Target',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor((row) => row.spec?.minReplicas, {
        id: 'minReplicas',
        header: 'Min Pods',
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor((row) => row.spec?.maxReplicas, {
        id: 'maxReplicas',
        header: 'Max Pods',
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor((row) => getCurrentReplicas(row), {
        id: 'currentReplicas',
        header: 'Current Pods',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor((row) => getMetricUtilization(row), {
        id: 'metrics',
        header: 'Metrics',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: 'Created',
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
    ],
    [columnHelper]
  )

  return (
    <ResourceTable
      resourceName={t('nav.horizontalpodautoscalers', { defaultValue: 'HPA' })}
      resourceType="horizontalpodautoscalers"
      columns={columns}
      searchQueryFilter={horizontalPodAutoscalerSearchFilter}
    />
  )
}
