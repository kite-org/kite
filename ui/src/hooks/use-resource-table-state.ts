import { useCallback, useEffect, useState } from 'react'
import {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import { getClusterScopedStorageKey } from '@/lib/current-cluster'

interface UseResourceTableStateOptions {
  resourceName: string
  clusterScope: boolean
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
  resourceName,
  clusterScope,
  defaultHiddenColumns,
}: UseResourceTableStateOptions) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    readStoredJSON(
      sessionStorage,
      getClusterScopedStorageKey(`-${resourceName}-columnFilters`),
      []
    )
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return (
      sessionStorage.getItem(
        getClusterScopedStorageKey(`-${resourceName}-searchQuery`)
      ) || ''
    )
  })
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const savedVisibility = readStoredJSON<Record<string, boolean> | null>(
      localStorage,
      getClusterScopedStorageKey(`-${resourceName}-columnVisibility`),
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
    const savedPageSize = sessionStorage.getItem(
      getClusterScopedStorageKey(`-${resourceName}-pageSize`)
    )
    return {
      pageIndex: 0,
      pageSize: savedPageSize ? Number(savedPageSize) : 20,
    }
  })
  const [refreshInterval, setRefreshInterval] = useState(5000)
  const [selectedNamespace, setSelectedNamespace] = useState<
    string | undefined
  >(() => {
    const storedNamespace = localStorage.getItem(
      getClusterScopedStorageKey('selectedNamespace')
    )
    return clusterScope ? undefined : storedNamespace || 'default'
  })
  const [useSSE, setUseSSE] = useState(false)

  const effectiveNamespace = clusterScope ? undefined : selectedNamespace

  useEffect(() => {
    if (clusterScope || selectedNamespace !== undefined) {
      return
    }

    const storedNamespace = localStorage.getItem(
      getClusterScopedStorageKey('selectedNamespace')
    )
    setSelectedNamespace(storedNamespace || 'default')
  }, [clusterScope, selectedNamespace])

  useEffect(() => {
    const storageKey = getClusterScopedStorageKey(
      `-${resourceName}-searchQuery`
    )
    if (searchQuery) {
      sessionStorage.setItem(storageKey, searchQuery)
      return
    }

    sessionStorage.removeItem(storageKey)
  }, [resourceName, searchQuery])

  useEffect(() => {
    localStorage.setItem(
      getClusterScopedStorageKey(`-${resourceName}-columnVisibility`),
      JSON.stringify(columnVisibility)
    )
  }, [columnVisibility, resourceName])

  useEffect(() => {
    sessionStorage.setItem(
      getClusterScopedStorageKey(`-${resourceName}-pageSize`),
      pagination.pageSize.toString()
    )
  }, [pagination.pageSize, resourceName])

  useEffect(() => {
    const storageKey = getClusterScopedStorageKey(
      `-${resourceName}-columnFilters`
    )
    if (columnFilters.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(columnFilters))
      return
    }

    sessionStorage.removeItem(storageKey)
  }, [columnFilters, resourceName])

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [columnFilters, searchQuery])

  const handleNamespaceChange = useCallback((value: string) => {
    localStorage.setItem(getClusterScopedStorageKey('selectedNamespace'), value)
    setSelectedNamespace(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setSearchQuery('')
  }, [])

  const handleUseSSEChange = useCallback((pressed: boolean) => {
    setUseSSE(pressed)
    setRefreshInterval((current) => {
      if (pressed) {
        return 0
      }
      if (current === 0) {
        return 5000
      }
      return current
    })
  }, [])

  const handleRefreshIntervalChange = useCallback((value: number) => {
    setRefreshInterval(value)
    if (value > 0) {
      setUseSSE(false)
    }
  }, [])

  return {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    rowSelection,
    setRowSelection,
    deleteDialogOpen,
    setDeleteDialogOpen,
    searchQuery,
    setSearchQuery,
    columnVisibility,
    setColumnVisibility,
    pagination,
    setPagination,
    refreshInterval,
    setRefreshInterval,
    selectedNamespace,
    effectiveNamespace,
    useSSE,
    handleNamespaceChange,
    handleUseSSEChange,
    handleRefreshIntervalChange,
  }
}
