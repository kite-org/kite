import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { PluginNamespaceContext } from '@/plugins/namespace-context'
import {
  usePluginColumnContributions,
  usePluginResourceColumns,
} from '@/plugins/resource-extensions'
import { ColumnDef } from '@tanstack/react-table'
import { Box, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ResourceType } from '@/types/api'
import { deleteResource } from '@/lib/api'
import { getClusterScopedStorageKey } from '@/lib/current-cluster'
import { getResourceMetadata } from '@/lib/resource-catalog'
import { useCluster } from '@/hooks/use-cluster'
import { useResourceTable } from '@/hooks/use-resource-table'
import { useResourceTableData } from '@/hooks/use-resource-table-data'
import { useResourceTableState } from '@/hooks/use-resource-table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { ErrorMessage } from './error-message'
import {
  ResourceTableToolbar,
  type ResourceTableBatchAction,
} from './resource-table-toolbar'
import { ResourceTableView } from './resource-table-view'

export type { ResourceTableBatchAction } from './resource-table-toolbar'

export interface ResourceTableProps<T> {
  resourceName: string
  searchQueryFilter?: (item: T, query: string) => boolean
  onCreateClick?: () => void
  extraToolbars?: ReactNode[]
  defaultHiddenColumns?: string[]
  resourceType?: ResourceType // Optional, used for fetching resources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  clusterScope?: boolean // If true, don't show namespace selector
  showCreateButton?: boolean // If true, show create button
  batchActions?: ResourceTableBatchAction<T>[]
}

export function ResourceTable<T>(props: ResourceTableProps<T>) {
  const { currentCluster } = useCluster()
  return React.createElement(ResourceTableContent<T>, {
    ...props,
    key: currentCluster || '',
  })
}

function ResourceTableContent<T>({
  resourceName,
  resourceType,
  columns,
  clusterScope = false,
  searchQueryFilter,
  showCreateButton = false,
  onCreateClick,
  extraToolbars = [],
  batchActions = [],
  defaultHiddenColumns = [],
}: ResourceTableProps<T>) {
  const { t } = useTranslation()
  const tableState = useResourceTableState({
    storageKey: resourceName,
    defaultHiddenColumns,
  })
  const {
    columnFilters,
    setRowSelection,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    pagination,
    setPagination,
  } = tableState
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(5000)
  const [selectedNamespace, setSelectedNamespace] = useState<
    string | undefined
  >(() => {
    const storageKey = getClusterScopedStorageKey('selectedNamespace')
    return clusterScope
      ? undefined
      : sessionStorage.getItem(storageKey) ||
          localStorage.getItem(storageKey) ||
          'default'
  })
  const [useSSE, setUseSSE] = useState(false)
  const effectiveNamespace = clusterScope
    ? undefined
    : selectedNamespace?.includes(',')
      ? '_all'
      : selectedNamespace

  useEffect(() => {
    if (clusterScope || selectedNamespace !== undefined) return
    const storageKey = getClusterScopedStorageKey('selectedNamespace')
    setSelectedNamespace(
      sessionStorage.getItem(storageKey) ||
        localStorage.getItem(storageKey) ||
        'default'
    )
  }, [clusterScope, selectedNamespace])

  const handleNamespaceChange = (value: string) => {
    const storageKey = getClusterScopedStorageKey('selectedNamespace')
    sessionStorage.setItem(storageKey, value)
    localStorage.setItem(storageKey, value)
    setSelectedNamespace(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setSearchQuery('')
  }
  const handleUseSSEChange = (pressed: boolean) => {
    setUseSSE(pressed)
    setRefreshInterval((current) => (pressed ? 0 : current || 5000))
  }
  const handleRefreshIntervalChange = (value: number) => {
    setRefreshInterval(value)
    if (value > 0) setUseSSE(false)
  }

  // When the query looks like a label selector, route it to the backend API
  // instead of the client-side name filter.
  const isLabelSelector = searchQuery.includes('=') || searchQuery.includes(':')
  const effectiveLabelSelector =
    debouncedSearchQuery.includes('=') || debouncedSearchQuery.includes(':')
      ? debouncedSearchQuery.replace(/:\s*/g, '=')
      : undefined
  const selectedNamespaces = useMemo(() => {
    if (!selectedNamespace || selectedNamespace === '_all') return []
    return selectedNamespace.split(',').filter(Boolean)
  }, [selectedNamespace])
  const namespaceDescription =
    selectedNamespace === '_all'
      ? 'All Namespaces'
      : selectedNamespaces.length > 1
        ? `${selectedNamespaces.length} namespaces`
        : selectedNamespace
          ? `namespace ${selectedNamespace}`
          : ''
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 })
  const resolvedResourceType =
    resourceType ?? (resourceName.toLowerCase() as ResourceType)
  const extensions = usePluginColumnContributions(
    resolvedResourceType,
    tableState.columnVisibility
  )
  const { data, isLoading, isError, error, refetch, isConnected } =
    useResourceTableData<T>({
      resourceType: resolvedResourceType,
      namespace: effectiveNamespace,
      useSSE,
      refreshInterval,
      labelSelector: effectiveLabelSelector,
      reduce: !extensions.hasVisibleColumns,
    })
  const pluginColumns = usePluginResourceColumns<T>({
    extensions,
    onRefresh: refetch,
  })
  const displayResourceName = (() => {
    const resource = getResourceMetadata(resolvedResourceType)
    if (!resource) {
      return resourceName
    }
    if (resource.titleKey) {
      return t(resource.titleKey, {
        defaultValue:
          resource.shortLabel || resource.pluralLabel || resourceName,
      })
    }
    return resource.shortLabel || resource.pluralLabel || resourceName
  })()

  const enhancedColumns = useMemo(() => {
    const selectColumn: ColumnDef<T> = {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }

    const baseColumns: ResourceTableProps<T>['columns'] = [
      selectColumn,
      ...columns,
      ...pluginColumns,
    ]

    // Only add namespace column if not cluster scope, showing all namespaces,
    // and there isn't already a namespace column in the provided columns
    if (
      !clusterScope &&
      (selectedNamespace === '_all' || selectedNamespaces.length > 1)
    ) {
      const hasNamespaceColumn = columns.some((col) => {
        if ('accessorKey' in col && col.accessorKey === 'metadata.namespace') {
          return true
        }
        if ('accessorFn' in col && col.id === 'namespace') {
          return true
        }
        return false
      })

      if (!hasNamespaceColumn) {
        const namespaceColumn = {
          id: 'namespace',
          header: t('resourceTable.namespace'),
          accessorFn: (row: T) => {
            const metadata = (row as { metadata?: { namespace?: string } })
              ?.metadata
            return metadata?.namespace || '-'
          },
          cell: ({ getValue }: { getValue: () => string }) => (
            <Badge variant="outline" className="ml-2 ">
              {getValue()}
            </Badge>
          ),
        }

        // Insert namespace column after select and first column (typically name)
        const columnsWithNamespace = [...baseColumns]
        columnsWithNamespace.splice(2, 0, namespaceColumn)
        return columnsWithNamespace
      }
    }
    return baseColumns
  }, [
    columns,
    pluginColumns,
    clusterScope,
    selectedNamespace,
    selectedNamespaces.length,
    t,
  ])

  const namespaceFilteredData = useMemo(() => {
    if (clusterScope || selectedNamespaces.length <= 1) {
      return data
    }

    return (data as T[] | undefined)?.filter((item) => {
      const namespace = (item as { metadata?: { namespace?: string } })
        ?.metadata?.namespace
      return namespace ? selectedNamespaces.includes(namespace) : false
    })
  }, [clusterScope, data, selectedNamespaces])

  const memoizedData = useMemo(
    () =>
      pluginColumns.length
        ? [...(namespaceFilteredData || [])]
        : namespaceFilteredData || [],
    // TanStack caches accessor values on rows; replace rows when plugin accessors change.
    [namespaceFilteredData, pluginColumns]
  )

  useEffect(() => {
    if (!useSSE && error && !effectiveLabelSelector) {
      setRefreshInterval(0)
    }
  }, [useSSE, error, effectiveLabelSelector, setRefreshInterval])

  const pluginColumnIds = new Set(pluginColumns.map((column) => column.id))
  const isAvailableColumn = ({ id }: { id: string }) =>
    !id.startsWith('plugin:') || pluginColumnIds.has(id)

  const table = useResourceTable({
    data: memoizedData,
    columns: enhancedColumns,
    state: {
      ...tableState,
      columnVisibility: extensions.columnVisibility,
      sorting: tableState.sorting.filter(isAvailableColumn),
      columnFilters: tableState.columnFilters.filter(isAvailableColumn),
    },
    searchQueryFilter,
    additionalSearchColumnIds: pluginColumns.map((column) => column.id!),
    filterOnServer: isLabelSelector,
    getRowId: (row) => {
      const metadata = (
        row as {
          metadata?: { name?: string; namespace?: string; uid?: string }
        }
      )?.metadata
      if (!metadata?.name) {
        return `row-${Math.random()}`
      }
      return (
        metadata.uid ||
        (metadata.namespace
          ? `${metadata.namespace}/${metadata.name}`
          : metadata.name)
      )
    },
  })

  // Handle batch delete - must be after table is defined
  const handleBatchDelete = useCallback(async () => {
    setIsDeleting(true)
    const selectedRows = table
      .getSelectedRowModel()
      .rows.map((row) => row.original)

    const total = selectedRows.length
    setDeleteProgress({ done: 0, total })

    const deletePromises = selectedRows.map((row) => {
      const metadata = (
        row as { metadata?: { name?: string; namespace?: string } }
      )?.metadata
      const name = metadata?.name
      const namespace = clusterScope ? undefined : metadata?.namespace

      if (!name) {
        setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
        return Promise.resolve()
      }

      return deleteResource(resolvedResourceType, name, namespace)
        .then(() => {
          setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
          toast.success(t('resourceTable.deleteSuccess', { name }))
        })
        .catch((error) => {
          setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
          console.error(`Failed to delete ${name}:`, error)
          toast.error(
            t('resourceTable.deleteFailed', { name, error: error.message })
          )
          throw error
        })
    })

    try {
      await Promise.allSettled(deletePromises)
      // Reset selection and close dialog
      setRowSelection({})
      setDeleteDialogOpen(false)
      // Refetch data
      if (!useSSE) {
        refetch()
      }
    } finally {
      setIsDeleting(false)
    }
  }, [
    table,
    clusterScope,
    resolvedResourceType,
    t,
    useSSE,
    refetch,
    setRowSelection,
    setDeleteDialogOpen,
  ])
  const totalRowCount = namespaceFilteredData?.length ?? 0
  const filteredRowCount = table.getFilteredRowModel().rows.length
  const hasActiveFilters = Boolean(searchQuery) || columnFilters.length > 0

  const renderEmptyState = () => {
    // Only show loading state if there's no existing data
    if (
      isLoading &&
      (!namespaceFilteredData || (namespaceFilteredData as T[]).length === 0)
    ) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Database className="h-12 w-12 text-muted-foreground animate-pulse" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            Loading {displayResourceName}...
          </h3>
          <p className="text-muted-foreground">
            Retrieving data
            {!clusterScope && namespaceDescription
              ? ` from ${namespaceDescription}`
              : ''}
          </p>
        </div>
      )
    }

    if (isError) {
      return (
        <ErrorMessage
          resourceName={displayResourceName}
          error={error}
          refetch={refetch}
        />
      )
    }

    if (namespaceFilteredData && (namespaceFilteredData as T[]).length === 0) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Box className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            No {displayResourceName} found
          </h3>
          <p className="text-muted-foreground">
            {searchQuery
              ? isLabelSelector
                ? `No ${displayResourceName} match labels: "${searchQuery}"`
                : `No results match your search query: "${searchQuery}"`
              : clusterScope
                ? `There are no ${displayResourceName} found`
                : `There are no ${displayResourceName} in ${namespaceDescription}`}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setSearchQuery('')}
            >
              Clear Search
            </Button>
          )}
        </div>
      )
    }

    return null
  }

  const emptyState = renderEmptyState()

  return (
    <PluginNamespaceContext.Provider
      value={{
        namespace: selectedNamespace ?? '_all',
        setNamespace: handleNamespaceChange,
      }}
    >
      <div className="flex flex-col gap-3">
        <ResourceTableToolbar
          table={table}
          resourceName={displayResourceName}
          extraToolbars={extraToolbars}
          onCreateClick={showCreateButton ? onCreateClick : undefined}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchPlaceholder={`Search ${displayResourceName} or app=nginx...`}
          namespace={
            clusterScope
              ? undefined
              : {
                  value: selectedNamespace,
                  onChange: handleNamespaceChange,
                }
          }
          watch={
            resolvedResourceType === 'pods'
              ? {
                  enabled: useSSE,
                  connected: isConnected,
                  onChange: handleUseSSEChange,
                }
              : undefined
          }
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={handleRefreshIntervalChange}
          onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
          batchActions={batchActions}
        />

        <ResourceTableView
          table={table}
          columnCount={enhancedColumns.length}
          isLoading={isLoading}
          data={namespaceFilteredData as T[] | undefined}
          fitViewportHeight={true}
          emptyState={emptyState}
          hasActiveFilters={hasActiveFilters}
          filteredRowCount={filteredRowCount}
          totalRowCount={totalRowCount}
          searchQuery={searchQuery}
          pagination={pagination}
          setPagination={setPagination}
        />

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('resourceTable.confirmDeletion')}</DialogTitle>
              <DialogDescription>
                {t('resourceTable.confirmDeletionMessage', {
                  count: table.getSelectedRowModel().rows.length,
                  resourceName: displayResourceName,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={isDeleting}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleBatchDelete}
                disabled={isDeleting}
              >
                {isDeleting
                  ? t('resourceTable.deletingProgress', {
                      done: deleteProgress.done,
                      total: deleteProgress.total,
                    })
                  : t('common.actions.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PluginNamespaceContext.Provider>
  )
}
