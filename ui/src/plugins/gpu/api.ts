import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api-client'

import type { GpuOverview, ResetDevicePluginResponse } from './types'

export function useGpuOverview() {
  return useQuery<GpuOverview>({
    queryKey: ['plugin-gpu', 'overview'],
    queryFn: () => apiClient.get<GpuOverview>('/plugins/gpu/overview'),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function resetDevicePlugin(node: string, dryRun: boolean) {
  return apiClient.post<ResetDevicePluginResponse>(
    `/plugins/gpu/nodes/${encodeURIComponent(node)}/reset-device-plugin${dryRun ? '?dryRun=true' : ''}`
  )
}
