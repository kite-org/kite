---
outline: deep
---

# API 参考

`@kite-dev/plugin-sdk` 是插件与 Kite 之间唯一的接口边界。所有能力都通过以下入口点提供，插件不能直接 import Kite 的内部模块。

## 入口点总览

| 导入路径 | 用途 |
| -------- | ---- |
| `@kite-dev/plugin-sdk` | `definePlugin`、插件配置与 manifest 类型 |
| `@kite-dev/plugin-sdk/navigation` | 插件链接、资源链接、路由跳转、路由参数、插件上下文 |
| `@kite-dev/plugin-sdk/resources` | 资源查询 Hook、扩展资源上下文、写操作、工作负载 / 节点 / Pod 操作 |
| `@kite-dev/plugin-sdk/k8s` | Kubernetes 内置资源类型（仅类型导入） |
| `@kite-dev/plugin-sdk/hooks` | 集群、命名空间、用户、外观、收藏、终端等状态 |
| `@kite-dev/plugin-sdk/ui` | UI 基础组件、资源表格、详情页骨架、事件表、编辑器 |
| `@kite-dev/plugin-sdk/observability` | 集群概览、资源用量、Pod 指标、日志流 |
| `@kite-dev/plugin-sdk/api` | 认证的 Kite API 客户端 |
| `@kite-dev/plugin-sdk/i18n` | `createPluginI18n()`、类型化翻译键、当前语言 |
| `@kite-dev/plugin-sdk/vite` | `kitePlugin()` 构建配置 |
| `@kite-dev/plugin-sdk/validation` | manifest / 模块校验、宿主菜单分组 ID |

React、React Router、TanStack Query、react-i18next 以及 SDK 运行时通过 Module Federation 与 Kite 共享单例。插件内不要创建自己的 `QueryClient`，也不要引入独立的 React 根或 Router。

## 插件配置（definePlugin）

```tsx
export default definePlugin({
  i18n: translations,
  routes: [
    { id: 'deployments', path: '', title: label('nav.workloads'),
      element: <DeploymentsPage /> },
    { id: 'deployment', path: 'deployments/:namespace/:name',
      title: label('nav.deployment'), element: <DeploymentPage /> },
  ],
  menus: [
    { id: 'workloads', parent: 'core:workloads',
      label: label('nav.workloads'), route: 'deployments', icon: 'IconBox' },
  ],
})
```

### 路由

- `id`：路由 ID，插件内唯一，字母数字开头，可含字母、数字、下划线、连字符。
- `path`：相对 `/plugins/<插件 ID>` 的路径。空路径是插件首页；支持命名参数（`:name`）、可选参数和尾部 `*`。
- `title`：页面标题，支持本地化标签（见[国际化](./i18n)）。
- `element`：任意 React 节点，每个路由渲染一个完整页面。

| 路由 path | 实际 URL |
| --------- | -------- |
| `''` | `/plugins/my-plugin` |
| `deployments/:namespace/:name` | `/plugins/my-plugin/deployments/default/demo` |

`routes`、`menus`、`resources` 均可省略，`definePlugin` 会将省略的字段填充为空数组。它会从内联声明推断路由 ID 字面量类型并校验 `menus.route` 的取值。如果把路由数组提取为变量，需加 `as const` 保留字面量类型。

### 资源扩展

`resources` 中的每一项用 `group`（API 组）和 `resource`（复数资源名）定位一个资源类型，类型为 `PluginResourceView<T>`。核心 API 组使用空字符串，例如 Pod 是 `{ group: '', resource: 'pods' }`；StorageClass 是 `{ group: 'storage.k8s.io', resource: 'storageclasses' }`。

| 字段 | 类型 | 作用 |
| ---- | ---- | ---- |
| `group`、`resource` | `string` | 必填，组成唯一资源目标 |
| `columns` | `PluginResourceColumn<T>[]` | 向宿主列表追加列 |
| `tabs` | `PluginResourceTab[]` | 向宿主详情页追加 Tab |
| `list` | `ReactNode` | 接管自定义资源的完整列表页 |
| `detail` | `ReactNode` | 接管自定义资源的完整详情页 |

四种扩展至少提供一种，同一插件内不能重复声明相同的资源目标。`columns` / `tabs` 支持原生资源和通用 CR 页面；`list` / `detail` 仅接管自定义资源整页，不能替换原生资源整页。API 组按格式校验，不限制 `k8s.io` 等后缀。

#### 列表列

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

`PluginResourceColumn<T, TValue>` 从 SDK 根入口导入，`T` 是资源类型，`TValue` 是列值类型，默认 `unknown`。`label()` 来自插件的语言字典，见[国际化](./i18n)。

| 字段 | 说明 |
| ---- | ---- |
| `id`、`header` | 必填；ID 在该资源的列中唯一，标题支持本地化标签 |
| `accessorFn` / `accessorKey` | 读取用于显示、排序和搜索的值，两者互斥；`accessorKey` 支持 `metadata.labels.team` 等点路径 |
| `cell` | TanStack Table 单元格渲染接口，`row.original` 是当前资源；需要 Hook 时渲染独立的 React 组件 |
| `size`、`minSize`、`maxSize` | 列宽及范围 |
| `enableSorting`、`sortingFn` | 控制排序；无 accessor 的列不参与排序，`sortingFn` 可使用 TanStack 内置名称或自定义函数 |
| `sortDescFirst`、`sortUndefined`、`invertSorting` | 首次排序方向、空值位置和反向排序 |
| `enableHiding`、`defaultHidden` | 是否允许隐藏、是否默认隐藏；已有用户显隐偏好优先 |
| `order` | 插件列之间的默认顺序，默认 `0`；插件列追加在宿主列之后 |

显示插件列时，宿主列表和 SSE 请求完整资源；单元格可直接读取当前行，不需要再次请求同一资源。文本搜索会包含可见插件列的 accessor 值，标签选择器仍由后端处理。accessor 建议返回字符串、数字或布尔值。

#### 详情 Tab 与资源上下文

`PluginResourceTab` 从 SDK 根入口导入，包含必填的 `id`、`label`、`element` 和可选的 `order`。ID 在该资源的 Tab 中唯一，标签支持本地化，`element` 接受任意 React 节点。插件 Tab 追加在宿主 Tab 之后，`order` 默认 `0`，用户排序偏好优先。

在插件单元格组件和 Tab 内，通过 `/resources` 的 `useResourceContext<T>()` 读取宿主已经获取的资源：

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
| `reference` | `ResourceReference` | 当前资源的 API 组、复数名称与可用的作用域信息 |
| `onRefresh` | `() => Promise<unknown>` | 刷新宿主页面数据 |

该 Hook 仅用于单元格和 Tab 扩展，不在完整页面接管或独立路由中提供。查询关联资源时继续使用 `useResource` / `useResources`；它们默认继承当前集群和当前对象的命名空间，也可以通过选项覆盖。

#### 接管 CRD 列表和详情

`list`、`detail` 接收实际的 React 节点。省略其中一项时，对应页面仍使用 Kite 的通用视图。无需声明插件路由；菜单也可直接指向该 CRD：

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

完整页面自行通过资源 Hook 请求数据，详情页通过 `useParams()` 获取 `name` 和 `namespace`。菜单、CRD 浏览器和页面内链接使用同一套 CRD URL，见[资源页面导航](#资源页面导航)。插件也可以同时声明 `routes`，提供独立的总览等页面。

多个活动插件接管相同资源的同一种页面时，使用活动插件列表中的第一个匹配项。插件禁用、卸载、不兼容或模块加载失败时，Kite 使用通用资源视图；渲染错误由插件错误边界处理。

#### 加载与隔离

SDK 将资源目标、列和 Tab 的标题等元数据写入 `plugin.json`。宿主据此显示入口：列可见时加载对应插件模块，Tab 选中时加载内容，接管页面在访问时加载。React 组件仍可以使用 `lazy()` 分块加载。

宿主为扩展 ID 加插件前缀，例如 `plugin:my-plugin:column:team`、`plugin:my-plugin:tab:policy`。ID 不含版本号，升级时保留用户偏好；详情页可通过 `?tab=plugin:my-plugin:tab:policy` 选中对应 Tab。禁用或卸载后移除扩展，当前 Tab 不存在时切换到可用 Tab。

追加列和 Tab 的能力覆盖宿主使用资源表格与详情页组件的页面。插件自行渲染的 `ResourceTable`、`ResourceDetailShell` 不会自动插入其他插件的内容；`tabs` 用于组织插件自己的详情页内容和顺序。插件列或 Tab 的加载、渲染错误仅影响对应扩展区域。

### 菜单

- `id` 和 `label` 必填：ID 在插件菜单中唯一，格式与路由 ID 相同；标签支持本地化。
- `route` 指向一个无必填参数就能打开的插件路由；`resource: { group, resource }` 直接指向 CRD 列表，由 `resources` 中的页面定义接管，无需额外注册路由。两者互斥，都不带的菜单是分组标题。
- `parent` 决定菜单位置：

| `parent` 取值 | 位置 |
| ------------- | ---- |
| 省略 | 侧边栏顶级菜单或分组 |
| `core:workloads` 等 | Kite 内置分组内 |
| `my-plugin:tools` | 本插件 ID 为 `tools` 的分组内 |

内置分组常量：`core:application`、`core:workloads`、`core:traffic`、`core:storage`、`core:config`、`core:security`、`core:other`（可从 `/validation` 导入 `coreMenuGroupIds`）。

菜单父级只能是内置分组或同一插件声明的分组，不允许成环。`order` 设置默认排序（用户侧边栏偏好优先）；`icon` 接受宿主图标名（如 `IconBox`、`IconPackage`），未知名称回退默认图标。

::: warning
`plugin.config.tsx` 在构建时会在 Node.js 中执行一次以提取导航和资源扩展元数据，同一份文件也是浏览器入口。路由、菜单和资源扩展声明不能依赖浏览器全局或用户状态；页面和 Tab 组件请用 `React.lazy` 引入。
:::

## 导航

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
- `usePluginNavigate()`：返回 `navigate(routeId, params?, options?)`。
- `/navigation` 还导出 `useParams`、`useSearchParams`、`useLocation`、`Outlet`，用法与 react-router-dom 相同。
- `usePlugin()` 返回插件 ID 和路由表，可配合 `resolvePluginRoute(context, routeId, params?)` 手工生成 URL。

### 资源页面导航

`ResourceLink` 和 `resolveResourcePath` 从 `/navigation` 导入，用于 Kite 的自定义资源页面，不依赖插件路由：

```tsx
import { ResourceLink } from '@kite-dev/plugin-sdk/navigation'

const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

<ResourceLink resource={gateways}>全部 Gateways</ResourceLink>
<ResourceLink resource={gateways} name="demo" namespace="default">
  demo
</ResourceLink>
```

`ResourceLink` 接受 `resource: PluginResourceTarget`、可选的 `name` / `namespace`，以及常规 React Router Link 属性（除 `to`）。不传 `name` 打开列表；传 `name` 打开详情，命名空间级对象同时传 `namespace`。插件接管页面后仍使用原 URL：

| 页面 | URL |
| ---- | --- |
| 列表 | `/crds/gateways.gateway.networking.k8s.io` |
| 命名空间级详情 | `/crds/gateways.gateway.networking.k8s.io/default/demo` |
| 集群级详情 | `/crds/clusterissuers.cert-manager.io/demo` |

`resolveResourcePath(target, item?)` 返回同样的路径；`item` 为 `{ name, namespace? }`。参数自动编码，部署基路径由 Kite 的 Router 处理。事件回调中可配合 React Router 的 `useNavigate()` 跳转：

```tsx
import { resolveResourcePath, useParams } from '@kite-dev/plugin-sdk/navigation'
import { useNavigate } from 'react-router-dom'

const { name = '', namespace } = useParams<{ name: string; namespace: string }>()
const navigate = useNavigate()
const returnToList = () => navigate(resolveResourcePath(gateways))
```

## 资源查询

用 API group + 复数资源名标识资源：

```ts
import type { AppsV1 } from '@kite-dev/plugin-sdk/k8s'
import type { KubernetesResource, ResourceReference } from '@kite-dev/plugin-sdk/resources'

export const deploymentRef = {
  group: 'apps',
  resource: 'deployments',
} satisfies ResourceReference

export type Deployment = AppsV1.Deployment & KubernetesResource
```

- `useResources<T>(ref, options?)` → `UseQueryResult<T[], Error>`
- `useResource<T>(ref, name, options?)` → `UseQueryResult<T, Error>`

两者默认使用当前集群和插件命名空间上下文，查询缓存键包含集群与资源范围。

| 查询选项 | 作用 |
| -------- | ---- |
| `cluster` | 查询指定的可访问集群 |
| `namespace` | 覆盖插件命名空间 |
| `enabled` | 启用 / 禁用查询 |
| `staleTime` | 缓存新鲜期（毫秒） |
| `refreshInterval` | 轮询间隔（毫秒） |


`ResourceListQueryOptions` 在公共的 `ResourceQueryOptions` 基础上增加 `labelSelector`、`fieldSelector`、`reduce`，仅 `useResources` 接受这些选项；详情、事件、Describe、历史和关联资源查询不接受列表筛选参数。`fieldSelector`、`reduce` 用于内置资源列表。

命名空间传 `_all` 表示全部命名空间，也可以传逗号分隔的多命名空间选择。单资源查询需要对象的真实命名空间。集群级（cluster-scoped）自定义资源需声明 `scope: 'Cluster'`；Kite 内置资源的 scope 自动识别。

### 自定义资源（CRD）

CRD 使用同样的 Hook 和插件自定义的类型：

```tsx
interface Certificate extends KubernetesResource {
  spec: { secretName: string; dnsNames?: string[] }
}

const certificates = useResources<Certificate>(
  { group: 'cert-manager.io', resource: 'certificates' },
  { namespace: '_all' }
)
```

Kite 会自动选择 CRD 的 API 版本。自定义资源列表支持 `labelSelector`，不支持 `fieldSelector`。Hook 返回资源数组，不暴露服务端分页，需要周期更新时用 `refreshInterval` 轮询。

## 写操作与运维动作

`/resources` 入口提供基于 Promise 的写操作：

| 函数 | 行为 |
| ---- | ---- |
| `applyResource(yaml, namespace?)` | 用 YAML 在当前集群创建或更新资源 |
| `updateResource(ref, name, body, options?)` | 用完整对象替换内置或自定义资源 |
| `patchResource<T>(ref, name, body, options?)` | 对支持的内置资源提交 `DeepPartial<T>` |
| `deleteResource(ref, name, options?)` | 删除内置或自定义资源 |

- 通用选项：`namespace`、`cluster`、`signal`；删除额外支持 `force` 和 `wait`。命名空间资源的写操作必须给出真实命名空间。
- `applyResource` 走 Kite 的创建 / 更新流程；显式 `namespace` 会覆盖 YAML 中命名空间字段，集群级资源忽略它。自定义资源请用 `updateResource` 或 `applyResource`（CRD 不提供通用 PATCH 和 Server-Side Apply）。
- 写操作不会自动刷新查询，成功后请调用 `refetch()` 或用 TanStack Query 失效相关缓存。

其余操作按领域分组：

| 领域 | 函数 |
| ---- | ---- |
| 事件与检视 | `useResourceEvents`、`useDescribe`、`useResourceHistory`、`useRelatedResources` |
| 工作负载 | `scaleDeployment`、`restartWorkload`、`useWorkloadRevisions`、`rollbackWorkload` |
| 节点 | `drainNode`、`cordonNode`、`uncordonNode`、`taintNode`、`untaintNode` |
| Pod 调试 | `resizePod`、`debugPod`、`copyDebugPod` |
| Pod 文件 | `usePodFiles`、`podDownloadFile`、`podPreviewFile`、`podUploadFile` |
| 配置辅助 | `useTemplates`、`useImageTags` |

补充说明：

- 检视类 Hook 接收资源引用、名称和查询选项；`useResourceHistory` 额外支持 `page` / `pageSize`，返回的是 Kite 记录的操作历史而非全部历史版本。
- `useRelatedResources` 的关系发现仅覆盖部分内置资源，CRD 的关联关系请用 `useResources` 自行按 ownerReferences 或字段匹配。
- `scaleDeployment` 仅作用于 Deployment；`restartWorkload` 支持 Deployment 和 StatefulSet；版本查询与回滚还支持 DaemonSet。
- `debugPod` 创建临时调试容器，`copyDebugPod` 创建调试 Pod 副本。

## 资源 UI 组件

从 `/ui` 导入。所有资源组件都是可选的，你也可以只用 Hook 搭配自己的页面布局。

### WorkloadPodsCard

展示宿主的紧凑 Pod 卡片，包含状态、就绪容器数、重启次数、节点、IP 和运行时间。点击 Pod 名称可打开宿主的 Pod 详情弹窗。

```tsx
import { WorkloadPodsCard } from '@kite-dev/plugin-sdk/ui'

<WorkloadPodsCard
  title="Pods"
  pods={pods}
  isLoading={isLoading}
  loadingText="正在加载 Pod…"
  emptyText="暂无 Pod"
  ageLabel="运行时间"
/>
```

`pods` 接收 Kubernetes `Pod[]`。组件只展示传入的数据，通过资源 Hook 获取数据即可。上述展示文案均接收 `ReactNode`，可使用插件自己的翻译。

### ResourceTable

```tsx
import { useNamespace } from '@kite-dev/plugin-sdk/hooks'
import { PluginLink } from '@kite-dev/plugin-sdk/navigation'
import { useResources } from '@kite-dev/plugin-sdk/resources'
import { ResourceTable, type ColumnDef } from '@kite-dev/plugin-sdk/ui'

import { deploymentRef, type Deployment } from '../resources'

const columns: ColumnDef<Deployment, unknown>[] = [
  {
    id: 'name',
    header: 'Name',
    accessorFn: (item) => item.metadata.name,
    cell: ({ row }) => (
      <PluginLink
        route="deployment"
        params={{
          namespace: row.original.metadata.namespace!,
          name: row.original.metadata.name,
        }}
      >
        {row.original.metadata.name}
      </PluginLink>
    ),
  },
]

export default function DeploymentsPage() {
  const { namespace, setNamespace } = useNamespace()
  const query = useResources<Deployment>(deploymentRef, { namespace })

  return (
    <ResourceTable<Deployment>
      id="deployments"
      resourceName="Deployments"
      data={query.data}
      columns={columns}
      isLoading={query.isLoading}
      error={query.error}
      onRefresh={query.refetch}
      namespace={{ value: namespace, onChange: setNamespace }}
    />
  )
}
```

`ResourceTable` 内置搜索、排序、客户端分页、行数统计、列可见性和刷新控制。`id` 是插件内唯一的表格标识（搜索和列偏好按集群 + 表格持久化）；`resourceName` 是显示名。可选属性：`searchQueryFilter`、`defaultHiddenColumns`、`extraToolbars`、`emptyState`、`onCreateClick`；传入 `namespace: { value, onChange }` 显示命名空间选择器；同时传 `refreshInterval` 和 `onRefreshIntervalChange` 显示轮询间隔选择器（把同一间隔传给资源 Hook 即可控制轮询）。

### ResourceDetailShell

```tsx
import { useParams, usePluginNavigate } from '@kite-dev/plugin-sdk/navigation'
import { updateResource, useResource } from '@kite-dev/plugin-sdk/resources'
import {
  ResourceDetailShell,
  ResourceOverview,
  ResourceYaml,
} from '@kite-dev/plugin-sdk/ui'

import { deploymentRef, type Deployment } from '../resources'

export default function DeploymentPage() {
  const { namespace = '', name = '' } = useParams()
  const navigate = usePluginNavigate()
  const query = useResource<Deployment>(deploymentRef, name, { namespace })

  return (
    <ResourceDetailShell<Deployment>
      resource={deploymentRef}
      resourceLabel="Deployment"
      name={name}
      namespace={namespace}
      data={query.data}
      isLoading={query.isLoading}
      error={query.error}
      onRefresh={query.refetch}
      showDelete
      onDeleted={() => void navigate('deployments')}
      tabs={[
        {
          value: 'overview',
          label: 'Overview',
          content: ({ resource }) => (
            <ResourceOverview
              resource={deploymentRef}
              name={name}
              namespace={namespace}
              metadata={resource.metadata}
              fields={[
                { label: 'Desired replicas', value: resource.spec?.replicas ?? 0 },
              ]}
            />
          ),
        },
        {
          value: 'yaml',
          label: 'YAML',
          content: ({ resource, refreshKey }) => (
            <ResourceYaml
              key={refreshKey}
              value={resource}
              onSave={async (value) => {
                await updateResource(deploymentRef, name, value, { namespace })
                await query.refetch()
              }}
              fillHeight
            />
          ),
        },
      ]}
    />
  )
}
```

- `ResourceDetailShell` 提供加载 / 错误状态、资源页头、刷新和可选的资源操作。
- `tabs` 是唯一的 Tab 入口，每项为 `{ value, label, content }`，按数组顺序展示；`value` 在页面内唯一。Shell 不自动添加概览或 YAML Tab。用户仍可通过 Kite 的 Tab 控件调整顺序和可见性。
- `content` 可以是 React 节点，也可以是接收 `{ resource, refreshKey, onRefresh }` 的回调，`resource` 的类型从 `data` 推导。需要在手动刷新时重置子组件，可将 `refreshKey` 作为子组件的 `key`。
- `ResourceYaml<T>` 接收资源对象 `value`，独立管理 YAML 编辑、校验、保存和取消。`onSave` 接收解析后的对象并返回 Promise；保存失败时显示错误并保留草稿，不传则只读。支持 `title`、`actions` 定制页头，`className` 设置容器样式，`fillHeight` 填满 Tab。它也可以脱离 Shell 单独使用。
- 删除和克隆默认关闭，用 `showDelete`、`showClone` 开启；`onDeleted` 在删除后执行。`showDescribe` 控制 Describe 操作，`headerActions`、`titleIcon` 定制资源页头。
- `ResourceOverview` 在信息卡片中展示元数据和自定义字段。`children` 位于主栏的信息卡片下方，可放置 Pod 列表等资源专属内容；事件、相关资源、标签和注解位于侧栏。CRD 场景请自行提供 `relatedResources` 内容或传 `relatedResources={null}` 跳过内置关系查询。
- `ResourceEvents` 是独立的事件表，接收 `resource`、`name` 和可选 `namespace`。

### 基础组件与编辑器

`/ui` 入口包含 `Button`、`Badge`、`Input`、`Label`、`Card` 系列、`Dialog`、`Select`、`Tabs` 系列，以及：

```tsx
import { NamespaceSelector, YamlEditor } from '@kite-dev/plugin-sdk/ui'

<NamespaceSelector
  value={namespace}
  onChange={setNamespace}
  showAll={false}
  multiple={false}
/>

<YamlEditor value={yaml} onChange={(v) => setYaml(v ?? '')} height="400px" />
```

`YamlEditor` 的 `onChange` 接收 `string | undefined`，另支持 `disabled`；`NamespaceSelector` 另支持 `disabled`、`triggerClassName`、`modal`。

## 集群与应用 Hook

从 `/hooks` 导入：

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useCluster()` | `currentCluster` 与 `setCurrentCluster` |
| `useClusters(options?)` | 可访问集群的查询结果，默认启用 |
| `useNamespace()` | 插件命名空间选择与 `setNamespace` |
| `useAuth()` | `user`、`isLoading`、`capabilities`（含 `isAdmin()` 等辅助） |
| `useTheme()` | `theme`、`actualTheme`、`setTheme` |
| `useFavorites()` | 收藏及其增删改查 |
| `useTerminal()` | 打开 / 关闭 / 最小化全局终端面板 |
| `usePageTitle(title)` | 设置页面标题 |
| `useIsMobile()` | 是否移动端布局 |
| `useInterval(callback, delay)` | 定时执行回调 |
| `useVersionInfo()` | Kite 版本信息 |

`currentCluster` 在未选择集群时为 `null`。`ClusterInfo` 只含 `name`、`isDefault` 和可选的 `version`、`error`，不包含集群凭据。认证始终由 Kite 管理；`useTerminal` 控制的是全局终端面板，不创建 Pod 终端会话。

## Kubernetes 类型

`/k8s` 入口按 API group 和版本分组暴露 `kubernetes-types` 的类型（仅类型，无运行时模块）：

```ts
import type { AppsV1, CoreV1, MetaV1 } from '@kite-dev/plugin-sdk/k8s'

type Deployment = AppsV1.Deployment
type Pod = CoreV1.Pod
type ObjectMeta = MetaV1.ObjectMeta
```

包括 `AutoscalingV1`、`AutoscalingV2`、`NetworkingV1`、`RbacV1` 等。请使用 `import type`。CRD 类型自行定义接口，可扩展 `/resources` 的 `KubernetesResource`。

## 指标与日志

`/observability` 入口提供：

- `useOverview(options?)`：集群概览数据。
- `useResourceUsageHistory(duration, options?)`：资源用量历史。
- `usePodMetrics(namespace, podName, duration, options?)`：Pod 时序指标。
- `useLogsWebSocket(namespace, podName, options?)`：流式日志。

```tsx
import { useState } from 'react'
import { useLogsWebSocket } from '@kite-dev/plugin-sdk/observability'

export function PodLogs() {
  const [lines, setLines] = useState<string[]>([])
  const stream = useLogsWebSocket('default', 'demo', {
    container: 'app',
    tailLines: 100,
    onNewLog: (line) => setLines((prev) => [...prev.slice(-999), line]),
    onClear: () => setLines([]),
  })

  return (
    <>
      {stream.error && <p role="alert">{stream.error.message}</p>}
      <pre>{lines.join('\n')}</pre>
    </>
  )
}
```

这些 Hook 使用当前集群；指标查询按集群隔离缓存。日志流默认启用，选项包括 `enabled`、`container`、`tailLines`、`timestamps`、`previous`、`sinceSeconds`、`labelSelector`；结果包含加载与连接状态、错误、下载速度、`refetch`、`stopStreaming`、`clearLogs`。日志行数的保留策略由页面自行控制。

## 调用其他 Kite API

`/api` 的 `apiClient` 提供 `get`、`post`、`put`、`patch`、`delete`、`request`，自动携带 Kite 认证、当前集群和部署基路径。

传入 API 相对路径：`apiClient.get('/pods/_all')` 实际请求部署路径下的 `/api/v1/pods/_all`，不要重复包含 `/api/v1`。类型化方法返回解析后的数据、非成功响应直接 reject；`request` 返回原始 `Response` 由调用方检查状态。选项接受 `RequestInit` 字段和 `retryOnUnauthorized`。

自定义查询直接使用 `@tanstack/react-query` 的 `useQuery` / `useMutation` / `useQueryClient`，查询键中应包含插件标识、集群、命名空间和关键参数：

```tsx
import { apiClient } from '@kite-dev/plugin-sdk/api'
import { useCluster } from '@kite-dev/plugin-sdk/hooks'
import type { CoreV1 } from '@kite-dev/plugin-sdk/k8s'
import { useQuery } from '@tanstack/react-query'

export function usePluginPodList() {
  const { currentCluster } = useCluster()

  return useQuery({
    queryKey: ['my-plugin', 'pods', currentCluster, '_all'],
    enabled: !!currentCluster,
    queryFn: ({ signal }) =>
      apiClient.get<CoreV1.PodList>(
        `/_clusters/${encodeURIComponent(currentCluster!)}/pods/_all`,
        { signal }
      ),
  })
}
```

::: warning
前端插件不能注册后端 API，只能调用 Kite 既有的端点。
:::

## 校验 API

构建和打包命令会自动校验 manifest。工具链也可以从 `/validation` 导入：

- `validateManifest(input)`：校验元数据、版本、资产路径、路由、菜单和资源扩展声明。
- `validateNavigation(pluginId, input)`：校验路由、菜单、资源目标及列 / Tab 元数据，包括 ID 唯一性、菜单父子关系和本地化标签。
- `validateModule(manifest, input)`：校验模块与 manifest 的路由、菜单和资源扩展元数据一致，并检查路由 / Tab 的 `element` 及列 accessor、排序函数的契约。
- `coreMenuGroupIds`：宿主公开菜单分组列表。

各模块完整的参数、选项和响应类型见插件仓库 [`packages/plugin-sdk/src/`](https://github.com/kite-org/kite-plugins/tree/main/packages/plugin-sdk/src) 下的 TypeScript 声明。
