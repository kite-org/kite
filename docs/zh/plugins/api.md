---
outline: deep
---

# API 参考

`@kite-dev/plugin-sdk` 是插件与 Kite 之间唯一的接口边界。所有能力都通过以下入口点提供，插件不能直接 import Kite 的内部模块。

## 入口点总览

| 导入路径 | 用途 |
| -------- | ---- |
| `@kite-dev/plugin-sdk` | `definePlugin`、插件配置与 manifest 类型 |
| `@kite-dev/plugin-sdk/navigation` | 插件链接、路由跳转、路由参数、插件上下文 |
| `@kite-dev/plugin-sdk/resources` | 资源查询 Hook、写操作、工作负载 / 节点 / Pod 操作 |
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

`definePlugin` 会从内联声明推断路由 ID 字面量类型并校验 `menus.route` 的取值。如果把路由数组提取为变量，需加 `as const` 保留字面量类型。

### 菜单

- 带 `route` 的菜单是链接，应指向一个无必填参数就能打开的路由；不带 `route` 的是分组标题。
- `parent` 决定菜单位置：

| `parent` 取值 | 位置 |
| ------------- | ---- |
| 省略 | 侧边栏顶级菜单或分组 |
| `core:workloads` 等 | Kite 内置分组内 |
| `my-plugin:tools` | 本插件 ID 为 `tools` 的分组内 |

内置分组常量：`core:application`、`core:workloads`、`core:traffic`、`core:storage`、`core:config`、`core:security`、`core:other`（可从 `/validation` 导入 `coreMenuGroupIds`）。

菜单父级只能是内置分组或同一插件声明的分组，不允许成环。`order` 设置默认排序（用户侧边栏偏好优先）；`icon` 接受宿主图标名（如 `IconBox`、`IconPackage`），未知名称回退默认图标。

::: warning
`plugin.config.tsx` 在构建时会在 Node.js 中执行一次以提取导航元数据，同一份文件也是浏览器入口。路由和菜单声明不能依赖浏览器全局或用户状态；页面组件请用 `React.lazy` 引入。
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
| `labelSelector` | 按标签筛选 |
| `fieldSelector`、`reduce` | 内置资源列表选项 |

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
import { ResourceDetailShell, ResourceOverview } from '@kite-dev/plugin-sdk/ui'

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
      onSaveYaml={async (value) => {
        await updateResource(deploymentRef, name, value, { namespace })
        await query.refetch()
      }}
      showDelete
      onDeleted={() => void navigate('deployments')}
      overview={({ resource }) => (
        <ResourceOverview
          resource={deploymentRef}
          name={name}
          namespace={namespace}
          metadata={resource.metadata}
          fields={[
            { label: 'Desired replicas', value: resource.spec?.replicas ?? 0 },
          ]}
        />
      )}
    />
  )
}
```

- `ResourceDetailShell` 提供加载 / 错误状态、概览 Tab、YAML Tab、刷新和可选的资源操作。
- `onSaveYaml` 接收解析后的资源对象（不是 YAML 字符串），不传则 YAML Tab 只读。
- 删除和克隆默认关闭，用 `showDelete`、`showClone` 开启；`onDeleted` 在删除后执行。
- `preYamlTabs` / `extraTabs` 添加自定义 Tab（`{ value, label, content }`）；`headerActions`、`titleIcon`、`yamlToolbar` 自定义周边控件。
- `ResourceOverview` 展示元数据、自定义字段、事件和宿主的相关资源卡片。CRD 场景请自行提供 `relatedResources` 内容或传 `relatedResources={null}` 跳过内置关系查询。
- `ResourceEvents` 是独立的事件表，接收 `resource`、`name` 和可选 `namespace`。

### 基础组件与编辑器

`/ui` 入口包含 `Button`、`Badge`、`Input`、`Label`、`Card` 系列、`Dialog`、`Select`、`Tabs` 系列，以及：

```tsx
import { NamespaceSelector, YamlEditor } from '@kite-dev/plugin-sdk/ui'

<NamespaceSelector
  selectedNamespace={namespace}
  handleNamespaceChange={setNamespace}
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

- `validateManifest(input)`：校验元数据、版本、资产路径、路由和菜单。
- `validateNavigation(pluginId, input)`：校验导航元数据。
- `validateModule(manifest, input)`：校验已加载的模块定义与 manifest 导航一致，且每个路由都有 `element`。
- `coreMenuGroupIds`：宿主公开菜单分组列表。

各模块完整的参数、选项和响应类型见 SDK 仓库 [`src/`](https://github.com/kite-org/plugin-sdk/tree/main/src) 下的 TypeScript 声明。
