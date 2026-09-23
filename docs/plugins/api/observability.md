---
outline: deep
---

# Metrics and Logs

Use `@kite-dev/plugin-sdk/observability` to query the cluster overview, resource usage, and Pod metrics, or subscribe to Pod log streams. Plugins build the charts and log interfaces; Kite provides data using the current user's access to the current cluster.

## Querying Metrics

For example, display the number of running Pods in the current cluster:

```tsx
import { useOverview } from '@kite-dev/plugin-sdk/observability'

export function RunningPods() {
  const query = useOverview()

  if (query.isLoading) return <p>Loading…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  return <p>Running Pods: {query.data?.runningPods ?? 0}</p>
}
```

| Hook | Purpose | Options |
| ---- | ------- | ------- |
| `useOverview(options?)` | Resource counts and CPU and memory allocation for the cluster; returns `OverviewData` | `{ staleTime? }` |
| `useResourceUsageHistory(duration, options?)` | CPU, memory, network, and disk usage history; returns `ResourceUsageHistory` | `{ staleTime?, instance?, enabled? }` |
| `usePodMetrics(namespace, podName, duration, options?)` | Pod or container metrics history; returns `PodMetricsHistory` | `{ staleTime?, container?, refreshInterval?, labelSelector? }` |

These hooks return TanStack Query results. Read the values listed above through `data`, and handle loading and errors through `isLoading` and `error`. Queries use the current cluster, with separate caches for each cluster.

## Subscribing to Pod Logs

`useLogsWebSocket(namespace, podName, options?)` connects to a Pod log stream in the current cluster. Receive lines through `onNewLog` and control how many to keep. This example retains up to 1,000 lines:

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

Options include `enabled`, `container`, `tailLines`, `timestamps`, `previous`, `sinceSeconds`, and `labelSelector`, plus the `onNewLog` and `onClear` callbacks. The result is `{ isLoading, error, isConnected, downloadSpeed, refetch, stopStreaming, clearLogs }`.
