// kite-fork plugin registry: collects plugin descriptors and exposes the
// route/sidebar mount points consumed by routes.tsx and app-sidebar.tsx.
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, type RouteObject } from 'react-router-dom'

import { apiClient } from '@/lib/api-client'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

import { gpuPlugin } from './gpu'
import type { KitePluginDescriptor, PluginsResponse } from './types'

export const plugins: KitePluginDescriptor[] = [gpuPlugin]

export const pluginRoutes: RouteObject[] = plugins.map((p) => p.route)

export function usePluginsStatus() {
  // The 'plugins' queryKey is not in cluster-context's invalidation exclude
  // list, so switching clusters refetches and the sidebar follows.
  return useQuery<PluginsResponse>({
    queryKey: ['plugins'],
    queryFn: () => apiClient.get<PluginsResponse>('/plugins'),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function usePluginEnabled(name: string): boolean {
  const { data } = usePluginsStatus()
  return data?.plugins?.find((p) => p.name === name)?.enabled ?? false
}

export function PluginSidebarItems({
  onItemClick,
}: {
  onItemClick?: () => void
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const { data } = usePluginsStatus()

  const enabledPlugins = plugins.filter(
    (p) => data?.plugins?.find((s) => s.name === p.name)?.enabled
  )
  if (enabledPlugins.length === 0) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {enabledPlugins.map((p) => {
            const title = t(p.sidebar.titleKey, {
              defaultValue: p.sidebar.titleKey,
            })
            return (
              <SidebarMenuItem key={p.name}>
                <SidebarMenuButton
                  tooltip={title}
                  asChild
                  isActive={location.pathname.startsWith(p.sidebar.url)}
                >
                  <Link to={p.sidebar.url} onClick={onItemClick}>
                    <p.sidebar.icon className="text-sidebar-primary" />
                    <span>{title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
