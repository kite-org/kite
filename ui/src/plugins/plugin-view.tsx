import { Suspense, useContext, useEffect, type ReactNode } from 'react'
import type { PluginDefinition } from '@kite-dev/plugin-sdk'
import { PluginProvider } from '@kite-dev/plugin-sdk/navigation'
import { useLocation } from 'react-router-dom'

import { useCluster } from '@/hooks/use-cluster'
import { ErrorBoundary } from '@/components/error-boundary'

import {
  PluginNamespaceContext,
  PluginNamespaceProvider,
} from './namespace-context'
import { usePlugins, type LoadedPlugin } from './plugin-context'

interface PluginViewProps {
  plugin?: LoadedPlugin
  fallback: ReactNode
  errorFallback?: ReactNode
  children: (module: PluginDefinition) => ReactNode
}

export function PluginView(props: PluginViewProps) {
  const { plugin } = props
  const { isLoading, loadPlugin } = usePlugins()
  const id = plugin?.manifest.id

  useEffect(() => {
    if (id) loadPlugin(id)
  }, [id, plugin?.assetBaseUrl, plugin?.error, loadPlugin])

  if (isLoading) return null
  return <PluginContent {...props} />
}

export function PluginContent({
  plugin,
  fallback,
  errorFallback,
  children,
}: PluginViewProps) {
  const { currentCluster } = useCluster()
  const { pathname } = useLocation()
  if (!plugin || plugin.error) return fallback
  if (!plugin.module) return null

  return (
    <ErrorBoundary
      key={`${plugin.assetBaseUrl}:${currentCluster}:${pathname}`}
      fallback={errorFallback}
    >
      <Suspense fallback={null}>
        <PluginProvider
          pluginId={plugin.manifest.id}
          routes={plugin.manifest.routes}
        >
          <PluginRender module={plugin.module}>{children}</PluginRender>
        </PluginProvider>
      </Suspense>
    </ErrorBoundary>
  )
}

function PluginRender({
  module,
  children,
}: {
  module: PluginDefinition
  children: (module: PluginDefinition) => ReactNode
}) {
  const namespace = useContext(PluginNamespaceContext)
  const content = children(module)
  return namespace ? (
    content
  ) : (
    <PluginNamespaceProvider>{content}</PluginNamespaceProvider>
  )
}
