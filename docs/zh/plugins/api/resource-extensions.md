---
outline: deep
---

# 资源扩展

`resources` 中的每一项用 `group`（API 组）和 `resource`（复数资源名）定位一种资源，类型是 `PluginResourceView<T>`。核心 API 组用空字符串，例如 Pod 是 `{ group: '', resource: 'pods' }`，StorageClass 是 `{ group: 'storage.k8s.io', resource: 'storageclasses' }`；API 组按格式校验，不限制 `k8s.io` 这类后缀。

| 字段 | 类型 | 作用 |
| ---- | ---- | ---- |
| `group`、`resource` | `string` | 必填，共同组成唯一的资源目标 |
| `columns` | `PluginResourceColumn<T>[]` | 向宿主列表追加列 |
| `tabs` | `PluginResourceTab[]` | 向宿主详情页追加 Tab |
| `list` | `ReactNode` | 接管自定义资源的完整列表页 |
| `detail` | `ReactNode` | 接管自定义资源的完整详情页 |

四种扩展至少提供一种，且同一插件内不能重复声明相同的资源目标。宿主按需加载插件模块：列可见时加载，Tab 被选中时加载，接管页面在访问时加载。`columns`、`tabs` 对原生资源和通用 CR 页面都生效；`list`、`detail` 只接管自定义资源整页，不会替换原生资源页面。

## 列表列

```tsx
// plugin.config.tsx
import { lazy } from 'react'
import { definePlugin, type PluginResourceColumn } from '@kite-dev/plugin-sdk'
import type { CoreV1 } from '@kite-dev/plugin-sdk/k8s'

import { label, translations } from './src/i18n'

const PolicyTab = lazy(() => import('./src/tabs/policy'))

const podColumns = [
  {
    id: 'team',
    header: label('columns.team'),
    accessorFn: (pod) => pod.metadata?.labels?.team ?? '—',
    order: 10,
  },
] satisfies PluginResourceColumn<CoreV1.Pod>[]

export default definePlugin({
  i18n: translations,
  resources: [
    {
      group: '',
      resource: 'pods',
      columns: podColumns,
      tabs: [
        { id: 'policy', label: label('tabs.policy'), element: <PolicyTab /> },
      ],
    },
  ],
})
```

`PluginResourceColumn<T, TValue>` 从 SDK 根入口导入，`T` 是资源类型，`TValue` 是列值类型（默认 `unknown`）。

| 字段 | 说明 |
| ---- | ---- |
| `id`、`header` | 必填；ID 在该资源的列中唯一，标题支持本地化标签 |
| `accessorFn` / `accessorKey` | 读取用于显示、排序和搜索的值，两者互斥；`accessorKey` 支持 `metadata.labels.team` 这类点路径 |
| `cell` | TanStack Table 单元格渲染接口，`row.original` 是当前资源；需要 Hook 时渲染独立的 React 组件 |
| `size`、`minSize`、`maxSize` | 列宽及其范围 |
| `enableSorting`、`sortingFn` | 控制排序；有 accessor 的列默认参与排序，`sortingFn` 可用 TanStack 内置名称（`auto`、`text`、`alphanumeric`、`datetime` 等）或自定义函数 |
| `sortDescFirst`、`sortUndefined`、`invertSorting` | 首次排序方向、空值位置（默认排在最后）和反向排序 |
| `enableHiding`、`defaultHidden` | 是否允许隐藏、是否默认隐藏；已有用户显隐偏好优先 |
| `order` | 插件列之间的默认顺序，默认 `0`，相同取值按 ID 排序；插件列统一追加在宿主列之后 |

只要存在可见的插件列，宿主列表请求（包括开启 watch 时）就会拉取完整资源对象，因此单元格可以直接读取当前行，不需要再次请求同一资源。文本搜索会匹配当前可见列的取值（含插件列 accessor 的返回值），标签选择器仍由后端处理。accessor 建议返回字符串、数字或布尔值。

## 详情 Tab 与资源上下文

`PluginResourceTab` 从 SDK 根入口导入：

| 字段 | 说明 |
| ---- | ---- |
| `id` | 必填，在该资源的 Tab 中唯一 |
| `label` | 必填，本地化标签 |
| `element` | 必填，任意 React 节点 |
| `order` | 可选，默认 `0`，相同取值按 ID 排序 |

插件 Tab 追加在宿主 Tab 之后，用户排序与显隐偏好优先。在插件单元格组件和 Tab 内，可以通过 `/resources` 的 `useResourceContext<T>()` 读取宿主已经获取的资源：

```tsx
// src/tabs/policy.tsx
import type { CoreV1 } from '@kite-dev/plugin-sdk/k8s'
import { useResourceContext } from '@kite-dev/plugin-sdk/resources'
import { Button } from '@kite-dev/plugin-sdk/ui'

import { useTranslation } from '../i18n'

export default function PolicyTab() {
  const { resource, reference, onRefresh } = useResourceContext<CoreV1.Pod>()
  const { t } = useTranslation()

  return (
    <>
      <p>{reference.resource}: {resource.metadata?.name}</p>
      <Button onClick={() => void onRefresh()}>{t('actions.refresh')}</Button>
    </>
  )
}
```

返回类型是 `ResourceContext<T>`：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `resource` | `T` | 当前行或详情页的资源对象 |
| `reference` | `ResourceReference` | 当前资源的 API 组、复数名称与作用域信息 |
| `onRefresh` | `() => Promise<unknown>` | 刷新宿主页面数据 |

该 Hook 只在单元格和 Tab 扩展中提供。查询关联资源时继续使用 `useResource` / `useResources`：它们默认继承当前集群和当前对象的命名空间，也可以通过选项覆盖。

## 接管 CRD 列表和详情

`list`、`detail` 接收实际的 React 节点。只提供其中一项时，另一页仍使用 Kite 的通用视图。无需声明插件路由，菜单也可以直接指向该 CRD：

```tsx
// plugin.config.tsx
import { lazy } from 'react'
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

const GatewayList = lazy(() => import('./src/pages/gateway-list'))
const GatewayDetail = lazy(() => import('./src/pages/gateway-detail'))
const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

export default definePlugin({
  i18n: translations,
  menus: [
    {
      id: 'gateways',
      parent: 'core:traffic',
      label: label('navigation.gateways'),
      resource: gateways,
      icon: 'IconLoadBalancer',
    },
  ],
  resources: [
    { ...gateways, list: <GatewayList />, detail: <GatewayDetail /> },
  ],
})
```

接管页面自行通过资源 Hook 请求数据，详情页用 `useParams()` 读取 `name` 和 `namespace`。菜单、CRD 浏览器和页面内链接使用同一套 CRD URL，见[资源页面导航](./navigation#资源页面导航)。

## 扩展的标识与深链

宿主会给扩展 ID 加插件前缀，例如 `plugin:my-plugin:column:team`、`plugin:my-plugin:tab:policy`。这些 ID 不含版本号，因此升级插件不会丢失用户偏好；详情页可以用 `?tab=plugin:my-plugin:tab:policy` 直接选中该 Tab，值在页面上不存在时回退到第一个可见 Tab。

列和 Tab 扩展作用于使用宿主资源表格与详情页组件的页面；插件自己渲染的 `ResourceTable`、`ResourceDetailShell` 不会自动插入其他插件的内容。插件列或 Tab 的加载、渲染错误只影响对应的扩展区域。
