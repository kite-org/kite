import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { CustomResourceDefinition } from 'kubernetes-types/apiextensions/v1'
import { Link } from 'react-router-dom'

import { createSearchFilter } from '@/lib/k8s'
import { getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResourceTable } from '@/components/resource-table'

const searchQueryFilter = createSearchFilter<CustomResourceDefinition>(
  (crd) => crd.metadata?.name,
  (crd) => crd.spec?.group,
  (crd) => crd.spec?.scope,
  (crd) => crd.spec?.versions?.map((v: { name: string }) => v.name)
)

export function CRDListPage() {
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<CustomResourceDefinition>()

  // Define columns for the CRD table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link to={`/crds/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('spec.group', {
        header: 'Group',
        enableColumnFilter: true,
        cell: ({ getValue }) => (
          <span className="text-sm font-mono">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('spec.versions', {
        header: 'Versions',
        cell: ({ getValue }) => {
          const versions = getValue() || []
          return (
            <div className="flex flex-wrap gap-1">
              {versions.map(
                (
                  version: {
                    name: string
                    served?: boolean
                    storage?: boolean
                  },
                  index: number
                ) => (
                  <Badge
                    key={index}
                    variant={version.served ? 'default' : 'secondary'}
                    className="text-xs font-mono"
                  >
                    {version.name}
                  </Badge>
                )
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor('spec.scope', {
        header: 'Scope',
        cell: ({ getValue }) => (
          <Badge
            variant={getValue() === 'Namespaced' ? 'default' : 'outline'}
            className="text-xs"
          >
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor('status.conditions', {
        header: 'Status',
        cell: ({ getValue }) => {
          const conditions = getValue() || []
          const establishedCondition = conditions.find(
            (c: { type: string; status: string }) => c.type === 'Established'
          )
          const isEstablished = establishedCondition?.status === 'True'

          return (
            <Badge
              variant={isEstablished ? 'default' : 'destructive'}
              className="text-xs"
            >
              {isEstablished ? 'Established' : 'Not Ready'}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: 'Age',
        cell: ({ getValue }) => {
          return getAge(getValue() as string)
        },
      }),
    ],
    [columnHelper]
  )

  return (
    <ResourceTable
      resourceName="Custom Resource Definitions"
      resourceType="crds"
      columns={columns}
      clusterScope={true} // CRDs are cluster-scoped
      searchQueryFilter={searchQueryFilter}
    />
  )
}
