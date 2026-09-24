import { cloneElement, isValidElement } from 'react'
import { getSidebarIconComponent } from '@/contexts/sidebar-config-defaults'
import { usePlugins } from '@/plugins/plugin-context'
import { PluginView } from '@/plugins/plugin-view'

import type { SidebarItem } from '@/types/sidebar'
import { cn } from '@/lib/utils'

export function SidebarItemIcon({
  item,
  className,
}: {
  item: SidebarItem
  className?: string
}) {
  const { plugins } = usePlugins()
  const plugin = plugins.find(
    (plugin) => !plugin.invalid && plugin.manifest.id === item.pluginId
  )
  const menu = plugin?.manifest.menus.find(
    (menu) => `${plugin.manifest.id}:${menu.id}` === item.id
  )
  const Icon = getSidebarIconComponent(item.icon)
  const fallback = <Icon className={cn('size-4 shrink-0', className)} />
  if (menu?.icon !== true) return fallback

  return (
    <span
      className={cn('inline-flex size-4 shrink-0', className)}
      aria-hidden="true"
    >
      <PluginView plugin={plugin} fallback={fallback} errorFallback={fallback}>
        {(module) => {
          const icon = module.menus.find((entry) => entry.id === menu.id)?.icon
          return isValidElement<{ className?: string }>(icon)
            ? cloneElement(icon, {
                className: cn(icon.props.className, 'size-full'),
              })
            : fallback
        }}
      </PluginView>
    </span>
  )
}
