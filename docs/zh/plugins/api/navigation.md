---
outline: deep
---

# 页面跳转

从 `@kite-dev/plugin-sdk/navigation` 导入链接组件和路由工具，用于在插件页面之间跳转、打开 CRD 页面或读取 URL 参数。侧边栏菜单和路由的声明见[插件配置](./plugin-config)。

## 打开插件页面

用 `PluginLink` 渲染链接，用 `usePluginNavigate()` 在事件回调中跳转。下面的 `deployment` 和 `deployments` 对应 `plugin.config.tsx` 中声明的路由 ID：

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
- `usePlugin()` 返回当前插件的 `{ pluginId, routes }`，可配合 `resolvePluginRoute(context, routeId, params?)` 手工拼 URL。

## 打开资源页面

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
import { resolveResourcePath } from '@kite-dev/plugin-sdk/navigation'
import { useNavigate } from 'react-router-dom'

const navigate = useNavigate()
const returnToList = () => navigate(resolveResourcePath(gateways))
```

## 读取路由参数

`useParams` 读取路径参数，`useSearchParams` 读写查询参数，`useLocation` 读取当前 URL 信息，用法与 React Router 相同。例如在资源详情页读取名称、命名空间和当前 Tab：

```tsx
import { useParams, useSearchParams } from '@kite-dev/plugin-sdk/navigation'

const { name = '', namespace } = useParams<{ name: string; namespace: string }>()
const [searchParams] = useSearchParams()
const tab = searchParams.get('tab')
```

需要嵌套路由布局时，同一模块还提供 React Router 的 `Outlet` 组件。
