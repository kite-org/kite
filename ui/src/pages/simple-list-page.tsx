import { useCallback, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ResourceType, ResourceTypeMap } from '@/types/api'
import { formatDate } from '@/lib/utils'
import { ResourceTable } from '@/components/resource-table'

import {
  getResourceDefinition,
  getResourceLabel,
  getResourceScope,
} from './resource-definitions'

export interface ResourceTableProps {
  resourceType?: ResourceType
}

export function SimpleListPage<T extends keyof ResourceTypeMap>({
  resourceType,
}: ResourceTableProps) {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<ResourceTypeMap[T]>()
  const resourceDefinition = resourceType
    ? getResourceDefinition(resourceType)
    : undefined
  const resourceName = resourceType
    ? resourceDefinition?.titleKey
      ? t(resourceDefinition.titleKey, {
          defaultValue: getResourceLabel(resourceType, true),
        })
      : getResourceLabel(resourceType, true)
    : ''
  const isClusterScope = resourceType
    ? getResourceScope(resourceType) === 'cluster'
    : false

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.metadata?.name, {
        header: 'Name',
        cell: ({ row }) => (
          <div className="font-medium app-link">
            <Link
              to={`/${resourceType}${isClusterScope ? '' : `/${row.original.metadata!.namespace}`}/${row.original.metadata!.name}`}
            >
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.metadata?.creationTimestamp, {
        header: 'Created',
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
    ],
    [columnHelper, isClusterScope, resourceType]
  )

  const filter = useCallback((resource: ResourceTypeMap[T], query: string) => {
    return resource.metadata!.name!.toLowerCase().includes(query)
  }, [])

  if (!resourceType) {
    return <div>Resource type "{resourceType}" not found</div>
  }

  return (
    <ResourceTable
      resourceName={resourceName}
      resourceType={resourceType}
      columns={columns}
      clusterScope={isClusterScope}
      searchQueryFilter={filter}
    />
  )
}
