import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/auth-context'
import i18n from '@/i18n'
import type { PluginDefinition } from '@kite-dev/plugin-sdk'
import {
  validateManifest,
  validateModule,
} from '@kite-dev/plugin-sdk/validation'

import { useActivePlugins, type ActivePlugin } from '@/lib/api/plugins'

import { PluginsContext, type LoadedPlugin } from './plugin-context'

interface LoadingPlugin {
  record: LoadedPlugin
  serverError?: string
  styles: HTMLLinkElement[]
  cancelled: boolean
  started: boolean
}

function dispose(entry: LoadingPlugin) {
  entry.cancelled = true
  entry.styles.forEach((style) => style.remove())
  if (entry.record.module?.i18n) {
    const namespace = `kite-plugin-${entry.record.manifest.id}`
    for (const language of Object.keys(entry.record.module.i18n)) {
      i18n.removeResourceBundle(language, namespace)
    }
  }
}

export function PluginRuntime({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const active = useActivePlugins(!!user)
  const entries = useRef(new Map<string, LoadingPlugin>())
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([])

  const publish = useCallback(() => {
    setPlugins([...entries.current.values()].map((entry) => entry.record))
  }, [])

  const loadPlugin = useCallback(
    (id: string) => {
      const entry = entries.current.get(id)
      if (!entry || entry.record.invalid || entry.started) return
      entry.started = true
      const plugin = entry.record
      void load(plugin, entry)
        .then((module) => {
          if (entry.cancelled || !module) return
          if (module.i18n) {
            const namespace = `kite-plugin-${id}`
            for (const [language, messages] of Object.entries(module.i18n)) {
              i18n.addResourceBundle(language, namespace, messages)
            }
          }
          entry.record = { ...plugin, module }
          startTransition(publish)
        })
        .catch((error: unknown) => {
          entry.styles.forEach((style) => style.remove())
          if (entry.cancelled) return
          entry.record = {
            ...plugin,
            error: error instanceof Error ? error.message : String(error),
          }
          publish()
        })
    },
    [publish]
  )

  useEffect(() => {
    const currentEntries = entries.current
    const desired = user ? (active.data?.plugins ?? []) : []
    for (const [id, entry] of currentEntries) {
      if (!desired.some((plugin) => plugin.manifest.id === id)) {
        dispose(entry)
        currentEntries.delete(id)
      }
    }
    for (const plugin of desired) {
      const existing = currentEntries.get(plugin.manifest.id)
      if (
        existing?.record.assetBaseUrl === plugin.assetBaseUrl &&
        existing.serverError === plugin.error
      )
        continue
      if (existing) dispose(existing)
      const entry: LoadingPlugin = {
        record: plugin,
        serverError: plugin.error,
        styles: [],
        cancelled: false,
        started: false,
      }
      currentEntries.set(plugin.manifest.id, entry)
      try {
        if (plugin.error) throw new Error(plugin.error)
        validateManifest(plugin.manifest)
      } catch (error) {
        entry.record = {
          ...plugin,
          invalid: true,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    publish()
  }, [active.data, user, publish])

  useEffect(() => {
    const currentEntries = entries.current
    return () => {
      for (const entry of currentEntries.values()) dispose(entry)
      currentEntries.clear()
    }
  }, [])

  return (
    <PluginsContext.Provider
      value={{
        plugins,
        isLoading: active.isLoading,
        loadPlugin,
      }}
    >
      {children}
    </PluginsContext.Provider>
  )
}

async function load(plugin: ActivePlugin, entry: LoadingPlugin) {
  const { federationHost } = await import('./federation-host')
  if (entry.cancelled) return
  const base = new URL(plugin.assetBaseUrl, window.location.origin)
  const name = `kite_plugin_${plugin.manifest.id.replaceAll('-', '_')}_${plugin.manifest.version.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`
  const alias = `plugin_${plugin.manifest.id}_${base.pathname.split('/').filter(Boolean).at(-1)}`
  federationHost.registerRemotes(
    [{ name, alias, entry: new URL(plugin.manifest.entry, base).href }],
    { force: true }
  )
  const module = await federationHost.loadRemote<{ default: PluginDefinition }>(
    `${alias}/${plugin.manifest.module.replace(/^\.\//, '')}`
  )
  if (!module) throw new Error('Plugin module could not be loaded')
  validateModule(plugin.manifest, module.default)
  if (entry.cancelled) return module.default
  await Promise.all(
    (plugin.manifest.styles ?? []).map(
      (path) =>
        new Promise<void>((resolve, reject) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = new URL(path, base).href
          link.dataset.kitePlugin = plugin.manifest.id
          link.onload = () => resolve()
          link.onerror = () =>
            reject(new Error(`Could not load plugin stylesheet: ${path}`))
          entry.styles.push(link)
          document.head.append(link)
        })
    )
  )
  return module.default
}
