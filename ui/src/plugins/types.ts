import type { ComponentType, ReactElement } from 'react'

// KitePluginDescriptor is the frontend half of a kite-fork plugin. The
// `name` must match the backend plugin name reported by GET /api/v1/plugins;
// the sidebar entry is only rendered when the backend reports enabled=true
// for the current cluster.
export interface KitePluginDescriptor {
  name: string
  route: { path: string; element: ReactElement }
  sidebar: {
    titleKey: string
    icon: ComponentType<{ className?: string }>
    url: string
  }
}

export interface PluginStatus {
  name: string
  enabled: boolean
  extra?: Record<string, unknown>
}

export interface PluginsResponse {
  plugins: PluginStatus[]
}
