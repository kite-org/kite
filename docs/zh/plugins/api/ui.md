---
outline: deep
---

# UI 组件

从 `@kite-dev/plugin-sdk/ui` 导入组件，复用 Kite 的资源表格、详情页、YAML 编辑器和基础控件。组件负责展示与交互，资源数据通过[资源查询与操作](./resources)获取；也可以用这些接口搭配自己的布局。

## ResourceTable

用于构建资源列表页，内置搜索、排序、客户端分页和列显隐。传入查询结果和列定义即可：

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

| 属性 | 说明 |
| ---- | ---- |
| `id`、`resourceName`、`data`、`columns` | 必填；`id` 是插件内唯一的表格标识，`resourceName` 是显示名，数据由调用方通过资源 Hook 提供 |
| `isLoading`、`error`、`onRefresh` | 加载与错误状态、刷新回调 |
| `searchQueryFilter(item, query)` | 自定义搜索匹配；不传时按当前可见列的取值搜索 |
| `extraToolbars`、`emptyState`、`onCreateClick` | 额外工具栏、空状态、创建按钮回调 |
| `defaultHiddenColumns` | 默认隐藏的列 ID |
| `namespace` | `{ value, onChange }`，传入后显示命名空间选择器 |
| `refreshInterval`、`onRefreshIntervalChange` | 同时传入才显示轮询间隔选择器；把同一间隔传给资源 Hook 即可控制轮询 |

表格还提供行数统计和刷新控制。搜索与筛选状态按集群 + 表格保存在 `sessionStorage`，列可见性保存在 `localStorage`。

## ResourceDetailShell

用于构建资源详情页，提供页头、加载与错误状态、刷新和可选的资源操作。通过 `tabs` 自己组织概览、YAML 等内容：

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

| 属性 | 说明 |
| ---- | ---- |
| `resource`、`resourceLabel`、`name`、`data`、`isLoading`、`error`、`onRefresh`、`tabs` | 必填；`resource` 是资源引用，`data` 才是资源对象 |
| `namespace` | 命名空间级资源的命名空间 |
| `tabs` | 唯一的 Tab 定义入口，每项为 `{ value, label, content }`，按数组顺序展示，`value` 在页面内唯一；Shell 不会自动添加概览或 YAML Tab |
| `content` | React 节点，或接收 `{ resource, refreshKey, onRefresh }` 的回调；`resource` 的类型从 `data` 推导，需要随手动刷新重置子组件时可把 `refreshKey` 作为它的 `key` |
| `showDelete`、`showClone` | 默认关闭，开启后显示删除 / 克隆操作 |
| `showDescribe` | Describe 操作，默认开启 |
| `onDeleted` | 删除成功后的回调 |
| `headerActions`、`titleIcon`、`loadingMessage` | 自定义页头操作、标题图标和加载文案 |

用户可通过 Kite 的 Tab 控件调整插件 Tab 的顺序和可见性。

## ResourceOverview

在信息卡片中展示元数据和自定义字段（`fields`）。

`children` 位于主栏信息卡片下方，适合放 Pod 列表等资源专属内容；事件、相关资源、标签和注解位于侧栏。不传 `relatedResources` 时使用内置关系查询，传 `relatedResources={null}`（或自定义内容）可以跳过它。

## ResourceYaml

`ResourceYaml<T>` 接收资源对象 `value`，管理 YAML 编辑、校验、保存和取消，可嵌入详情页或单独使用。

| 属性 | 说明 |
| ---- | ---- |
| `value` | 要展示或编辑的资源对象 |
| `onSave` | 接收解析后的对象并返回 Promise；保存失败时显示错误并保留草稿，不传时只读 |
| `title`、`actions` | 定制页头 |
| `className` | 设置容器样式 |
| `fillHeight` | 填满 Tab 的可用高度 |

## ResourceEvents

独立事件表，接收 `resource`、`name` 和可选的 `namespace`：

```tsx
import { ResourceEvents } from '@kite-dev/plugin-sdk/ui'

<ResourceEvents
  resource={{ group: 'apps', resource: 'deployments' }}
  name="demo"
  namespace="default"
/>
```

## ResourceHistoryTable

展示 Kite 的操作历史，包含 YAML 差异比较和回滚操作，支持内置资源和自定义资源。传入 `currentResource` 可将历史记录与当前对象比较。

```tsx
import { ResourceHistoryTable } from '@kite-dev/plugin-sdk/ui'

<ResourceHistoryTable
  resource={{ group: 'cert-manager.io', resource: 'certificates' }}
  name="example-tls"
  namespace="default"
/>
```

## RelatedResourcesTable

展示关联资源及详情页链接，接收 `resource`、`name` 和可选的 `namespace`。支持范围与 `useRelatedResources` 一致，仅覆盖支持关系查询的内置资源；自定义资源的关系需要自行查询和展示。

```tsx
import { RelatedResourcesTable } from '@kite-dev/plugin-sdk/ui'

<RelatedResourcesTable
  resource={{ group: 'apps', resource: 'deployments' }}
  name="demo"
  namespace="default"
/>
```

## LogViewer

嵌入 Kite 的 Pod 日志查看器，支持容器选择、搜索、流式日志控制和下载。使用当前集群，并检查用户在目标命名空间的 `pods/log` 权限。

```tsx
import { LogViewer } from '@kite-dev/plugin-sdk/ui'

<LogViewer
  namespace="default"
  podName="demo"
  containers={pod.spec?.containers}
  initContainers={pod.spec?.initContainers}
  ephemeralContainers={pod.spec?.ephemeralContainers}
  selectedContainerName="app"
/>
```

`namespace` 必填。单 Pod 使用 `podName`，工作负载日志可传 `pods` 或 `labelSelector`；容器列表来自 Pod 的定义。`onClose` 提供关闭操作。查看器在渲染时按需加载。

## Terminal

嵌入 Kite 的 Pod、节点或 kubectl 终端。Pod exec 使用当前集群，并检查目标命名空间的 `pods/exec` 权限。

```tsx
import { Terminal } from '@kite-dev/plugin-sdk/ui'

<Terminal
  type="pod"
  namespace="default"
  podName="demo"
  containers={pod.spec?.containers}
  selectedContainerName="app"
/>
```

`type` 默认为 `pod`，需传 `namespace`、`podName` 和 Pod 的容器定义；`node` 需传 `nodeName`，kubectl 会话设置 `type="kubectl"`。`pods` 用于提供 Pod 选择列表，`containers`、`initContainers`、`ephemeralContainers`、`selectedContainerName` 用于容器选择。`attachContainerName` 用于附加到容器现有进程，而非新建 shell。`embedded` 隐藏工具栏并填满父容器，需要给父容器指定高度。仅在使用终端时挂载组件，关闭视图时卸载。

## Toast 通知

`toast` 使用 Kite 现有通知区域，插件无需额外挂载通知容器。

```ts
import { toast } from '@kite-dev/plugin-sdk/ui'

const id = toast.loading('保存中…')
toast.success('已保存', { id, description: '配置已更新。' })
toast.error('保存失败', { description: '请检查操作权限。' })
toast.dismiss(id)
```

支持 `toast(message, options?)`、`toast.success`、`toast.error`、`toast.info`、`toast.warning`、`toast.loading`。选项包括 `id`、`description`、以毫秒为单位的 `duration`、`dismissible`、`closeButton` 和 `action: { label, onClick }`。消息和标签支持 React 节点，可使用插件自身的翻译。`toast.dismiss(id)` 关闭指定通知，省略 ID 则关闭全部通知。

## WorkloadPodsCard

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

`title`、`pods`、`isLoading`、`loadingText`、`emptyText`、`ageLabel` 都是必填属性，`pods` 接收 Kubernetes `Pod[]`。组件只展示传入的数据，数据需要自己通过资源 Hook 获取；这些文案都接收 `ReactNode`，可以使用插件自己的翻译。

## 基础控件

- 基础组件：`Button`、`Badge`、`Input`、`Label`、`Card` 系列、`Dialog` 系列、`Select` 系列、`Tabs` 系列。
- `NamespaceSelector`：支持 `value`、`onChange`、`showAll`、`multiple`、`disabled`、`triggerClassName`、`modal`。
- `YamlEditor`：`value`、`onChange`（接收 `string | undefined`）、`disabled`、`height`。
