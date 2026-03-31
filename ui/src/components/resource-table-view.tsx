import React, { useLayoutEffect, useRef, useState } from 'react'
import {
  flexRender,
  PaginationState,
  Table as TableInstance,
} from '@tanstack/react-table'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ResourceTableViewProps<T> {
  table: TableInstance<T>
  columnCount: number
  isLoading: boolean
  data?: T[]
  allPageSize?: number
  maxBodyHeightClassName?: string
  containerClassName?: string
  fitViewportHeight?: boolean
  emptyState: React.ReactNode
  hasActiveFilters: boolean
  filteredRowCount: number
  totalRowCount: number
  searchQuery: string
  pagination: PaginationState
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>
}

export function ResourceTableView<T>({
  table,
  columnCount,
  isLoading,
  data,
  allPageSize,
  maxBodyHeightClassName = 'max-h-[calc(100dvh-210px)]',
  containerClassName = 'flex flex-col gap-3',
  fitViewportHeight = false,
  emptyState,
  hasActiveFilters,
  filteredRowCount,
  totalRowCount,
  searchQuery,
  pagination,
  setPagination,
}: ResourceTableViewProps<T>) {
  const renderRows = () => {
    const rows = table.getRowModel().rows

    if (rows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={columnCount} className="h-24 text-center">
            No results.
          </TableCell>
        </TableRow>
      )
    }

    return rows.map((row) => (
      <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
        {row.getVisibleCells().map((cell, index) => (
          <TableCell
            key={cell.id}
            className={`align-middle ${index <= 1 ? 'text-left' : 'text-center'}`}
          >
            {cell.column.columnDef.cell
              ? flexRender(cell.column.columnDef.cell, cell.getContext())
              : String(cell.getValue() || '-')}
          </TableCell>
        ))}
      </TableRow>
    ))
  }

  const dataLength = data?.length ?? 0
  const resolvedAllPageSize = allPageSize ?? dataLength
  const rootRef = useRef<HTMLDivElement>(null)
  const tableShellRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!fitViewportHeight || !tableShellRef.current) {
      return
    }

    let frameId = 0
    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate()
    })

    const updateHeight = () => {
      if (!tableShellRef.current) {
        return
      }

      const tableTop = tableShellRef.current.getBoundingClientRect().top
      const footerHeight =
        footerRef.current?.getBoundingClientRect().height ?? 0
      const footerGap = dataLength > 0 ? 12 : 0
      const nextHeight = Math.max(
        240,
        Math.floor(window.innerHeight - tableTop - footerHeight - footerGap)
      )

      setTableHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      )
    }

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(updateHeight)
    }

    scheduleUpdate()
    window.addEventListener('resize', scheduleUpdate)
    resizeObserver.observe(tableShellRef.current)
    if (footerRef.current) {
      resizeObserver.observe(footerRef.current)
    }
    if (rootRef.current?.parentElement) {
      resizeObserver.observe(rootRef.current.parentElement)
    }

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', scheduleUpdate)
      resizeObserver.disconnect()
    }
  }, [dataLength, fitViewportHeight])

  return (
    <div ref={rootRef} className={containerClassName}>
      <div ref={tableShellRef} className="rounded-lg border overflow-hidden">
        <div
          className={`transition-opacity duration-200 ${
            isLoading && dataLength > 0 ? 'opacity-75' : 'opacity-100'
          }`}
        >
          {emptyState || (
            <div
              className={cn(
                'relative overflow-auto scrollbar-hide',
                fitViewportHeight ? 'min-h-[240px]' : maxBodyHeightClassName
              )}
              style={
                fitViewportHeight && tableHeight
                  ? { height: `${tableHeight}px` }
                  : undefined
              }
            >
              <Table>
                <TableHeader className="bg-muted">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header, index) => (
                        <TableHead
                          key={header.id}
                          className={index <= 1 ? 'text-left' : 'text-center'}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              onClick={header.column.getToggleSortingHandler()}
                              className={
                                header.column.getIsSorted()
                                  ? 'text-primary'
                                  : ''
                              }
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                              {header.column.getIsSorted() && (
                                <span className="ml-2">
                                  {header.column.getIsSorted() === 'asc'
                                    ? '↑'
                                    : '↓'}
                                </span>
                              )}
                            </Button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="**:data-[slot=table-cell]:first:w-0">
                  {renderRows()}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {dataLength > 0 && (
        <div
          ref={footerRef}
          className="flex flex-col gap-3 px-2 py-1 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {hasActiveFilters ? (
              <>
                Showing {filteredRowCount} of {totalRowCount} row(s)
                {searchQuery && (
                  <span className="ml-1">(filtered by "{searchQuery}")</span>
                )}
              </>
            ) : (
              `${totalRowCount} row(s) total.`
            )}
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:w-fit">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <span className="text-sm text-muted-foreground">
                Rows per page:
              </span>
              <Select
                value={pagination.pageSize.toString()}
                onValueChange={(value) => {
                  setPagination((prev) => ({
                    ...prev,
                    pageSize: Number(value),
                    pageIndex: 0,
                  }))
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                  {resolvedAllPageSize > 0 && (
                    <SelectItem value={`${resolvedAllPageSize}`}>
                      All
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-center text-sm font-medium">
              Page {pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </div>
            <div className="flex items-center justify-end gap-2 sm:justify-start lg:ml-0">
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>←
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>→
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
