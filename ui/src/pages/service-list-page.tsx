import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Service } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter, getServiceExternalIP } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const serviceSearchFilter = createSearchFilter<Service>(
  (s) => s.metadata?.name,
  (s) => s.spec?.type,
  (s) => s.spec?.clusterIP
)

export function ServiceListPage() {
  const { t } = useTranslation()
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<Service>()

  // Define columns for the service table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/services/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('spec.type', {
        header: t('services.type'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const type = getValue() || 'ClusterIP'
          return <Badge variant="outline">{type}</Badge>
        },
      }),
      columnHelper.accessor('spec.clusterIP', {
        header: t('services.clusterIP'),
        cell: ({ getValue }) => {
          const val = getValue() || '-'
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {val}
            </span>
          )
        },
      }),
      columnHelper.accessor('status.loadBalancer.ingress', {
        header: t('services.externalIP'),
        cell: ({ row }) => {
          const val = getServiceExternalIP(row.original)
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {val}
            </span>
          )
        },
      }),
      columnHelper.accessor('spec.ports', {
        header: t('services.ports'),
        cell: ({ getValue }) => {
          const ports = getValue() || []
          if (ports.length === 0) return '-'
          const text = ports
            .map((port) => {
              const protocol = port.protocol || 'TCP'
              if (port.nodePort) {
                return `${port.port}:${port.nodePort}/${protocol}`
              }
              return `${port.port}/${protocol}`
            })
            .join(', ')
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {text}
            </span>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
    ],
    [columnHelper, t]
  )

  return (
    <ResourceTable
      resourceName="Services"
      columns={columns}
      clusterScope={false} // Services are namespace-scoped
      searchQueryFilter={serviceSearchFilter}
    />
  )
}
