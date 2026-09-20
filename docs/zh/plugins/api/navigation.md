---
outline: deep
---

# 导航

```tsx
import { PluginLink, usePluginNavigate } from '@kite-dev/plugin-sdk/navigation'
import { Button } from '@kite-dev/plugin-sdk/ui'

export function DeploymentActions() {
  const navigate = usePluginNavigate()

  return (
    <>
      <PluginLink route="deployment" params={{ namespace: 'default', name: 'demo' }}>
        打开详情
      </PluginLink>
      <Button onClick={() => navigate('deployments')}>全部 Deployments</Button>
    </>
  )
}
```

- `PluginLink`：接受常规 React Router Link 属性（除 `to`），外加 `route`、`params`、`search`、`hash`。参数自动编码并加上插件前缀。
- `usePluginNavigate()`：返回 `navigate(routeId, params?, options?)`，`options` 是 React Router 的 `NavigateOptions` 加上 `search`、`hash`。
- `/navigation` 还导出 `useParams`、`useSearchParams`、`useLocation`、`Outlet`，用法与 react-router-dom 相同。
- `usePlugin()` 返回当前插件的 `{ pluginId, routes }`，可配合 `resolvePluginRoute(context, routeId, params?)` 手工拼 URL。

## 资源页面导航

`ResourceLink` 和 `resolveResourcePath` 从 `/navigation` 导入，用于跳转 Kite 的自定义资源页面，不依赖插件路由：

```tsx
import { ResourceLink } from '@kite-dev/plugin-sdk/navigation'

const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

<ResourceLink resource={gateways}>全部 Gateways</ResourceLink>
<ResourceLink resource={gateways} name="demo" namespace="default">
  demo
</ResourceLink>
```

`ResourceLink` 接受 `resource: PluginResourceTarget`、可选的 `name` / `namespace`，以及常规 React Router Link 属性（除 `to`）。不传 `name` 打开列表，传 `name` 打开详情，命名空间级对象同时传 `namespace`。插件接管页面后 URL 保持不变：

| 页面 | URL |
| ---- | --- |
| 列表 | `/crds/gateways.gateway.networking.k8s.io` |
| 命名空间级详情 | `/crds/gateways.gateway.networking.k8s.io/default/demo` |
| 集群级详情 | `/crds/clusterissuers.cert-manager.io/demo` |

`resolveResourcePath(target, item?)` 返回同样的路径，`item` 为 `{ name, namespace? }`。参数自动编码，部署基路径由 Kite 的 Router 处理。事件回调中可以配合 React Router 的 `useNavigate()` 跳转：

```tsx
import { resolveResourcePath, useParams } from '@kite-dev/plugin-sdk/navigation'
import { useNavigate } from 'react-router-dom'

const { name = '', namespace } = useParams<{ name: string; namespace: string }>()
const navigate = useNavigate()
const returnToList = () => navigate(resolveResourcePath(gateways))
```
