import { createContext, useContext } from 'react'
import type { PluginDefinition } from '@kite-dev/plugin-sdk'

import type { ActivePlugin } from '@/lib/api/plugins'

export interface LoadedPlugin extends ActivePlugin {
  module?: PluginDefinition
  invalid?: boolean
}

export const PluginsContext = createContext<{
  plugins: LoadedPlugin[]
  isLoading: boolean
  loadPlugin: (id: string) => void
}>({
  plugins: [],
  isLoading: false,
  loadPlugin: () => {},
})

export function usePlugins() {
  return useContext(PluginsContext)
}

export function useResourcePlugin(view: 'list' | 'detail', target?: string) {
  const { plugins } = usePlugins()
  if (!target?.includes('.')) return

  return plugins.find(
    (plugin) =>
      !plugin.invalid &&
      plugin.manifest.resources.some(
        (entry) => `${entry.resource}.${entry.group}` === target && entry[view]
      )
  )
}
