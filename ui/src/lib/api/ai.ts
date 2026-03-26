import { useQuery } from '@tanstack/react-query'

import { fetchAPI } from './shared'

export const getAIStatus = async (): Promise<{ enabled: boolean }> => {
  return fetchAPI<{ enabled: boolean }>('/ai/status')
}

export const useAIStatus = () => {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: getAIStatus,
    retry: false,
  })
}
