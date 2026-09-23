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
