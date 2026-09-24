---
outline: deep
---

# 资源查询与操作

从 `@kite-dev/plugin-sdk/resources` 导入查询和操作接口，用于读取、创建、修改和删除 Kubernetes 资源。查询默认跟随 Kite 当前选择的集群，所有请求都受当前用户的权限约束。

## 查询列表和详情

用 API group + 复数资源名标识资源，例如查询当前命名空间的 Deployment：

```tsx
import type { AppsV1 } from '@kite-dev/plugin-sdk/k8s'
import {
  useResources,
  type KubernetesResource,
  type ResourceReference,
} from '@kite-dev/plugin-sdk/resources'

export const deploymentRef = {
  group: 'apps',
  resource: 'deployments',
} satisfies ResourceReference

export type Deployment = AppsV1.Deployment & KubernetesResource

export function DeploymentCount() {
  const query = useResources<Deployment>(deploymentRef)

  if (query.isLoading) return <p>加载中…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  return <p>{query.data?.length ?? 0} 个 Deployment</p>
}
```

- `useResources<T>(ref, options?)` → `UseQueryResult<T[], Error>`
- `useResource<T>(ref, name, options?)` → `UseQueryResult<T, Error>`

两者默认使用当前集群和插件命名空间上下文，查询缓存键包含集群、资源目标和命名空间。

| 查询选项 | 作用 |
| -------- | ---- |
| `cluster` | 查询指定的可访问集群 |
| `namespace` | 覆盖插件命名空间 |
| `enabled` | 启用 / 禁用查询 |
| `staleTime` | 缓存新鲜期（毫秒） |
| `refreshInterval` | 轮询间隔（毫秒），默认不轮询 |

`ResourceListQueryOptions` 在公共的 `ResourceQueryOptions` 基础上增加 `labelSelector`、`fieldSelector`、`reduce`，只有 `useResources` 接受这些选项。详情、事件、Describe、历史和关联资源查询都不接受列表筛选参数。

命名空间传 `_all` 表示全部命名空间，也可以传逗号分隔的多个命名空间（Hook 会拆分成并行请求后合并结果）。单资源查询需要对象的真实命名空间。集群级（cluster-scoped）自定义资源需声明 `scope: 'Cluster'`；内置资源的 scope 由 Kite 自动识别。

## 读取扩展中的当前资源

在插件单元格组件和 Tab 内，可以通过 `@kite-dev/plugin-sdk/resources` 的 `useResourceContext<T>()` 读取宿主已经获取的资源，无需再请求一次：

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

## 自定义资源（CRD）

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

宿主按 CRD 中第一个 `served` 的版本读写自定义资源，因此插件不需要自己指定 API 版本。Hook 返回完整资源数组，不暴露服务端分页；需要周期更新时用 `refreshInterval` 轮询。

自定义资源与内置资源的能力差异：

| 能力 | 内置资源 | 自定义资源 |
| ---- | -------- | ---------- |
| 列表 `labelSelector` | 支持 | 支持 |
| 列表 `fieldSelector` | 支持 | 不支持，调用会抛错 |
| 列表 `reduce` | 支持 | 不支持 |
| 详情、Describe、历史 | 支持 | 支持 |
| 关联资源（`useRelatedResources`） | 部分内置资源支持 | 不支持，调用会抛错 |
| 创建（`createResource`） | 支持 | 支持 |
| 通用 PATCH | Strategic merge patch | JSON merge patch，数组会整体替换 |

## 创建、修改和删除

`/resources` 提供基于 Promise 的写操作：

| 函数 | 行为 |
| ---- | ---- |
| `applyResource(yaml, namespace?)` | 用 YAML 在当前集群创建或更新资源，返回 `ApplyResourceResponse` |
| `createResource<T>(ref, body, options?)` | 创建内置或自定义资源，返回创建后的对象；资源已存在时失败 |
| `updateResource<T>(ref, name, body, options?)` | 用完整对象替换内置或自定义资源，返回 `void` |
| `patchResource<T>(ref, name, body, options?)` | 用 `DeepPartial<T>` 局部更新内置或自定义资源，返回 `void` |
| `deleteResource(ref, name, options?)` | 删除内置或自定义资源，返回 `void` |

- 通用选项：`namespace`、`cluster`、`signal`；删除额外支持 `force` 和 `wait`。命名空间级资源的写操作必须给出真实命名空间。
- `applyResource` 走 Kite 的创建 / 更新流程；显式 `namespace` 会覆盖 YAML 中的命名空间，集群级资源忽略它。
- 写操作不会自动刷新查询，成功后请调用 `refetch()` 或用 TanStack Query 失效相关缓存。

例如，创建 Certificate 后修改它的目标 Secret：

```ts
import { createResource, patchResource } from '@kite-dev/plugin-sdk/resources'

const certificates = { group: 'cert-manager.io', resource: 'certificates' }
const options = { namespace: 'default' }

await createResource(certificates, {
  metadata: { name: 'example-tls' },
  spec: {
    secretName: 'example-tls',
    dnsNames: ['example.com'],
    issuerRef: { name: 'letsencrypt', kind: 'ClusterIssuer' },
  },
}, options)

await patchResource(certificates, 'example-tls', {
  spec: { secretName: 'example-tls-v2' },
}, options)
```

创建需要目标资源和命名空间的 `create` 权限，更新和 PATCH 需要 `update` 权限。Kite 会记录这些操作的资源历史。

## 事件与运维操作

以下接口也从 `@kite-dev/plugin-sdk/resources` 导入，未标 `?` 的参数都是必填：

| 领域 | 函数 |
| ---- | ---- |
| 事件与检视 | `useResourceEvents(ref, name, options?)`、`useDescribe(ref, name, options?)`、`useResourceHistory(ref, name, options?)`、`useRelatedResources(ref, name, options?)` |
| 工作负载 | `scaleDeployment(namespace, name, replicas)`、`restartWorkload(resource, name, namespace)`、`useWorkloadRevisions(resource, namespace, name, options?)`、`rollbackWorkload(resource, namespace, name, revision)` |
| 节点 | `drainNode(nodeName, options)`、`cordonNode(nodeName)`、`uncordonNode(nodeName)`、`taintNode(nodeName, taint)`、`untaintNode(nodeName, key)` |
| Pod 调试 | `resizePod(namespace, name, body)`、`debugPod(namespace, name, body)`、`copyDebugPod(namespace, name, body)` |
| Pod 文件 | `usePodFiles(namespace, podName, container, path, options?)`、`podDownloadFile(namespace, podName, container, path)`、`podPreviewFile(namespace, podName, container, path)`、`podUploadFile(namespace, podName, container, path, file)` |
| 配置辅助 | `useTemplates(options?)`、`useImageTags(image, options?)` |

补充说明：

- 检视类 Hook 接收资源引用、名称和查询选项；`useResourceHistory` 额外支持 `page` / `pageSize`，返回的是 Kite 记录的操作历史而非完整版本历史。
- `useRelatedResources` 的关系发现只覆盖部分内置资源；自定义资源的关系请用 `useResources` 自行按 `ownerReferences` 或字段匹配。
- `scaleDeployment` 只作用于 Deployment；`restartWorkload` 的 `resource` 可以是 `'deployments'` 或 `'statefulsets'`；`useWorkloadRevisions`、`rollbackWorkload` 的 `resource` 还支持 `'daemonsets'`。
- `drainNode` 的 `options` 为 `{ force, gracePeriod, deleteLocalData, ignoreDaemonsets }`；`taintNode` 的 `taint` 为 `{ key, value, effect }`，`effect` 取 `NoSchedule`、`PreferNoSchedule` 或 `NoExecute`。
- `resizePod` 接收 `Partial<Pod>`；`debugPod` 接收 `{ image, targetContainerName, command? }` 并创建临时调试容器；`copyDebugPod` 接收 `{ copyTo, targetContainerName, image?, command }` 并创建调试 Pod 副本。
- `podDownloadFile` 和 `podPreviewFile` 直接触发浏览器行为、没有返回值；`podUploadFile` 返回 Promise。

## Kubernetes 类型

`/k8s` 按 API group 和版本分组暴露 `kubernetes-types` 的类型（仅类型，没有运行时模块）：

```ts
import type { AppsV1, CoreV1, MetaV1 } from '@kite-dev/plugin-sdk/k8s'

type Deployment = AppsV1.Deployment
type Pod = CoreV1.Pod
type ObjectMeta = MetaV1.ObjectMeta
```

还包括 `AutoscalingV1`、`AutoscalingV2`、`NetworkingV1`、`RbacV1` 等分组。请使用 `import type`。CRD 类型自行定义接口，可扩展 `/resources` 的 `KubernetesResource`。

## 自定义 API 请求

使用 `@kite-dev/plugin-sdk/api` 的 `apiClient` 调用 Kite 的现有后端接口。客户端自动携带 Kite 认证、当前集群（`x-cluster-name` 请求头）和部署基路径。插件不能通过它注册新的后端接口。

自定义查询可以用 `apiClient` 搭配 TanStack Query 管理加载状态、错误和缓存。使用宿主共享的 `QueryClient`，不要创建新的实例：

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

查询键应包含插件标识、集群、命名空间和关键参数，避免不同查询共用缓存。写操作可配合 `useMutation`，成功后用 `useQueryClient` 失效相关查询。

| 方法 | 返回值与行为 |
| ---- | ------------ |
| `get<T>`、`post<T>`、`put<T>`、`patch<T>`、`delete<T>` | 返回解析后的数据，非成功响应会抛出错误 |
| `request` | 返回原始 `Response`，由调用方检查状态和读取响应 |

传入 API 相对路径：`apiClient.get('/pods/_all')` 会请求部署路径下的 `/api/v1/pods/_all`，不要重复包含 `/api/v1`。显式访问指定集群时使用 `/_clusters/<cluster>/...`。

选项接受 `RequestInit` 字段和 `retryOnUnauthorized`，后者默认 `true`，即收到 401 时先尝试刷新会话。
