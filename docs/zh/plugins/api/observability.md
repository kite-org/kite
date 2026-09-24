---
outline: deep
---

# 指标与日志

从 `@kite-dev/plugin-sdk/observability` 查询集群概览、资源用量和 Pod 指标，或订阅 Pod 日志流。插件负责组织图表和日志界面，Kite 提供数据和当前集群的访问权限。

## 查询指标

例如显示当前集群中运行的 Pod 数量：

```tsx
import { useOverview } from '@kite-dev/plugin-sdk/observability'

export function RunningPods() {
  const query = useOverview()

  if (query.isLoading) return <p>加载中…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  return <p>运行中的 Pod：{query.data?.runningPods ?? 0}</p>
}
```

| Hook | 用途 | 选项 |
| ---- | ---- | ---- |
| `useOverview(options?)` | 集群资源数量和 CPU、内存分配概览，返回 `OverviewData` | `{ staleTime? }` |
| `useResourceUsageHistory(duration, options?)` | CPU、内存、网络和磁盘用量历史，返回 `ResourceUsageHistory` | `{ staleTime?, instance?, enabled? }` |
| `usePodMetrics(namespace, podName, duration, options?)` | Pod 或容器的指标历史，返回 `PodMetricsHistory` | `{ staleTime?, container?, refreshInterval?, labelSelector? }` |

这些 Hook 返回 TanStack Query 的查询结果，通过 `data` 读取上表中的数据，通过 `isLoading` 和 `error` 处理加载与错误状态。查询使用当前集群，缓存按集群隔离。

## PromQL 查询

在当前集群配置的 Prometheus 上执行任意 PromQL，可查询 GPU exporter、成本工具和服务网格等指标。

```tsx
import { usePrometheusQuery } from '@kite-dev/plugin-sdk/observability'

export function GPUUsage() {
  const query = usePrometheusQuery('avg by (gpu) (DCGM_FI_DEV_GPU_UTIL)', {
    refreshInterval: 30000,
  })

  if (query.isLoading) return <p>加载中…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (query.data?.resultType !== 'vector') return null
  return <pre>{JSON.stringify(query.data.result, null, 2)}</pre>
}
```

| API | 选项 | 返回值 |
| --- | ---- | ------ |
| `queryPrometheus(query, options?)` | `{ cluster?, time?, signal? }` | `Promise<PrometheusResult>` |
| `queryPrometheusRange(query, options)` | `{ cluster?, start, end, step, signal? }` | `Promise<PrometheusResult>` |
| `usePrometheusQuery(query, options?)` | 即时查询选项去掉 `signal`，加上查询控制选项 | `UseQueryResult<PrometheusResult, Error>` |
| `usePrometheusRangeQuery(query, options)` | 区间查询选项去掉 `signal`，加上查询控制选项 | `UseQueryResult<PrometheusResult, Error>` |

查询控制选项为 `enabled`、`staleTime` 和 `refreshInterval`（毫秒）。Hook 卸载时会取消请求，缓存按集群和查询条件隔离。`time`、`start`、`end` 为整数 Unix 时间戳，单位为秒；`step` 为 1～86,400 的整数，单位也是秒。即时查询默认使用当前时间，区间查询用于获取一段时间的采样序列：

```ts
import { queryPrometheusRange } from '@kite-dev/plugin-sdk/observability'

const end = Math.floor(Date.now() / 1000)
const data = await queryPrometheusRange(
  'sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))',
  { start: end - 3600, end, step: 60 }
)
```

`PrometheusResult` 包含 `resultType`、`result` 和可选的 `warnings`。先按 `resultType`（`vector`、`matrix`、`scalar` 或 `string`）区分结果，再读取 `result`。数值采样格式为 `[timestamp, value]`，其中 `value` 是字符串；vector 和 matrix 结果也支持原生直方图。

任意 PromQL 可以跨命名空间读取数据，因此必须有同一个 Kite 角色允许目标集群的 `prometheus/get`，且 `namespaces` 包含 `"*"`、没有命名空间排除规则。仅有某个命名空间的权限不能执行通用查询。例如：

```json
{
  "clusters": ["production"],
  "namespaces": ["*"],
  "resources": ["prometheus"],
  "verbs": ["get"]
}
```

无权限时返回 403，集群未配置可用 Prometheus 时返回 503。查询超时为 30 秒；每条序列超过 11,000 个采样间隔时需增大 `step`。认证由 Kite 处理，插件不会收到 Prometheus 凭据。

## 订阅 Pod 日志

`useLogsWebSocket(namespace, podName, options?)` 连接当前集群的 Pod 日志流。用 `onNewLog` 接收日志行，并自行控制保留数量；下面的示例最多保留 1,000 行：

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

日志选项包括 `enabled`、`container`、`tailLines`、`timestamps`、`previous`、`sinceSeconds`、`labelSelector`，以及 `onNewLog`、`onClear` 回调；返回值是 `{ isLoading, error, isConnected, downloadSpeed, refetch, stopStreaming, clearLogs }`。
