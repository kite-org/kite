import { useEffect, useRef, useState } from 'react'
import {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import { getClusterScopedStorageKey } from '@/lib/current-cluster'

interface UseResourceTableStateOptions {
  storageKey: string
  defaultHiddenColumns: string[]
}

function readStoredJSON<T>(storage: Storage, key: string, fallback: T): T {
  const value = storage.getItem(key)
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function useResourceTableState({
  storageKey,
  defaultHiddenColumns,
}: UseResourceTableStateOptions) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    readStoredJSON(
      sessionStorage,
      getClusterScopedStorageKey(`-${storageKey}-columnFilters`),
      []
    )
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return (
      sessionStorage.getItem(
        getClusterScopedStorageKey(`-${storageKey}-searchQuery`)
      ) || ''
    )
  })
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const savedVisibility = readStoredJSON<Record<string, boolean> | null>(
      localStorage,
      getClusterScopedStorageKey(`-${storageKey}-columnVisibility`),
      null
    )
    if (savedVisibility) {
      return savedVisibility
    }

    const initialVisibility: Record<string, boolean> = {}
    defaultHiddenColumns.forEach((columnId) => {
      initialVisibility[columnId] = false
    })
    return initialVisibility
  })
  const [pagination, setPagination] = useState<PaginationState>(() => {
    const savedPageSize = localStorage.getItem(
      getClusterScopedStorageKey(`-${storageKey}-pageSize`)
    )
    return {
      pageIndex: 0,
      pageSize: savedPageSize ? Number(savedPageSize) : 20,
    }
  })
  useEffect(() => {
    const key = getClusterScopedStorageKey(`-${storageKey}-searchQuery`)
    if (searchQuery) {
      sessionStorage.setItem(key, searchQuery)
      return
    }

    sessionStorage.removeItem(key)
  }, [storageKey, searchQuery])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  useEffect(() => {
    localStorage.setItem(
      getClusterScopedStorageKey(`-${storageKey}-columnVisibility`),
      JSON.stringify(columnVisibility)
    )
  }, [columnVisibility, storageKey])

  useEffect(() => {
    localStorage.setItem(
      getClusterScopedStorageKey(`-${storageKey}-pageSize`),
      pagination.pageSize.toString()
    )
  }, [pagination.pageSize, storageKey])

  useEffect(() => {
    const key = getClusterScopedStorageKey(`-${storageKey}-columnFilters`)
    if (columnFilters.length > 0) {
      sessionStorage.setItem(key, JSON.stringify(columnFilters))
      return
    }

    sessionStorage.removeItem(key)
  }, [columnFilters, storageKey])

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [columnFilters, searchQuery])

  return {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    rowSelection,
    setRowSelection,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    columnVisibility,
    setColumnVisibility,
    pagination,
    setPagination,
  }
}
