import { Suspense, useEffect } from 'react'
import type { PluginDefinition } from '@kite-dev/plugin-sdk'
import { PluginProvider } from '@kite-dev/plugin-sdk/navigation'
import { useTranslation } from 'react-i18next'
import {
  Link,
  matchRoutes,
  useLocation,
  useParams,
  useRoutes,
} from 'react-router-dom'

import { useCluster } from '@/hooks/use-cluster'
import { usePageTitle } from '@/hooks/use-page-title'
import { ErrorBoundary } from '@/components/error-boundary'

import { PluginNamespaceProvider } from './namespace-context'
import { usePlugins } from './plugin-context'
import { pluginLabel } from './sidebar'

function PluginRoutes({ module }: { module: PluginDefinition }) {
  const { t } = useTranslation()
  return useRoutes([
    ...module.routes.map((route) => ({
      path: route.path,
      element: route.element,
    })),
    { path: '*', element: <p>{t('plugins.notFound')}</p> },
  ])
}

export function PluginPage() {
  const { pluginId } = useParams()
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const { currentCluster } = useCluster()
  const { plugins, isLoading, loadPlugin } = usePlugins()
  const plugin = plugins.find((item) => item.manifest.id === pluginId)
  useEffect(() => {
    if (pluginId) loadPlugin(pluginId)
  }, [pluginId, plugin?.assetBaseUrl, plugin?.error, loadPlugin])
  const route = matchRoutes(
    (plugin && !plugin.invalid ? plugin.manifest.routes : []).map((route) => ({
      title: route.title,
      path: `/plugins/${pluginId}/${route.path}`,
    })),
    location
  )?.at(-1)?.route
  usePageTitle(
    route?.title
      ? pluginLabel(route.title, i18n.language)
      : (plugin?.manifest.name ?? t('plugins.title'))
  )
  let content
  if (isLoading || (plugin && !plugin.module && !plugin.error)) {
    content = null
  } else if (!plugin?.module) {
    content = (
      <div className="space-y-3">
        <p role="alert">
          {t(plugin?.error ? 'plugins.loadFailed' : 'plugins.unavailable')}
        </p>
        {plugin?.error && (
          <p className="text-sm text-muted-foreground break-words">
            {plugin.error}
          </p>
        )}
        <Link to="/" className="underline">
          {t('plugins.back')}
        </Link>
      </div>
    )
  } else {
    content = (
      <PluginProvider
        pluginId={plugin.manifest.id}
        routes={plugin.manifest.routes}
      >
        <PluginNamespaceProvider>
          <PluginRoutes module={plugin.module} />
        </PluginNamespaceProvider>
      </PluginProvider>
    )
  }

  return (
    <ErrorBoundary
      key={`${plugin?.assetBaseUrl ?? pluginId}:${currentCluster}`}
    >
      <Suspense fallback={null}>{content}</Suspense>
    </ErrorBoundary>
  )
}
