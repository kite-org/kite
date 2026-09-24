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

## PromQL Queries

Use arbitrary PromQL against the current cluster's configured Prometheus, including metrics from GPU exporters, cost tools, and service meshes.

```tsx
import { usePrometheusQuery } from '@kite-dev/plugin-sdk/observability'

export function GPUUsage() {
  const query = usePrometheusQuery('avg by (gpu) (DCGM_FI_DEV_GPU_UTIL)', {
    refreshInterval: 30000,
  })

  if (query.isLoading) return <p>Loading…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (query.data?.resultType !== 'vector') return null
  return <pre>{JSON.stringify(query.data.result, null, 2)}</pre>
}
```

| API | Options | Result |
| --- | ------- | ------ |
| `queryPrometheus(query, options?)` | `{ cluster?, time? }` | `Promise<PrometheusResult>` |
| `queryPrometheusRange(query, options)` | `{ cluster?, start, end, step }` | `Promise<PrometheusResult>` |
| `usePrometheusQuery(query, options?)` | Instant query options, plus query controls | `UseQueryResult<PrometheusResult, Error>` |
| `usePrometheusRangeQuery(query, options)` | Range query options, plus query controls | `UseQueryResult<PrometheusResult, Error>` |

Query controls are `enabled`, `staleTime`, and `refreshInterval` (milliseconds). Hooks keep separate caches for each cluster and query. Times (`time`, `start`, `end`) are integer Unix timestamps in seconds; `step` is an integer from 1 to 86,400 seconds. Instant queries default to the current time. A range query retrieves a series of samples:

```ts
import { queryPrometheusRange } from '@kite-dev/plugin-sdk/observability'

const end = Math.floor(Date.now() / 1000)
const data = await queryPrometheusRange(
  'sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))',
  { start: end - 3600, end, step: 60 }
)
```

`PrometheusResult` contains `resultType`, `result`, and optional `warnings`. Narrow by `resultType` (`vector`, `matrix`, `scalar`, or `string`) before reading `result`. Numeric samples are `[timestamp, value]` pairs, where `value` is a string; vector and matrix results also support native histograms.

Arbitrary PromQL can read across namespaces. A matching Kite role must grant `get` on `prometheus` for the target cluster, with `namespaces: ["*"]` and no namespace exclusions. Namespace-scoped grants do not qualify. For example:

```json
{
  "clusters": ["production"],
  "namespaces": ["*"],
  "resources": ["prometheus"],
  "verbs": ["get"]
}
```

Kite returns 403 without this permission and 503 when Prometheus is unavailable. Queries time out after 30 seconds; increase `step` for ranges exceeding 11,000 intervals per series. Authentication stays with Kite; no Prometheus credentials are sent to the plugin.

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
