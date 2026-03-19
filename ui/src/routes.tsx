import { createElement, lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { InitCheckRoute } from './components/init-check-route'
import { ProtectedRoute } from './components/protected-route'
import { getSubPath } from './lib/subpath'

const routeModules = import.meta.glob([
  './App.tsx',
  './pages/cr-list-page.tsx',
  './pages/initialization.tsx',
  './pages/login.tsx',
  './pages/overview.tsx',
  './pages/resource-detail.tsx',
  './pages/resource-list.tsx',
  './pages/settings.tsx',
])

function lazyRoute<T extends Record<string, ComponentType>>(
  path: string,
  exportName: keyof T
) {
  return lazy(async () => {
    const module = (await routeModules[path]()) as T
    return { default: module[exportName] }
  })
}

const appRoute = lazy(
  routeModules['./App.tsx'] as () => Promise<{ default: ComponentType }>
)
const crListPageRoute = lazyRoute<typeof import('./pages/cr-list-page')>(
  './pages/cr-list-page.tsx',
  'CRListPage'
)
const initializationPageRoute = lazyRoute<
  typeof import('./pages/initialization')
>('./pages/initialization.tsx', 'InitializationPage')
const loginPageRoute = lazyRoute<typeof import('./pages/login')>(
  './pages/login.tsx',
  'LoginPage'
)
const overviewRoute = lazyRoute<typeof import('./pages/overview')>(
  './pages/overview.tsx',
  'Overview'
)
const resourceDetailRoute = lazyRoute<typeof import('./pages/resource-detail')>(
  './pages/resource-detail.tsx',
  'ResourceDetail'
)
const resourceListRoute = lazyRoute<typeof import('./pages/resource-list')>(
  './pages/resource-list.tsx',
  'ResourceList'
)
const settingsPageRoute = lazyRoute<typeof import('./pages/settings')>(
  './pages/settings.tsx',
  'SettingsPage'
)

const subPath = getSubPath()

function withRouteSuspense(component: ComponentType) {
  return <Suspense>{createElement(component)}</Suspense>
}

export const router = createBrowserRouter(
  [
    {
      path: '/setup',
      element: withRouteSuspense(initializationPageRoute),
    },
    {
      path: '/login',
      element: (
        <InitCheckRoute>{withRouteSuspense(loginPageRoute)}</InitCheckRoute>
      ),
    },
    {
      path: '/',
      element: (
        <InitCheckRoute>
          <ProtectedRoute>{withRouteSuspense(appRoute)}</ProtectedRoute>
        </InitCheckRoute>
      ),
      children: [
        {
          index: true,
          element: withRouteSuspense(overviewRoute),
        },
        {
          path: 'dashboard',
          element: withRouteSuspense(overviewRoute),
        },
        {
          path: 'settings',
          element: withRouteSuspense(settingsPageRoute),
        },
        {
          path: 'crds/:crd',
          element: withRouteSuspense(crListPageRoute),
        },
        {
          path: 'crds/:resource/:namespace/:name',
          element: withRouteSuspense(resourceDetailRoute),
        },
        {
          path: 'crds/:resource/:name',
          element: withRouteSuspense(resourceDetailRoute),
        },
        {
          path: ':resource/:name',
          element: withRouteSuspense(resourceDetailRoute),
        },
        {
          path: ':resource',
          element: withRouteSuspense(resourceListRoute),
        },
        {
          path: ':resource/:namespace/:name',
          element: withRouteSuspense(resourceDetailRoute),
        },
      ],
    },
  ],
  {
    basename: subPath,
  }
)
