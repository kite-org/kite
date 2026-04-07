import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Link } from 'react-router-dom'

import { Gateway } from '@/types/gateway'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { ResourceTable } from '@/components/resource-table'

const filter = createSearchFilter<Gateway>((gw) => gw.metadata?.name)

export function GatewayListPage() {
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<Gateway>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/gateways/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('spec.gatewayClassName', {
        header: 'Gateway Class',
        cell: ({ row }) => row.original.spec?.gatewayClassName || 'N/A',
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
      resourceName="Gateways"
      columns={columns}
      searchQueryFilter={filter}
    />
  )
}
