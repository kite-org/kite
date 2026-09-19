import { useCallback, useMemo } from 'react'

import { ResourceType } from '@/types/api'
import { useResources, useResourcesWatch } from '@/lib/api'

interface UseResourceTableDataOptions {
  resourceType: ResourceType
  namespace?: string
  useSSE: boolean
  refreshInterval: number
  labelSelector?: string
  reduce?: boolean
}

export function useResourceTableData<T>({
  resourceType,
  namespace,
  useSSE,
  refreshInterval,
  labelSelector,
  reduce = true,
}: UseResourceTableDataOptions) {
  const query = useResources(resourceType, namespace, {
    refreshInterval: useSSE ? 0 : refreshInterval,
    reduce,
    disable: useSSE,
    labelSelector,
  })

  const watch = useResourcesWatch(resourceType, namespace, {
    reduce,
    enabled: useSSE,
    labelSelector,
  })

  const data = useMemo(
    () => (useSSE ? watch.data : query.data) as T[] | undefined,
    [query.data, useSSE, watch.data]
  )
  const refetch = useSSE ? watch.refetch : query.refetch
  const refresh = useCallback(async () => refetch(), [refetch])

  return {
    data,
    isLoading: useSSE ? watch.isLoading : query.isLoading,
    isError: useSSE ? Boolean(watch.error) : query.isError,
    error: (useSSE ? watch.error : query.error) as Error | null,
    refetch: refresh,
    isConnected: watch.isConnected,
  }
}
