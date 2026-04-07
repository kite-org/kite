import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Link } from 'react-router-dom'

import { HTTPRoute } from '@/types/gateway'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { ResourceTable } from '@/components/resource-table'

const filter = createSearchFilter<HTTPRoute>((hr) => hr.metadata?.name)

export function HTTPRouteListPage() {
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<HTTPRoute>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/httproutes/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('spec.hostnames', {
        header: 'Hostnames',
        cell: ({ row }) => row.original.spec?.hostnames?.join(', ') || 'N/A',
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
      resourceName="HTTPRoutes"
      columns={columns}
      searchQueryFilter={filter}
    />
  )
}
