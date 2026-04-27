import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Namespace } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { getAge } from '@/lib/utils'
import { ResourceTable } from '@/components/resource-table'

const filter = createSearchFilter<Namespace>((ns) => ns.metadata?.name)

export function NamespaceListPage() {
  const { t } = useTranslation()
  // Definecolumn helper outside of any hooks
  const columnHelper = createColumnHelper<Namespace>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link to={`/namespaces/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('status.phase', {
        header: t('common.fields.status'),
        cell: ({ row }) => row.original.status!.phase || 'Unknown',
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.fields.created'),
        cell: ({ getValue }) => {
          return getAge(getValue() as string)
        },
      }),
    ],
    [columnHelper, t]
  )

  return (
    <ResourceTable
      resourceName="Namespaces"
      columns={columns}
      clusterScope={true}
      searchQueryFilter={filter}
    />
  )
}
