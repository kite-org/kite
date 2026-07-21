interface SidebarItemBase {
  id: string
  titleKey: string
  icon: string
  visible: boolean
  pinned: boolean
  order: number
}

export interface SidebarLinkItem extends SidebarItemBase {
  type: 'link'
  url: string
}

export interface SidebarCustomResourceItem extends SidebarItemBase {
  type: 'customResource'
  url: string
}

export interface SidebarAPIGroupItem extends SidebarItemBase {
  type: 'apiGroup'
  apiGroup: string
}

export type SidebarItem =
  SidebarLinkItem | SidebarCustomResourceItem | SidebarAPIGroupItem

export interface SidebarGroup {
  id: string
  nameKey: string
  items: SidebarItem[]
  visible: boolean
  collapsed: boolean
  order: number
  isCustom?: boolean
}

export interface SidebarConfig {
  version?: number
  groups: SidebarGroup[]
  hiddenItems: string[]
  pinnedItems: string[]
  groupOrder: string[]
  lastUpdated: number
}

export interface MenuItemData {
  titleKey: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  defaultHidden?: boolean
}

export interface DefaultMenus {
  [groupKey: string]: MenuItemData[]
}
