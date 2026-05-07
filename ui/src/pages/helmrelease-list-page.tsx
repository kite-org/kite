import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { HelmRelease } from '@/types/api'
import { createSearchFilter } from '@/lib/k8s'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const helmReleaseSearchFilter = createSearchFilter<HelmRelease>(
  (release) => release.metadata?.name,
  (release) => release.metadata?.namespace,
  (release) => release.spec?.chart,
  (release) => release.status?.status
)

export function HelmReleaseListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<HelmRelease>()

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.metadata?.name, {
        id: 'name',
        header: t('common.fields.name'),
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/helmrelease/${row.original.metadata?.namespace}/${row.original.metadata?.name}`}
            >
              {row.original.metadata?.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.spec?.chartName || row.spec?.chart, {
        id: 'chart',
        header: t('helm.fields.chart'),
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor((row) => row.spec?.chartVersion, {
        id: 'version',
        header: t('helm.fields.version'),
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor((row) => row.spec?.revision, {
        id: 'revision',
        header: t('common.fields.revision'),
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor((row) => row.status?.status, {
        id: 'status',
        header: t('common.fields.status'),
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-muted-foreground px-1.5">
            {getValue() || '-'}
          </Badge>
        ),
      }),
      columnHelper.accessor((row) => row.status?.lastDeployed, {
        id: 'lastDeployed',
        header: t('helm.fields.lastDeployed'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm">
            {getValue() ? formatDate(getValue() || '') : '-'}
          </span>
        ),
      }),
    ],
    [columnHelper, t]
  )

  return (
    <ResourceTable
      resourceName="Helm Releases"
      resourceType="helmrelease"
      columns={columns}
      searchQueryFilter={helmReleaseSearchFilter}
    />
  )
}
