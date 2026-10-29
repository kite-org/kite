import { StrictMode } from 'react'
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

if (isDesktop) disableAuthRefresh()
const router = isDesktop ? createDesktopRouter() : createWebRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <AuthProvider>
        {!isDesktop && <WebSessionRefresh />}
        <PluginRuntime>
          <AppearanceProvider
            defaultTheme="system"
            defaultColorTheme="default"
            defaultFont="maple"
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
