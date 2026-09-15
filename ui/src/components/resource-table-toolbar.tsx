import React from 'react'
import { ColumnDef, Table } from '@tanstack/react-table'
import {
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'

import { NamespaceSelector } from './selector/namespace-selector'

export interface ResourceTableBatchAction<T> {
  id: string
  label: string
  icon?: React.ReactNode
  onSelect: (rows: T[]) => void
}

interface ResourceTableToolbarProps<T> {
  table: Table<T>
  resourceName: string
  extraToolbars?: React.ReactNode[]
  onCreateClick?: () => void
  searchQuery: string
  setSearchQuery: (value: string) => void
  searchPlaceholder?: string
  namespace?: { value?: string; onChange: (value: string) => void }
  watch?: {
    enabled: boolean
    connected: boolean
    onChange: (enabled: boolean) => void
  }
  refreshInterval?: number
  onRefreshIntervalChange?: (value: number) => void
  onRefresh?: () => void
  isRefreshing?: boolean
  onOpenDeleteDialog?: () => void
  batchActions?: ResourceTableBatchAction<T>[]
}

export function ResourceTableToolbar<T>({
  table,
  resourceName,
  extraToolbars = [],
  onCreateClick,
  searchQuery,
  setSearchQuery,
  searchPlaceholder,
  namespace,
  watch,
  refreshInterval,
  onRefreshIntervalChange,
  onRefresh,
  isRefreshing,
  onOpenDeleteDialog,
  batchActions = [],
}: ResourceTableToolbarProps<T>) {
  const { t } = useTranslation()

  const filterableColumns = table.getAllColumns().filter((column) => {
    const columnDef = column.columnDef as ColumnDef<T> & {
      enableColumnFilter?: boolean
    }
    return columnDef.enableColumnFilter && column.getCanFilter()
  })

  const getSelectedRows = () =>
    table.getSelectedRowModel().rows.map((row) => row.original)
  const selectedRowCount = table.getSelectedRowModel().rows.length
  const batchActionCount = batchActions.length + (onOpenDeleteDialog ? 1 : 0)
  const showBatchActionsInline = batchActionCount <= 2

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {extraToolbars.map((toolbar, index) => (
            <React.Fragment key={index}>{toolbar}</React.Fragment>
          ))}
          {watch && (
            <Toggle
              pressed={watch.enabled}
              variant="outline"
              className="px-3 text-muted-foreground data-[state=on]:text-foreground"
              aria-label={t('resourceTable.watch')}
              onPressedChange={watch.onChange}
            >
              <span
                className={cn(
                  'bg-muted-foreground/25 size-2 rounded-full',
                  watch.enabled && watch.connected && 'bg-emerald-500',
                  watch.enabled && !watch.connected && 'bg-red-500'
                )}
              />
              <span>{t('resourceTable.watch')}</span>
            </Toggle>
          )}
          {refreshInterval !== undefined && onRefreshIntervalChange && (
            <Select
              value={refreshInterval.toString()}
              onValueChange={(value) => onRefreshIntervalChange(Number(value))}
              disabled={watch?.enabled}
            >
              <SelectTrigger
                className="w-full sm:w-[120px]"
                aria-label={t('resourceTable.refreshInterval')}
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  {t('resourceTable.refreshOff')}
                </SelectItem>
                <SelectItem value="1000">1s</SelectItem>
                <SelectItem value="5000">5s</SelectItem>
                <SelectItem value="10000">10s</SelectItem>
                <SelectItem value="30000">30s</SelectItem>
              </SelectContent>
            </Select>
          )}
          {namespace && (
            <NamespaceSelector
              value={namespace.value}
              onChange={namespace.onChange}
              showAll={true}
              multiple={true}
            />
          )}
          {filterableColumns.map((column) => {
            const columnDef = column.columnDef as ColumnDef<T> & {
              enableColumnFilter?: boolean
            }
            const uniqueValues = column.getFacetedUniqueValues()
            const filterValue = column.getFilterValue() as string
            const optionValues = Array.from(uniqueValues.keys()).filter(Boolean)
            if (
              filterValue &&
              !optionValues.some((value) => String(value) === filterValue)
            ) {
              optionValues.push(filterValue)
            }

            return (
              <Select
                key={column.id}
                value={filterValue || ''}
                onValueChange={(value) =>
                  column.setFilterValue(value === 'all' ? '' : value)
                }
              >
                <SelectTrigger className="w-full sm:w-auto sm:min-w-[8.5rem] sm:max-w-[12rem]">
                  <SelectValue
                    placeholder={`Filter ${typeof columnDef.header === 'string' ? columnDef.header : 'Column'}`}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All{' '}
                    {typeof columnDef.header === 'string'
                      ? columnDef.header
                      : 'Values'}
                  </SelectItem>
                  {optionValues
                    .sort((a, b) => String(a).localeCompare(String(b)))
                    .map((value) => (
                      <SelectItem key={String(value)} value={String(value)}>
                        {String(value)} ({uniqueValues.get(value) || 0})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )
          })}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-[280px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t('resourceTable.searchResources', {
                  resource: resourceName,
                })}
                placeholder={
                  searchPlaceholder ??
                  t('resourceTable.searchResources', { resource: resourceName })
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4"
              />
            </div>
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchQuery('')}
                className="h-9 w-9"
                aria-label={t('resourceTable.clearFilters')}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {selectedRowCount > 0 &&
              batchActionCount > 0 &&
              showBatchActionsInline && (
                <>
                  {batchActions.map((action) => (
                    <Button
                      key={action.id}
                      variant="outline"
                      onClick={() => action.onSelect(getSelectedRows())}
                      className="gap-2 tabular-nums"
                    >
                      {action.icon}
                      {action.label} ({selectedRowCount})
                    </Button>
                  ))}
                  {onOpenDeleteDialog && (
                    <Button
                      variant="destructive"
                      onClick={onOpenDeleteDialog}
                      className="gap-2 tabular-nums"
                    >
                      <Trash2 className="size-4" />
                      {t('resourceTable.deleteSelected', {
                        count: selectedRowCount,
                      })}
                    </Button>
                  )}
                </>
              )}
            {selectedRowCount > 0 && !showBatchActionsInline && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    {t('resourceTable.bulkActions')}
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    {t('resourceTable.selectedCount', {
                      count: selectedRowCount,
                    })}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {batchActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onSelect={() => action.onSelect(getSelectedRows())}
                    >
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                  {batchActions.length > 0 && onOpenDeleteDialog && (
                    <DropdownMenuSeparator />
                  )}
                  {onOpenDeleteDialog && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={onOpenDeleteDialog}
                    >
                      <Trash2 className="size-4" />
                      {t('common.actions.delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onRefresh && (
              <Button
                variant="outline"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={cn('size-4', isRefreshing && 'animate-spin')}
                />
                {t('common.actions.refresh')}
              </Button>
            )}
            {onCreateClick && (
              <Button onClick={onCreateClick} className="gap-1">
                <Plus className="h-2 w-2" />
                {t('common.actions.create')}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t('resourceTable.toggleColumns')}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t('resourceTable.toggleColumns')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    const header = column.columnDef.header
                    const headerText =
                      typeof header === 'string' ? header : column.id

                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {headerText}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}
