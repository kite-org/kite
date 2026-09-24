import { usePlugin } from '@kite-dev/plugin-sdk/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { apiClient } from '@/lib/api-client'

/** Reads and writes the instance-wide settings of the current plugin. */
export function usePluginSettings<
  T extends object = Record<string, unknown>,
>() {
  const { pluginId } = usePlugin()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const queryKey = ['plugin-settings', pluginId]

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<T>(`/plugins/${pluginId}/settings`, { signal }),
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: (settings: T) =>
      apiClient.put<T>(`/plugins/${pluginId}/settings`, settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKey, settings)
      toast.success(t('plugins.saved'))
    },
  })

  return {
    settings: query.data,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    error: query.error ?? mutation.error,
    save: mutation.mutateAsync,
  }
}
