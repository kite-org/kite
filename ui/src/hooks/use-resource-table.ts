import { useEffect } from 'react'
import {
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type TableOptions,
} from '@tanstack/react-table'

import type { useResourceTableState } from './use-resource-table-state'

interface UseResourceTableOptions<T> {
  data: T[]
  columns: TableOptions<T>['columns']
  state: ReturnType<typeof useResourceTableState>
  searchQueryFilter?: (item: T, query: string) => boolean
  additionalSearchColumnIds?: string[]
  filterOnServer?: boolean
  getRowId?: TableOptions<T>['getRowId']
}

export function useResourceTable<T>({
  data,
  columns,
  state,
  searchQueryFilter,
  additionalSearchColumnIds = [],
  filterOnServer = false,
  getRowId,
}: UseResourceTableOptions<T>) {
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: state.sorting,
      columnFilters: state.columnFilters,
      pagination: state.pagination,
      rowSelection: state.rowSelection,
      columnVisibility: state.columnVisibility,
      globalFilter: filterOnServer ? '' : state.searchQuery,
    },
    onSortingChange: state.setSorting,
    onColumnFiltersChange: state.setColumnFilters,
    onPaginationChange: state.setPagination,
    onRowSelectionChange: state.setRowSelection,
    onColumnVisibilityChange: state.setColumnVisibility,
    onGlobalFilterChange: state.setSearchQuery,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getColumnCanGlobalFilter: () => true,
    globalFilterFn: (row, _columnId, value) => {
      const query = String(value).toLowerCase()
      return searchQueryFilter
        ? searchQueryFilter(row.original, query) ||
            row.getVisibleCells().some(
              (cell) =>
                additionalSearchColumnIds.includes(cell.column.id) &&
                String(cell.getValue() ?? '')
                  .toLowerCase()
                  .includes(query)
            )
        : row.getVisibleCells().some((cell) =>
            String(cell.getValue() ?? '')
              .toLowerCase()
              .includes(query)
          )
    },
    autoResetPageIndex: false,
  })
  const { pagination, setPagination } = state
  const lastPageIndex = Math.max(0, table.getPageCount() - 1)
  useEffect(() => {
    if (pagination.pageIndex > lastPageIndex) {
      setPagination((previous) => ({ ...previous, pageIndex: lastPageIndex }))
    }
  }, [lastPageIndex, pagination.pageIndex, setPagination])
  return table
}
