---
outline: deep
---

# API 客户端

`/api` 的 `apiClient` 提供 `get`、`post`、`put`、`patch`、`delete`、`request`，自动携带 Kite 认证、当前集群（通过 `x-cluster-name` 请求头）和部署基路径。

传入 API 相对路径：`apiClient.get('/pods/_all')` 实际请求部署路径下的 `/api/v1/pods/_all`，不要重复包含 `/api/v1`；也可以显式使用 `/_clusters/<cluster>/...` 路径。类型化方法返回解析后的数据，非成功响应直接 reject；`request` 返回原始 `Response`，由调用方自行检查状态。选项接受 `RequestInit` 字段和 `retryOnUnauthorized`（默认 `true`，即收到 401 时先尝试刷新会话）。

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
