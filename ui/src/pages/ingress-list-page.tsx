import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Ingress } from 'kubernetes-types/networking/v1'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const filter = createSearchFilter<Ingress>((ns) => ns.metadata?.name)

const columnHelper = createColumnHelper<Ingress>()

export function IngressListPage() {
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/ingresses/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('spec.ingressClassName', {
        header: 'Ingress Class',
        cell: ({ row }) => row.original.spec?.ingressClassName || 'N/A',
      }),
      columnHelper.accessor(
        (row) => row.spec?.rules?.map((rule) => rule.host).join(', ') || '',
        {
          id: 'spec_rules',
          header: 'Hosts',
          cell: ({ row }) => {
            const rules = row.original.spec?.rules || []
            return (
              <Badge variant="outline" className="ml-2 ">
                {rules.length > 0 ? rules.map((r) => r.host).join(', ') : 'N/A'}
              </Badge>
            )
          },
        }
      ),
      columnHelper.accessor(
        (row) =>
          row.status?.loadBalancer?.ingress
            ?.map((ingress) => ingress.ip || ingress.hostname)
            .join(', ') || '',
        {
          id: 'status_loadBalancer_ingress',
          header: 'Load Balancer',
          cell: ({ row }) => {
            const ingress = row.original.status?.loadBalancer?.ingress || []
            return (
              <div>
                {ingress.length > 0
                  ? ingress.map((i) => i.ip || i.hostname).join(', ')
                  : 'N/A'}
              </div>
            )
          },
        }
      ),
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
      resourceName="Ingresses"
      columns={columns}
      searchQueryFilter={filter}
    />
  )
}
