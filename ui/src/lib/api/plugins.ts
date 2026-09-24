import type { PluginManifest } from '@kite-dev/plugin-sdk'
import { validateManifest } from '@kite-dev/plugin-sdk/validation'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api-client'

export interface ActivePlugin {
  manifest: PluginManifest
  assetBaseUrl: string
  error?: string
}

export interface InstalledPlugin {
  id: string
  enabled: boolean
  version: string
  manifest?: PluginManifest
  error?: string
}

export interface CatalogPlugin {
  id: string
  name: string
  description?: string
  version: string
  sdkVersion: string
  url: string
  sha256: string
  author?: string
  homepage?: string
  readmeUrl?: string
  requires: PluginManifest['requires']
  error?: string
}

export function useActivePlugins(enabled: boolean) {
  return useQuery({
    queryKey: ['plugins', 'active'],
    queryFn: ({ signal }) =>
      apiClient.get<{
        plugins: ActivePlugin[]
        devUrl: string
      }>('/plugins', {
        signal,
      }),
    enabled,
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
  })
}

export function useDevelopmentPlugin(
  address: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['plugins', 'development', address],
    queryFn: async ({ signal }): Promise<ActivePlugin> => {
      const url = new URL(address!)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Plugin development URL must use HTTP or HTTPS')
      }
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        cache: 'no-store',
        credentials: 'omit',
      })
      if (!response.ok) {
        throw new Error(
          `Plugin development URL returned HTTP ${response.status}`
        )
      }
      const manifest: unknown = await response.json()
      validateManifest(manifest)
      return { manifest, assetBaseUrl: new URL('.', response.url).href }
    },
    enabled: enabled && !!address,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export function useInstalledPlugins(enabled: boolean) {
  return useQuery({
    queryKey: ['plugins', 'installed'],
    queryFn: () =>
      apiClient.get<{ plugins: InstalledPlugin[] }>('/admin/plugins'),
    enabled,
    refetchInterval: 15000,
  })
}

export function usePluginCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['plugins', 'catalog'],
    queryFn: () =>
      apiClient.get<{ plugins: CatalogPlugin[] }>('/admin/plugin-catalog'),
    enabled,
    refetchOnWindowFocus: false,
  })
}

export function usePluginReadme(plugin: CatalogPlugin | null) {
  return useQuery({
    queryKey: ['plugins', 'readme', plugin?.id, plugin?.version],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        id: plugin!.id,
        version: plugin!.version,
      })
      return apiClient.get<{ readme: string; baseUrl: string }>(
        `/admin/plugin-catalog/readme?${params}`,
        { signal }
      )
    },
    enabled: plugin !== null,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function installPlugin(
  source: File | { id: string; version: string },
  enabled = true
) {
  if (source instanceof File) {
    const data = new FormData()
    data.append('file', source)
    data.append('enabled', String(enabled))
    return apiClient.post<InstalledPlugin>('/admin/plugins', data)
  }
  return apiClient.post<InstalledPlugin>('/admin/plugins', {
    ...source,
    enabled,
  })
}

export function updatePlugin(id: string, changes: { enabled: boolean }) {
  return apiClient.patch(`/admin/plugins/${encodeURIComponent(id)}`, changes)
}

export function deletePlugin(id: string) {
  return apiClient.delete(`/admin/plugins/${encodeURIComponent(id)}`)
}
