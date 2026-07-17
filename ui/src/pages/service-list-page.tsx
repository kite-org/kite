import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Service } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import {
  createSearchFilter,
  getServiceExternalIP,
  getServicePortSearchValues,
} from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const serviceSearchFilter = createSearchFilter<Service>(
  (s) => s.metadata?.name,
  (s) => s.spec?.type,
  (s) => s.spec?.clusterIP,
  (s) => getServicePortSearchValues(s)
)

const columnHelper = createColumnHelper<Service>()

export function ServiceListPage() {
  const { t } = useTranslation()

  // Define columns for the service table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
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
      columnHelper.accessor((row) => row.spec?.type || 'ClusterIP', {
        id: 'spec_type',
        header: t('common.fields.type'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const type = getValue() || 'ClusterIP'
          return <Badge variant="outline">{type}</Badge>
        },
      }),
      columnHelper.accessor('spec.clusterIP', {
        header: t('common.fields.clusterIP'),
        cell: ({ getValue }) => {
          const val = getValue() || '-'
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {val}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => getServiceExternalIP(row), {
        id: 'status_loadBalancer_ingress',
        header: t('common.fields.externalIP'),
        cell: ({ getValue }) => {
          const val = getValue()
          return (
            <span className="font-mono text-sm text-muted-foreground">
              {val}
            </span>
          )
        },
      }),
      columnHelper.accessor(
        (row) => getServicePortSearchValues(row).join(', '),
        {
          id: 'spec_ports',
          header: t('common.fields.ports'),
          cell: ({ row }) => {
            const ports = row.original.spec?.ports || []
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
        }
      ),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.fields.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
    ],
    [t]
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
