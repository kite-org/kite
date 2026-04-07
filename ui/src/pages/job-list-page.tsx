import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Job } from 'kubernetes-types/batch/v1'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const jobSearchFilter = createSearchFilter<Job>(
  (j) => j.metadata?.name,
  (j) => j.metadata?.namespace
)

export function JobListPage() {
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<Job>()

  // Define columns for the job table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/jobs/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('status.conditions', {
        header: 'Status',
        cell: ({ row }) => {
          const conditions = row.original.status?.conditions || []
          const completedCondition = conditions.find(
            (c) => c.type === 'Complete'
          )
          const failedCondition = conditions.find((c) => c.type === 'Failed')

          let status = 'Running'
          let variant: 'default' | 'destructive' | 'secondary' = 'secondary'

          if (completedCondition?.status === 'True') {
            status = 'Complete'
            variant = 'default'
          } else if (failedCondition?.status === 'True') {
            status = 'Failed'
            variant = 'destructive'
          }

          return <Badge variant={variant}>{status}</Badge>
        },
      }),
      columnHelper.accessor((row) => row.status, {
        id: 'completions',
        header: 'Completions',
        cell: ({ row }) => {
          const status = row.original.status
          const succeeded = status?.succeeded || 0
          const completions = row.original.spec?.completions || 1
          return `${succeeded}/${completions}`
        },
      }),
      columnHelper.accessor('status.startTime', {
        header: 'Started',
        cell: ({ getValue }) => {
          const startTime = getValue()
          if (!startTime) return '-'

          const dateStr = formatDate(startTime)

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
      columnHelper.accessor('status.completionTime', {
        header: 'Completed',
        cell: ({ getValue }) => {
          const completionTime = getValue()
          if (!completionTime) return '-'

          const dateStr = formatDate(completionTime)

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
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
      resourceName="Jobs"
      columns={columns}
      searchQueryFilter={jobSearchFilter}
    />
  )
}
