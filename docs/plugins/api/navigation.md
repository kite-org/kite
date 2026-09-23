---
outline: deep
---

# Page Navigation

Import link components and routing utilities from `@kite-dev/plugin-sdk/navigation` to navigate between plugin pages, open custom resource pages, or read URL parameters. Declare sidebar menus and routes in [Plugin Configuration](./plugin-config).

## Opening Plugin Pages

Use `PluginLink` to render links and `usePluginNavigate()` to navigate from event handlers. The `deployment` and `deployments` values below are route IDs declared in `plugin.config.tsx`:

```tsx
import { PluginLink, usePluginNavigate } from '@kite-dev/plugin-sdk/navigation'
import { Button } from '@kite-dev/plugin-sdk/ui'

export function DeploymentActions() {
  const navigate = usePluginNavigate()

  return (
    <>
      <PluginLink route="deployment" params={{ namespace: 'default', name: 'demo' }}>
        Open details
      </PluginLink>
      <Button onClick={() => navigate('deployments')}>All Deployments</Button>
    </>
  )
}
```

- `PluginLink` accepts standard React Router Link props except `to`, plus `route`, `params`, `search`, and `hash`. Parameters are encoded automatically, and paths include the plugin prefix.
- `usePluginNavigate()` returns `navigate(routeId, params?, options?)`. `options` extends React Router's `NavigateOptions` with `search` and `hash`.
- `usePlugin()` returns `{ pluginId, routes }` for the current plugin. Use it with `resolvePluginRoute(context, routeId, params?)` to construct a URL.

## Opening Resource Pages

Import `ResourceLink` and `resolveResourcePath` from `/navigation` to open Kite's custom resource pages without declaring plugin routes:

```tsx
import { ResourceLink } from '@kite-dev/plugin-sdk/navigation'

const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

<ResourceLink resource={gateways}>All Gateways</ResourceLink>
<ResourceLink resource={gateways} name="demo" namespace="default">
  demo
</ResourceLink>
```

`ResourceLink` accepts `resource: PluginResourceTarget`, optional `name` and `namespace`, and standard React Router Link props except `to`. Omit `name` to open the list, or provide it to open a detail page. Include `namespace` for namespaced objects. URLs remain unchanged when a plugin provides the page:

| Page | URL |
| ---- | --- |
| List | `/crds/gateways.gateway.networking.k8s.io` |
| Namespaced detail | `/crds/gateways.gateway.networking.k8s.io/default/demo` |
| Cluster-scoped detail | `/crds/clusterissuers.cert-manager.io/demo` |

`resolveResourcePath(target, item?)` returns the same paths, with `item` shaped as `{ name, namespace? }`. Parameters are encoded automatically, and Kite's Router handles the deployment base path. Use React Router's `useNavigate()` in an event handler:

```tsx
import { resolveResourcePath } from '@kite-dev/plugin-sdk/navigation'
import { useNavigate } from 'react-router-dom'

const navigate = useNavigate()
const returnToList = () => navigate(resolveResourcePath(gateways))
```

## Reading Route Parameters

`useParams` reads path parameters, `useSearchParams` reads and writes query parameters, and `useLocation` reads the current URL information. They work as they do in React Router. For example, read the name, namespace, and selected tab on a resource detail page:

```tsx
import { useParams, useSearchParams } from '@kite-dev/plugin-sdk/navigation'

const { name = '', namespace } = useParams<{ name: string; namespace: string }>()
const [searchParams] = useSearchParams()
const tab = searchParams.get('tab')
```

The module also exports React Router's `Outlet` component for nested route layouts.
