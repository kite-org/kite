import { ReactNode } from 'react'
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom'

import {
  DesktopAIChatApp,
  DesktopApp,
  DesktopOverview,
  DesktopReady,
  DesktopWorkspaceApp,
  StandaloneAIChatApp,
  WebApp,
} from './App'
import { InitCheckRoute } from './components/init-check-route'
import { ProtectedRoute } from './components/protected-route'
import { getSubPath } from './lib/subpath'
import { CRListPage } from './pages/cr-list-page'
import { DesktopInitializationPage } from './pages/desktop-initialization'
import { HelmChartDetailPage } from './pages/helm-chart-detail-page'
import { HelmChartListPage } from './pages/helm-chart-list-page'
import { InitializationPage } from './pages/initialization'
import { LoginPage } from './pages/login'
import { Overview } from './pages/overview'
import { PluginManagementPage } from './pages/plugins'
import { ResourceDetail } from './pages/resource-detail'
import { ResourceList } from './pages/resource-list'
import { DesktopSettingsPage, SettingsPage } from './pages/settings'
import { PluginPage } from './plugins/plugin-page'

function resourceRoutes(
  overview: ReactNode,
  settings: ReactNode
): RouteObject[] {
  return [
    { index: true, element: overview },
    { path: 'dashboard', element: <Overview /> },
    { path: 'plugins', element: <PluginManagementPage /> },
    { path: 'plugins/:pluginId/*', element: <PluginPage /> },
    { path: 'settings', element: settings },
    { path: 'crds/:crd', element: <CRListPage /> },
    { path: 'charts', element: <HelmChartListPage /> },
    { path: 'charts/:repository/:name', element: <HelmChartDetailPage /> },
    { path: 'crds/:resource/:namespace/:name', element: <ResourceDetail /> },
    { path: 'crds/:resource/:name', element: <ResourceDetail /> },
    { path: ':resource/:name', element: <ResourceDetail /> },
    { path: ':resource', element: <ResourceList /> },
    { path: ':resource/:namespace/:name', element: <ResourceDetail /> },
  ]
}

export function createWebRouter() {
  return createBrowserRouter(
    [
      { path: '/setup', element: <InitializationPage /> },
      {
        path: '/login',
        element: (
          <InitCheckRoute allowIncompleteSetup>
            <LoginPage />
          </InitCheckRoute>
        ),
      },
      {
        path: '/ai-chat-box',
        element: (
          <InitCheckRoute>
            <ProtectedRoute>
              <StandaloneAIChatApp />
            </ProtectedRoute>
          </InitCheckRoute>
        ),
      },
      {
        path: '/',
        element: (
          <InitCheckRoute>
            <ProtectedRoute>
              <WebApp />
            </ProtectedRoute>
          </InitCheckRoute>
        ),
        children: resourceRoutes(<Overview />, <SettingsPage />),
      },
    ],
    { basename: getSubPath() }
  )
}

export function createDesktopRouter() {
  return createBrowserRouter(
    [
      {
        element: <DesktopReady />,
        children: [
          { path: '/setup', element: <DesktopInitializationPage /> },
          { path: '/login', element: <Navigate to="/" replace /> },
          { path: '/desktop/workspace', element: <DesktopWorkspaceApp /> },
          { path: '/ai-chat-box', element: <DesktopAIChatApp /> },
          {
            path: '/',
            element: <DesktopApp />,
            children: resourceRoutes(
              <DesktopOverview />,
              <DesktopSettingsPage />
            ),
          },
        ],
      },
    ],
    { basename: getSubPath() }
  )
}
