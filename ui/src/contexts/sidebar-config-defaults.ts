import type { ComponentType } from 'react'
import { IconBox, type Icon, type IconProps } from '@tabler/icons-react'

import {
  DefaultMenus,
  SidebarConfig,
  SidebarGroup,
  SidebarItem,
} from '@/types/sidebar'
import {
  getResourceIconComponent,
  resourceCatalog,
  resourceIconMap,
  sidebarGroupOrder,
} from '@/lib/resource-catalog'

const sidebarIconMap = resourceIconMap
type CatalogResource = (typeof resourceCatalog)[number]
type SidebarResource = CatalogResource & {
  sidebar: {
    groupKey: (typeof sidebarGroupOrder)[number]
    order: number
    titleKey?: string
  }
}

function hasSidebar(resource: CatalogResource): resource is SidebarResource {
  return 'sidebar' in resource
}

const defaultMenus: DefaultMenus = Object.fromEntries(
  sidebarGroupOrder.map((groupKey) => [groupKey, []])
) as DefaultMenus

resourceCatalog
  .filter(hasSidebar)
  .slice()
  .sort((a, b) => a.sidebar.order - b.sidebar.order)
  .forEach((resource) => {
    const sidebar = resource.sidebar
    defaultMenus[sidebar.groupKey].push({
      titleKey:
        sidebar.titleKey ||
        ('titleKey' in resource ? resource.titleKey : undefined) ||
        resource.pluralLabel,
      url: `/${resource.type}`,
      icon: getResourceIconComponent(resource.icon),
    })
  })

export const SIDEBAR_CONFIG_VERSION = 1

function getIconName(iconComponent: ComponentType<{ className?: string }>) {
  const entry = Object.entries(sidebarIconMap).find(
    ([, component]) => component === iconComponent
  )
  return entry ? entry[0] : 'IconBox'
}

export function getSidebarIconComponent(
  iconName: string
):
  | React.ForwardRefExoticComponent<IconProps & React.RefAttributes<Icon>>
  | React.ElementType {
  return sidebarIconMap[iconName as keyof typeof sidebarIconMap] || IconBox
}

export function buildDefaultSidebarConfig(): SidebarConfig {
  const groups: SidebarGroup[] = []
  let groupOrder = 0

  Object.entries(defaultMenus).forEach(([groupKey, items]) => {
    const groupId = groupKey
      .toLowerCase()
      .replace(/\./g, '-')
      .replace(/\s+/g, '-')
    const sidebarItems: SidebarItem[] = items.map((item, index) => ({
      id: `${groupId}-${item.url.replace(/[^a-zA-Z0-9]/g, '-')}`,
      titleKey: item.titleKey,
      url: item.url,
      icon: getIconName(item.icon),
      visible: true,
      pinned: false,
      order: index,
    }))

    groups.push({
      id: groupId,
      nameKey: groupKey,
      items: sidebarItems,
      visible: true,
      collapsed: false,
      order: groupOrder++,
    })
  })

  return {
    version: SIDEBAR_CONFIG_VERSION,
    groups,
    hiddenItems: [],
    pinnedItems: [],
    groupOrder: groups.map((g) => g.id),
    lastUpdated: Date.now(),
  }
}
