---
outline: deep
---

# 资源

## 查询

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
| 通用 PATCH | 支持 | 不支持，请改用 `updateResource` 或 `applyResource` |

## 写操作与运维动作

`/resources` 提供基于 Promise 的写操作：

| 函数 | 行为 |
| ---- | ---- |
| `applyResource(yaml, namespace?)` | 用 YAML 在当前集群创建或更新资源，返回 `ApplyResourceResponse` |
| `updateResource<T>(ref, name, body, options?)` | 用完整对象替换内置或自定义资源，返回 `void` |
| `patchResource<T>(ref, name, body, options?)` | 提交 `DeepPartial<T>`，仅支持内置资源 |
| `deleteResource(ref, name, options?)` | 删除内置或自定义资源，返回 `void` |

- 通用选项：`namespace`、`cluster`、`signal`；删除额外支持 `force` 和 `wait`。命名空间级资源的写操作必须给出真实命名空间。
- `applyResource` 走 Kite 的创建 / 更新流程；显式 `namespace` 会覆盖 YAML 中的命名空间，集群级资源忽略它。
- 写操作不会自动刷新查询，成功后请调用 `refetch()` 或用 TanStack Query 失效相关缓存。

其余能力（未标 `?` 的参数都是必填）：

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
