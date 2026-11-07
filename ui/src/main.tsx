import { StrictMode } from 'react'
import { wcagContrast } from 'culori'
import { onPreferences, preferences, type ThemePreferences } from 'mygo-runtime'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import './index.css'
import './i18n'

import { AppearanceProvider } from './components/appearance-provider'
import { WebSessionRefresh } from './components/web-session-refresh'
import { AuthProvider } from './contexts/auth-context'
import { SidebarConfigProvider } from './contexts/sidebar-config-context'
import { disableAuthRefresh } from './lib/api-client'
import { isDesktop } from './lib/desktop'
import { QueryProvider } from './lib/query-provider'
import { PluginRuntime } from './plugins/plugin-runtime'
import { createDesktopRouter, createWebRouter } from './routes'

if (isDesktop) {
  disableAuthRefresh()
  const root = document.documentElement
  root.classList.add('desktop')
  const applyPreferences = (settings: ThemePreferences) => {
    root.toggleAttribute('data-reduce-motion', settings.reduceMotion)
    root.toggleAttribute(
      'data-reduce-transparency',
      settings.reduceTransparency
    )
    root.toggleAttribute('data-high-contrast', settings.highContrast)
    if (settings.accent) {
      root.style.setProperty(
        '--desktop-accent-foreground',
        wcagContrast(settings.accent, '#fff') >=
          wcagContrast(settings.accent, '#000')
          ? '#fff'
          : '#000'
      )
      root.setAttribute('data-system-accent', '')
    } else {
      root.removeAttribute('data-system-accent')
    }
  }
  applyPreferences(preferences())
  onPreferences(applyPreferences)
}
const router = isDesktop ? createDesktopRouter() : createWebRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <AuthProvider>
        {!isDesktop && <WebSessionRefresh />}
        <PluginRuntime>
          <AppearanceProvider
            defaultTheme="system"
            defaultColorTheme="clean-slate"
            defaultFont={isDesktop ? 'system' : 'maple'}
            defaultDisplayScale={isDesktop ? 90 : 95}
          >
            <SidebarConfigProvider>
              <RouterProvider router={router} />
            </SidebarConfigProvider>
          </AppearanceProvider>
        </PluginRuntime>
      </AuthProvider>
    </QueryProvider>
  </StrictMode>
)
