import type { LocalizedLabel, PluginMenuMetadata } from '@kite-dev/plugin-sdk'
import {
  resolvePluginRoute,
  resolveResourcePath,
} from '@kite-dev/plugin-sdk/navigation'
import { coreMenuGroupIds } from '@kite-dev/plugin-sdk/validation'

import type {
  SidebarConfig,
  SidebarGroup,
  SidebarLinkItem,
} from '@/types/sidebar'

import type { LoadedPlugin } from './plugin-context'

const coreMenuGroups = Object.fromEntries(
  coreMenuGroupIds.map((id) => [
    id,
    `sidebar-groups-${id.slice('core:'.length)}`,
  ])
)

export function pluginLabel(label: LocalizedLabel, language: string) {
  return typeof label === 'string'
    ? label
    : language.startsWith('zh')
      ? label.zh
      : label.en
}

export function mergePluginMenus(
  config: SidebarConfig,
  plugins: LoadedPlugin[],
  language: string
): SidebarConfig {
  const groups: SidebarGroup[] = config.groups.map((group) => ({
    ...group,
    items: [...group.items],
  }))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  for (const plugin of plugins) {
    if (plugin.invalid) continue
    const { manifest } = plugin
    for (const menu of manifest.menus) {
      const id = `${manifest.id}:${menu.id}`
      if (!menu.parent && !menu.route && !menu.resource) {
        const preferences = config.pluginPreferences?.groups[id]
        const group: SidebarGroup = {
          id,
          pluginId: manifest.id,
          nameKey: pluginLabel(menu.label, language),
          visible: preferences?.visible ?? true,
          collapsed: preferences?.collapsed ?? false,
          order: preferences?.order ?? menu.order ?? groups.length,
          items: [...(preferences?.items ?? [])],
        }
        groups.push(group)
        groupMap.set(id, group)
      }
    }
  }
  for (const [id, preferences] of Object.entries(
    config.pluginPreferences?.groups ?? {}
  )) {
    if (!groupMap.has(id))
      groupMap
        .get(coreMenuGroups['core:other'])
        ?.items.push(...(preferences.items ?? []))
  }
  for (const plugin of plugins) {
    if (plugin.invalid) continue
    const { manifest } = plugin
    const menus = new Map(
      manifest.menus.map((menu) => [`${manifest.id}:${menu.id}`, menu])
    )
    const createItem = (menu: PluginMenuMetadata): SidebarLinkItem => {
      const id = `${manifest.id}:${menu.id}`
      const preferences = config.pluginPreferences?.items[id]
      return {
        id,
        type: 'link',
        pluginId: manifest.id,
        titleKey: pluginLabel(menu.label, language),
        icon: typeof menu.icon === 'string' ? menu.icon : 'IconBox',
        visible: true,
        pinned: false,
        order: preferences?.order ?? menu.order ?? 50,
        url: menu.route
          ? resolvePluginRoute(
              { pluginId: manifest.id, routes: manifest.routes },
              menu.route
            )
          : menu.resource
            ? resolveResourcePath(menu.resource)
            : '',
        children:
          menu.route || menu.resource
            ? undefined
            : manifest.menus
                .filter((child) => child.parent === id)
                .map(createItem)
                .sort((a, b) => a.order - b.order),
      }
    }
    for (const menu of manifest.menus) {
      if (!menu.parent && !menu.route && !menu.resource) continue
      if (menu.parent && menus.get(menu.parent)?.parent) continue
      const item = createItem(menu)
      const preferredParent = config.pluginPreferences?.items[item.id]?.parent
      const parent =
        preferredParent && groupMap.has(preferredParent)
          ? preferredParent
          : (coreMenuGroups[menu.parent ?? ''] ??
            menu.parent ??
            coreMenuGroups['core:other'])
      groupMap.get(parent)?.items.push(item)
    }
  }
  return { ...config, groups }
}

export function persistPluginPreferences(config: SidebarConfig): SidebarConfig {
  const preferences: NonNullable<SidebarConfig['pluginPreferences']> = {
    items: { ...config.pluginPreferences?.items },
    groups: Object.fromEntries(
      Object.entries(config.pluginPreferences?.groups ?? {}).map(
        ([id, { order, visible, collapsed }]) => [
          id,
          { order, visible, collapsed },
        ]
      )
    ),
  }
  const groups: SidebarGroup[] = []
  for (const group of config.groups) {
    for (const item of group.items) {
      if (item.pluginId)
        preferences.items[item.id] = { parent: group.id, order: item.order }
    }
    const items = group.items.filter((item) => !item.pluginId)
    if (group.pluginId) {
      preferences.groups[group.id] = {
        order: group.order,
        visible: group.visible,
        collapsed: group.collapsed,
        items,
      }
    } else {
      groups.push({ ...group, items })
    }
  }
  return {
    ...config,
    groups,
    groupOrder: groups.map((group) => group.id),
    pluginPreferences: preferences,
  }
}
