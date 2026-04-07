import type { ComponentType } from 'react'
import {
  IconArrowsHorizontal,
  IconBell,
  IconBox,
  IconBoxMultiple,
  IconClockHour4,
  IconCode,
  IconDatabase,
  IconFileDatabase,
  IconKey,
  IconLoadBalancer,
  IconLock,
  IconMap,
  IconNetwork,
  IconPlayerPlay,
  IconRocket,
  IconRoute,
  IconRouter,
  IconServer2,
  IconShield,
  IconShieldCheck,
  IconStack2,
  IconTopologyBus,
  IconUser,
  IconUsers,
  type Icon,
  type IconProps,
} from '@tabler/icons-react'

import {
  DefaultMenus,
  SidebarConfig,
  SidebarGroup,
  SidebarItem,
} from '@/types/sidebar'

const sidebarIconMap = {
  IconBox,
  IconRocket,
  IconStack2,
  IconTopologyBus,
  IconPlayerPlay,
  IconClockHour4,
  IconRouter,
  IconNetwork,
  IconLoadBalancer,
  IconRoute,
  IconFileDatabase,
  IconDatabase,
  IconMap,
  IconLock,
  IconUser,
  IconShield,
  IconUsers,
  IconShieldCheck,
  IconKey,
  IconBoxMultiple,
  IconServer2,
  IconBell,
  IconCode,
  IconArrowsHorizontal,
} as const

const defaultMenus: DefaultMenus = {
  'sidebar.groups.workloads': [
    { titleKey: 'nav.pods', url: '/pods', icon: IconBox },
    { titleKey: 'nav.deployments', url: '/deployments', icon: IconRocket },
    {
      titleKey: 'nav.statefulsets',
      url: '/statefulsets',
      icon: IconStack2,
    },
    {
      titleKey: 'nav.daemonsets',
      url: '/daemonsets',
      icon: IconTopologyBus,
    },
    { titleKey: 'nav.jobs', url: '/jobs', icon: IconPlayerPlay },
    { titleKey: 'nav.cronjobs', url: '/cronjobs', icon: IconClockHour4 },
  ],
  'sidebar.groups.traffic': [
    { titleKey: 'nav.ingresses', url: '/ingresses', icon: IconRouter },
    {
      titleKey: 'nav.networkpolicies',
      url: '/networkpolicies',
      icon: IconShield,
    },
    { titleKey: 'nav.services', url: '/services', icon: IconNetwork },
    { titleKey: 'nav.gateways', url: '/gateways', icon: IconLoadBalancer },
    { titleKey: 'nav.httproutes', url: '/httproutes', icon: IconRoute },
  ],
  'sidebar.groups.storage': [
    {
      titleKey: 'sidebar.short.pvcs',
      url: '/persistentvolumeclaims',
      icon: IconFileDatabase,
    },
    {
      titleKey: 'sidebar.short.pvs',
      url: '/persistentvolumes',
      icon: IconDatabase,
    },
    {
      titleKey: 'nav.storageclasses',
      url: '/storageclasses',
      icon: IconFileDatabase,
    },
  ],
  'sidebar.groups.config': [
    { titleKey: 'nav.configMaps', url: '/configmaps', icon: IconMap },
    { titleKey: 'nav.secrets', url: '/secrets', icon: IconLock },
    {
      titleKey: 'nav.horizontalpodautoscalers',
      url: '/horizontalpodautoscalers',
      icon: IconArrowsHorizontal,
    },
  ],
  'sidebar.groups.security': [
    {
      titleKey: 'nav.serviceaccounts',
      url: '/serviceaccounts',
      icon: IconUser,
    },
    { titleKey: 'nav.roles', url: '/roles', icon: IconShield },
    { titleKey: 'nav.rolebindings', url: '/rolebindings', icon: IconUsers },
    {
      titleKey: 'nav.clusterroles',
      url: '/clusterroles',
      icon: IconShieldCheck,
    },
    {
      titleKey: 'nav.clusterrolebindings',
      url: '/clusterrolebindings',
      icon: IconKey,
    },
  ],
  'sidebar.groups.other': [
    {
      titleKey: 'nav.namespaces',
      url: '/namespaces',
      icon: IconBoxMultiple,
    },
    { titleKey: 'nav.nodes', url: '/nodes', icon: IconServer2 },
    { titleKey: 'nav.events', url: '/events', icon: IconBell },
    { titleKey: 'nav.crds', url: '/crds', icon: IconCode },
  ],
}

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
