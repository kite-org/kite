import type { PluginDefinition } from '@kite-dev/plugin-sdk'
import { useTranslation } from 'react-i18next'
import {
  Link,
  matchRoutes,
  useLocation,
  useParams,
  useRoutes,
} from 'react-router-dom'

import { usePageTitle } from '@/hooks/use-page-title'

import { usePlugins } from './plugin-context'
import { PluginView } from './plugin-view'
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
  const { plugins } = usePlugins()
  const plugin = plugins.find((item) => item.manifest.id === pluginId)
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
  return (
    <PluginView
      plugin={plugin}
      fallback={
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
      }
    >
      {(module) => <PluginRoutes module={module} />}
    </PluginView>
  )
}
