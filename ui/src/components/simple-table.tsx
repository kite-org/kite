import React, { useMemo, useState } from 'react'

import { Button } from './ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'

interface Column<T> {
  header: string
  accessor: (item: T) => unknown
  cell: (value: unknown) => React.ReactNode
  align?: 'left' | 'center' | 'right'
}

interface SimpleTableProps<T> {
  data: T[]
  columns: Column<T>[]
  emptyMessage?: string
  pagination?: {
    enabled: boolean
    pageSize?: number
    showPageInfo?: boolean
    currentPage?: number
    onPageChange?: (page: number) => void
  }
}

export function SimpleTable<T>({
  data,
  columns,
  emptyMessage = 'No data available',
  pagination,
}: SimpleTableProps<T>) {
  const isControlled =
    pagination &&
    typeof pagination.currentPage === 'number' &&
    typeof pagination.onPageChange === 'function'
  const [uncontrolledPage, setUncontrolledPage] = useState(1)
  const currentPage = isControlled ? pagination!.currentPage! : uncontrolledPage
  const setCurrentPage = isControlled
    ? pagination!.onPageChange!
    : setUncontrolledPage

  const paginationConfig = useMemo(
    () => ({
      enabled: pagination?.enabled ?? false,
      pageSize: pagination?.pageSize ?? 10,
      showPageInfo: pagination?.showPageInfo ?? true,
    }),
    [pagination]
  )

  const { paginatedData, totalPages, startIndex, endIndex } = useMemo(() => {
    if (!paginationConfig.enabled) {
      return {
        paginatedData: data,
        totalPages: 1,
        startIndex: 1,
        endIndex: data.length,
      }
    }

    const { pageSize } = paginationConfig
    const totalPages = Math.ceil(data.length / pageSize)
    const startIndex = (currentPage - 1) * pageSize
    const endIndex = Math.min(startIndex + pageSize, data.length)
    const paginatedData = data.slice(startIndex, endIndex)

    return {
      paginatedData,
      totalPages,
      startIndex: startIndex + 1,
      endIndex,
    }
  }, [data, currentPage, paginationConfig])

  const handlePreviousPage = () => {
    if (isControlled) {
      setCurrentPage(Math.max(currentPage - 1, 1))
    } else {
      setUncontrolledPage(Math.max(currentPage - 1, 1))
    }
  }

  const handleNextPage = () => {
    if (isControlled) {
      setCurrentPage(Math.min(currentPage + 1, totalPages))
    } else {
      setUncontrolledPage(Math.min(currentPage + 1, totalPages))
    }
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }
  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead
                key={index}
                className={
                  column.align === 'left'
                    ? 'text-left'
                    : column.align === 'right'
                      ? 'text-right'
                      : 'text-center'
                }
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedData.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            paginatedData.map((item, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((column, colIndex) => (
                  <TableCell
                    key={colIndex}
                    className={
                      column.align === 'left'
                        ? 'text-left'
                        : column.align === 'right'
                          ? 'text-right'
                          : 'text-center'
                    }
                  >
                    {column.cell(column.accessor(item))}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {paginationConfig.enabled && data.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {paginationConfig.showPageInfo && (
            <div className="text-sm text-muted-foreground">
              Showing {startIndex} - {endIndex} of {data.length} entries
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
            >
              Previous
            </Button>

            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((page) => {
                  // Show current page ±2 pages, plus first and last page
                  return (
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 2 && page <= currentPage + 2)
                  )
                })
                .map((page, index, array) => {
                  const prevPage = array[index - 1]
                  const showEllipsis = prevPage && page - prevPage > 1

                  return (
                    <React.Fragment key={page}>
                      {showEllipsis && (
                        <span className="px-2 text-muted-foreground">...</span>
                      )}
                      <Button
                        variant={currentPage === page ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePageChange(page)}
                        className="min-w-[32px]"
                      >
                        {page}
                      </Button>
                    </React.Fragment>
                  )
                })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export type { Column }
