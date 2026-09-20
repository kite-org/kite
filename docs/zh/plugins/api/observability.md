---
outline: deep
---

# 可观测性

`/observability` 提供：

| Hook | 签名与选项 |
| ---- | ---------- |
| `useOverview` | `useOverview(options?)`，选项为 `{ staleTime? }` |
| `useResourceUsageHistory` | `useResourceUsageHistory(duration, options?)`，选项为 `{ staleTime?, instance?, enabled? }` |
| `usePodMetrics` | `usePodMetrics(namespace, podName, duration, options?)`，选项为 `{ staleTime?, container?, refreshInterval?, labelSelector? }` |
| `useLogsWebSocket` | `useLogsWebSocket(namespace, podName, options?)`，选项见下 |

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

日志选项包括 `enabled`、`container`、`tailLines`、`timestamps`、`previous`、`sinceSeconds`、`labelSelector`，以及 `onNewLog`、`onClear` 回调；返回值是 `{ isLoading, error, isConnected, downloadSpeed, refetch, stopStreaming, clearLogs }`。这些 Hook 使用当前集群，指标查询按集群隔离缓存；日志行数的保留策略由页面自行控制。
