import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { PersistentVolume } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { formatDate, parseBytes } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const pvSearchFilter = createSearchFilter<PersistentVolume>(
  (pv) => pv.metadata?.name,
  (pv) => pv.spec?.storageClassName,
  (pv) => pv.status?.phase,
  (pv) => pv.spec?.claimRef?.name,
  (pv) => pv.spec?.claimRef?.namespace
)

const columnHelper = createColumnHelper<PersistentVolume>()

export function PVListPage() {
  const { t } = useTranslation()

  // Define columns for the PV table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link to={`/persistentvolumes/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('status.phase', {
        header: t('common.fields.status'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const phase = getValue() || 'Unknown'
          let variant: 'default' | 'destructive' | 'secondary' = 'secondary'

          switch (phase) {
            case 'Bound':
              variant = 'default'
              break
            case 'Available':
              variant = 'secondary'
              break
            case 'Released':
            case 'Failed':
              variant = 'destructive'
              break
          }

          return <Badge variant={variant}>{phase}</Badge>
        },
      }),
      columnHelper.accessor('spec.storageClassName', {
        header: t('common.fields.storageClass'),
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
        (row) => parseBytes(row.spec?.capacity?.storage || '0'),
        {
          header: t('common.fields.capacity'),
          cell: ({ row }) => row.original.spec?.capacity?.storage || '-',
        }
      ),
      columnHelper.accessor((row) => row.spec?.accessModes?.join(', ') || '', {
        id: 'spec_accessModes',
        header: t('common.fields.accessModes'),
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor('spec.persistentVolumeReclaimPolicy', {
        header: t('common.fields.reclaimPolicy'),
        cell: ({ getValue }) => {
          const policy = getValue()
          return policy || '-'
        },
      }),
      columnHelper.accessor(
        (row) => {
          const claimRef = row.spec?.claimRef
          return claimRef?.name && claimRef.namespace
            ? `${claimRef.namespace}/${claimRef.name}`
            : ''
        },
        {
          id: 'spec_claimRef',
          header: t('common.fields.claim'),
          cell: ({ row }) => {
            const claimRef = row.original.spec?.claimRef
            if (claimRef && claimRef.name && claimRef.namespace) {
              return (
                <div className="font-medium app-link">
                  <Link
                    to={`/persistentvolumeclaims/${claimRef.namespace}/${claimRef.name}`}
                  >
                    {claimRef.namespace}/{claimRef.name}
                  </Link>
                </div>
              )
            }
            return '-'
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
      resourceName={'PersistentVolumes'}
      columns={columns}
      clusterScope={true}
      searchQueryFilter={pvSearchFilter}
    />
  )
}
