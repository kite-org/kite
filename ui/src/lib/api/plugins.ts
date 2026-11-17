import type { PluginManifest } from '@kite-dev/plugin-sdk'
import { validateManifest } from '@kite-dev/plugin-sdk/validation'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import valid from 'semver/functions/valid'

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
  npm?: boolean
  npmPackageName?: string
  npmRegistry?: 'npmjs' | 'npmmirror'
}

export interface CommunityPlugin {
  packageName: string
  version: string
  description?: string
  publisher?: string
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

export function useNPMPluginUpdates(
  installed: InstalledPlugin[] | undefined,
  enabled: boolean
) {
  const { t } = useTranslation()
  const npmPlugins = (installed ?? []).filter((plugin) => plugin.npm)
  return useQueries({
    queries: npmPlugins.map((plugin) => ({
      queryKey: [
        'plugins',
        'npm-updates',
        plugin.id,
        plugin.npmPackageName,
        plugin.npmRegistry,
        plugin.version,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const registry =
          plugin.npmRegistry === 'npmjs'
            ? 'https://registry.npmjs.org'
            : 'https://registry.npmmirror.com'
        const response = await fetch(
          `${registry}/${encodeURIComponent(plugin.npmPackageName!)}/latest`,
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            credentials: 'omit',
            cache: 'no-store',
          }
        )
        if (!response.ok) {
          throw new Error(
            t('plugins.npmUpdateRequestFailed', {
              registry: plugin.npmRegistry,
              status: response.status,
            })
          )
        }
        const metadata: { name?: string; version?: string } =
          await response.json()
        if (
          metadata?.name !== plugin.npmPackageName ||
          typeof metadata.version !== 'string' ||
          metadata.version.length > 128 ||
          !valid(metadata.version)
        ) {
          throw new Error(t('plugins.npmUpdateInvalid'))
        }
        return metadata.version
      },
      enabled,
      refetchOnWindowFocus: false,
      retry: false,
    })),
    combine: (results) => ({
      updates: Object.fromEntries(
        results.map((result, index) => [
          npmPlugins[index].id,
          { version: result.data, error: result.error?.message },
        ])
      ),
      isFetching: results.some((result) => result.isFetching),
      refetch: () => Promise.all(results.map((result) => result.refetch())),
    }),
  })
}

export function useCommunityPlugins(enabled: boolean) {
  const { t } = useTranslation()
  return useQuery({
    queryKey: ['plugins', 'community'],
    queryFn: async ({ signal }) => {
      const requestSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(15000),
      ])
      const plugins: CommunityPlugin[] = []
      const seen = new Set<string>()
      for (let offset = 0; ;) {
        const params = new URLSearchParams({
          text: 'keywords:kite-plugin',
          size: '250',
          from: String(offset),
        })
        const response = await fetch(
          `https://registry.npmjs.org/-/v1/search?${params}`,
          { signal: requestSignal, credentials: 'omit' }
        )
        if (!response.ok) {
          throw new Error(
            t('plugins.npmSearchFailed', { status: response.status })
          )
        }
        const result: {
          objects: {
            package?: {
              name?: string
              version?: string
              keywords?: string[]
              description?: string
              publisher?: { username?: string }
            }
          }[]
          total: number
        } = await response.json()
        if (
          !Array.isArray(result?.objects) ||
          !Number.isSafeInteger(result.total) ||
          result.total < 0
        ) {
          throw new Error(t('plugins.npmSearchInvalid'))
        }
        for (const object of result.objects) {
          const pkg = object?.package
          if (
            !pkg ||
            typeof pkg.name !== 'string' ||
            pkg.name.length > 214 ||
            !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(
              pkg.name
            ) ||
            seen.has(pkg.name) ||
            !Array.isArray(pkg.keywords) ||
            !pkg.keywords.includes('kite-plugin') ||
            typeof pkg.version !== 'string' ||
            pkg.version.length > 128 ||
            !valid(pkg.version)
          )
            continue
          seen.add(pkg.name)
          plugins.push({
            packageName: pkg.name,
            version: pkg.version,
            description:
              typeof pkg.description === 'string' ? pkg.description : undefined,
            publisher:
              typeof pkg.publisher?.username === 'string'
                ? pkg.publisher.username
                : undefined,
          })
        }
        offset += result.objects.length
        if (result.objects.length === 0 || offset >= result.total) {
          return { plugins }
        }
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
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
  source:
    | File
    | { id: string; version: string; npm?: boolean }
    | {
        packageName: string
        registry: 'npmjs' | 'npmmirror'
        version?: string
      },
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
