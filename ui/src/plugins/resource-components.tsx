import { useMemo, useState } from 'react'
import { ResourceDetailShell } from '@/pages/resource-detail-shell'
import { usePlugin } from '@kite-dev/plugin-sdk/navigation'
import type {
  ResourceDetailShellProps,
  ResourceEventsProps,
  ResourceOverviewProps,
  ResourceTableProps,
} from '@kite-dev/plugin-sdk/ui'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ResourceType } from '@/types/api'
import { useCluster } from '@/hooks/use-cluster'
import { useResourceTable } from '@/hooks/use-resource-table'
import { useResourceTableState } from '@/hooks/use-resource-table-state'
import { Button } from '@/components/ui/button'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { ResourceOverview } from '@/components/resource-overview'
import { ResourceTableToolbar } from '@/components/resource-table-toolbar'
import { ResourceTableView } from '@/components/resource-table-view'

import { resourcePath } from './resource-api'

export function PluginResourceTable<T>(props: ResourceTableProps<T>) {
  const { pluginId } = usePlugin()
  const { currentCluster } = useCluster()
  const storageKey = `plugin:${pluginId}:${props.id}`
  return (
    <PluginResourceTableContent
      key={`${currentCluster}:${storageKey}`}
      {...props}
      storageKey={storageKey}
    />
  )
}

function PluginResourceTableContent<T>({
  storageKey,
  resourceName,
  data,
  columns,
  isLoading = false,
  error,
  onRefresh,
  extraToolbars,
  defaultHiddenColumns = [],
  searchQueryFilter,
  namespace,
  onCreateClick,
  emptyState,
  refreshInterval,
  onRefreshIntervalChange,
}: ResourceTableProps<T> & { storageKey: string }) {
  const { t } = useTranslation()
  const tableState = useResourceTableState({ storageKey, defaultHiddenColumns })
  const { searchQuery, setSearchQuery, pagination, setPagination } = tableState
  const [isRefreshing, setIsRefreshing] = useState(false)
  const rows = useMemo(() => data ?? [], [data])
  const table = useResourceTable({
    data: rows,
    columns,
    state: tableState,
    searchQueryFilter,
  })
  const filteredRowCount = table.getFilteredRowModel().rows.length
  const hasActiveFilters = !!searchQuery || tableState.columnFilters.length > 0
  const clearFilters = () => {
    setSearchQuery('')
    table.resetColumnFilters(true)
  }
  const handleRefresh = async () => {
    if (!onRefresh) return
    setIsRefreshing(true)
    try {
      await onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('plugins.requestFailed')
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ResourceTableToolbar
        table={table}
        resourceName={resourceName}
        extraToolbars={extraToolbars}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        namespace={
          namespace
            ? {
                value: namespace.value,
                onChange: (value) => {
                  namespace.onChange(value)
                  setPagination((previous) => ({ ...previous, pageIndex: 0 }))
                  setSearchQuery('')
                },
              }
            : undefined
        }
        refreshInterval={refreshInterval}
        onRefreshIntervalChange={onRefreshIntervalChange}
        onRefresh={onRefresh ? () => void handleRefresh() : undefined}
        isRefreshing={isRefreshing}
        onCreateClick={onCreateClick}
      />
      {error && rows.length > 0 ? (
        <p role="alert" className="text-destructive">
          {error instanceof Error ? error.message : t('plugins.requestFailed')}
        </p>
      ) : null}
      <ResourceTableView
        table={table}
        columnCount={table.getVisibleLeafColumns().length}
        isLoading={isLoading}
        data={data}
        fitViewportHeight
        emptyState={
          error && !rows.length ? (
            <ErrorMessage
              resourceName={resourceName}
              error={error}
              refetch={() => void handleRefresh()}
            />
          ) : isLoading && !rows.length ? (
            <p className="p-8 text-sm text-muted-foreground" role="status">
              {t('common.messages.loadingResource', { resource: resourceName })}
            </p>
          ) : hasActiveFilters && filteredRowCount === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8">
              <p className="text-sm text-muted-foreground">
                {t('plugins.noResults')}
              </p>
              <Button variant="outline" onClick={clearFilters}>
                {t('resourceTable.clearFilters')}
              </Button>
            </div>
          ) : !rows.length ? (
            (emptyState ?? (
              <p className="p-8 text-sm text-muted-foreground">
                {t('plugins.noResults')}
              </p>
            ))
          ) : null
        }
        hasActiveFilters={hasActiveFilters}
        filteredRowCount={filteredRowCount}
        totalRowCount={rows.length}
        searchQuery={searchQuery}
        pagination={pagination}
        setPagination={setPagination}
      />
    </div>
  )
}

export function PluginResourceDetailShell<T>({
  resource,
  ...props
}: ResourceDetailShellProps<T>) {
  return (
    <ResourceDetailShell
      {...props}
      resourceType={resourcePath(resource) as ResourceType}
      resourceExtensions={false}
      showDelete={props.showDelete ?? false}
      showClone={props.showClone ?? false}
    />
  )
}

export function PluginResourceOverview({
  resource,
  ...props
}: ResourceOverviewProps) {
  return (
    <ResourceOverview
      {...props}
      resourceType={resourcePath(resource) as ResourceType}
    />
  )
}

export function PluginResourceEvents({
  resource,
  ...props
}: ResourceEventsProps) {
  return (
    <EventTable {...props} resource={resourcePath(resource) as ResourceType} />
  )
}
