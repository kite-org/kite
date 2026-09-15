import type { ReactNode } from 'react'

import { useResourcePlugin } from './plugin-context'
import { PluginView } from './plugin-view'

export function PluginResourceView({
  view,
  target,
  fallback,
}: {
  view: 'list' | 'detail'
  target?: string
  fallback: ReactNode
}) {
  const plugin = useResourcePlugin(view, target)
  if (!target?.includes('.')) return fallback

  return (
    <PluginView key={`${view}:${target}`} plugin={plugin} fallback={fallback}>
      {(module) =>
        module.resources.find(
          (entry) => `${entry.resource}.${entry.group}` === target
        )![view]
      }
    </PluginView>
  )
}
