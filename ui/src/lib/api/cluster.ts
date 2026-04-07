import { useQuery } from '@tanstack/react-query'

import { Cluster } from '@/types/api'

import { apiClient } from '../api-client'

export const fetchCurrentClusters = async (): Promise<Cluster[]> => {
  const response = await apiClient.request('/clusters')

  if (response.status === 403) {
    const errorData = await response.json().catch(() => ({}))
    const redirectUrl = response.headers.get('Location')
    if (redirectUrl) {
      window.location.href = redirectUrl
    }
    throw new Error(`${errorData.error || response.status}`)
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`${errorData.error || response.status}`)
  }

  return response.json()
}

export const useCurrentClusterList = (options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ['clusters'],
    queryFn: fetchCurrentClusters,
    enabled: options?.enabled ?? false,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
