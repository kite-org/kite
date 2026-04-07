import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate, parseBytes } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const pvcSearchFilter = createSearchFilter<PersistentVolumeClaim>(
  (pvc) => pvc.metadata?.name,
  (pvc) => pvc.metadata?.namespace,
  (pvc) => pvc.spec?.volumeName,
  (pvc) => pvc.spec?.storageClassName,
  (pvc) => pvc.status?.phase
)

export function PVCListPage() {
  const { t } = useTranslation()
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<PersistentVolumeClaim>()

  // Define columns for the pvc table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/persistentvolumeclaims/${row.original.metadata!.namespace}/${
                row.original.metadata!.name
              }`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('status.phase', {
        header: t('common.status'),
        cell: ({ getValue }) => {
          const phase = getValue() || 'Unknown'
          let variant: 'default' | 'destructive' | 'secondary' = 'secondary'

          switch (phase) {
            case 'Bound':
              variant = 'default'
              break
            case 'Lost':
              variant = 'destructive'
              break
            case 'Pending':
              variant = 'secondary'
              break
          }

          return <Badge variant={variant}>{phase}</Badge>
        },
      }),
      columnHelper.accessor('spec.volumeName', {
        header: t('pvcs.volume'),
        cell: ({ getValue }) => {
          const volumeName = getValue()
          if (volumeName) {
            return (
              <div className="font-medium app-link">
                <Link to={`/persistentvolumes/${volumeName}`}>
                  {volumeName}
                </Link>
              </div>
            )
          }
          return '-'
        },
      }),
      columnHelper.accessor('spec.storageClassName', {
        header: t('pvcs.storageClass'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const scName = getValue()
          if (scName) {
            return (
              <div className="font-medium app-link">
                <Link to={`/storageclasses/${scName}`}>{scName}</Link>
              </div>
            )
          }
          return '-'
        },
      }),
      columnHelper.accessor(
        (row) => parseBytes(row.spec?.resources?.requests?.storage || '0'),
        {
          header: t('pvcs.capacity'),
          cell: ({ row }) =>
            row.original.spec?.resources?.requests?.storage || '-',
        }
      ),
      columnHelper.accessor('spec.accessModes', {
        header: t('pvcs.accessModes'),
        cell: ({ getValue }) => {
          const modes = getValue() || []
          return modes.join(', ') || '-'
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
      resourceName={'PersistentVolumeClaims'}
      columns={columns}
      searchQueryFilter={pvcSearchFilter}
    />
  )
}
