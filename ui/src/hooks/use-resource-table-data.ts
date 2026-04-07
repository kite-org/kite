import { useMemo } from 'react'

import { ResourceType } from '@/types/api'
import { useResources, useResourcesWatch } from '@/lib/api'

interface UseResourceTableDataOptions {
  resourceName: string
  resourceType?: ResourceType
  namespace?: string
  useSSE: boolean
  refreshInterval: number
}

export function useResourceTableData<T>({
  resourceName,
  resourceType,
  namespace,
  useSSE,
  refreshInterval,
}: UseResourceTableDataOptions) {
  const resolvedResourceType = (resourceType ??
    (resourceName.toLowerCase() as ResourceType)) as ResourceType

  const query = useResources(resolvedResourceType, namespace, {
    refreshInterval: useSSE ? 0 : refreshInterval,
    reduce: true,
    disable: useSSE,
  })

  const watch = useResourcesWatch(resolvedResourceType, namespace, {
    reduce: true,
    enabled: useSSE,
  })

  const data = useMemo(
    () => (useSSE ? watch.data : query.data) as T[] | undefined,
    [query.data, useSSE, watch.data]
  )

  return {
    resourceType: resolvedResourceType,
    data,
    isLoading: useSSE ? watch.isLoading : query.isLoading,
    isError: useSSE ? Boolean(watch.error) : query.isError,
    error: (useSSE ? watch.error : query.error) as Error | null,
    refetch: useSSE ? watch.refetch : query.refetch,
    isConnected: watch.isConnected,
  }
}
