import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { ConfigMap } from 'kubernetes-types/core/v1'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceTable } from '@/components/resource-table'

const configMapSearchFilter = createSearchFilter<ConfigMap>(
  (cm) => cm.metadata?.name,
  (cm) => cm.metadata?.namespace,
  (cm) => Object.keys(cm.data || {}),
  (cm) => Object.keys(cm.binaryData || {})
)

const columnHelper = createColumnHelper<ConfigMap>()

export function ConfigMapListPage() {
  // Define columns for the configmap table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/configmaps/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => Object.keys(row.data || {}).join(', '), {
        id: 'data',
        header: 'Data Keys',
        cell: ({ row }) => {
          const data = row.original.data || {}
          const keys = Object.keys(data)
          if (keys.length === 0) {
            return '-'
          }
          const keyList = keys.join(', ')
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="line-clamp-2 max-w-64 break-all text-left text-muted-foreground">
                  {keyList}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-sm break-all">{keyList}</p>
              </TooltipContent>
            </Tooltip>
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
    []
  )

  return (
    <ResourceTable
      resourceName="ConfigMaps"
      columns={columns}
      searchQueryFilter={configMapSearchFilter}
    />
  )
}
