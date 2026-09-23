---
outline: deep
---

# Resource Queries and Operations

Import query and mutation APIs from `@kite-dev/plugin-sdk/resources` to read, create, update, and delete Kubernetes resources. Queries default to Kite's selected cluster, and all requests are subject to the current user's permissions.

## Querying Lists and Details

Identify resources by API group and plural resource name. For example, query Deployments in the current namespace:

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

  if (query.isLoading) return <p>Loading…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  return <p>{query.data?.length ?? 0} Deployments</p>
}
```

- `useResources<T>(ref, options?)` → `UseQueryResult<T[], Error>`
- `useResource<T>(ref, name, options?)` → `UseQueryResult<T, Error>`

Both default to the current cluster and the plugin's namespace context. Query cache keys include the cluster, resource target, and namespace.

| Query option | Purpose |
| ------------ | ------- |
| `cluster` | Query a specific accessible cluster |
| `namespace` | Override the plugin's namespace |
| `enabled` | Enable or disable the query |
| `staleTime` | How long cached data stays fresh, in milliseconds |
| `refreshInterval` | Polling interval in milliseconds; no polling by default |

`ResourceListQueryOptions` extends the shared `ResourceQueryOptions` with `labelSelector`, `fieldSelector`, and `reduce`. Only `useResources` accepts these options. Detail, event, Describe, history, and related resource queries do not accept list filters.

Use `_all` for all namespaces, or a comma-separated list of namespaces; the hook makes parallel requests and merges their results. Queries for a single resource need its actual namespace. Declare `scope: 'Cluster'` for cluster-scoped custom resources. Kite determines the scope of built-in resources automatically.

## Reading the Current Resource in an Extension

In plugin cell components and tabs, use `useResourceContext<T>()` from `@kite-dev/plugin-sdk/resources` to access the resource the host has already fetched:

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

The return type is `ResourceContext<T>`:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `resource` | `T` | The resource object for the current row or detail page |
| `reference` | `ResourceReference` | The resource's API group, plural name, and scope |
| `onRefresh` | `() => Promise<unknown>` | Refresh the host page's data |

This hook is available only inside cell and tab extensions. Use `useResource` or `useResources` to query related resources. They inherit the current cluster and the current object's namespace by default; options can override both.

## Custom Resources (CRDs)

Use the same hooks with types defined by your plugin:

```tsx
interface Certificate extends KubernetesResource {
  spec: { secretName: string; dnsNames?: string[] }
}

const certificates = useResources<Certificate>(
  { group: 'cert-manager.io', resource: 'certificates' },
  { namespace: '_all' }
)
```

Kite reads and writes custom resources using the first `served` version in the CRD, so plugins do not specify an API version. Hooks return complete resource arrays without exposing server-side pagination. Use `refreshInterval` for periodic updates.

Capabilities differ between built-in and custom resources:

| Capability | Built-in resources | Custom resources |
| ---------- | ------------------ | ---------------- |
| List `labelSelector` | Supported | Supported |
| List `fieldSelector` | Supported | Unsupported; throws an error |
| List `reduce` | Supported | Unsupported |
| Details, Describe, and history | Supported | Supported |
| Related resources (`useRelatedResources`) | Supported for some built-in resources | Unsupported; throws an error |
| Generic PATCH | Supported | Unsupported; use `updateResource` or `applyResource` |

## Creating, Updating, and Deleting

`/resources` provides Promise-based mutations:

| Function | Behavior |
| -------- | -------- |
| `applyResource(yaml, namespace?)` | Create or update resources from YAML in the current cluster; returns `ApplyResourceResponse` |
| `updateResource<T>(ref, name, body, options?)` | Replace a built-in or custom resource with a complete object; returns `void` |
| `patchResource<T>(ref, name, body, options?)` | Submit a `DeepPartial<T>`; supported only for built-in resources |
| `deleteResource(ref, name, options?)` | Delete a built-in or custom resource; returns `void` |

- Shared options are `namespace`, `cluster`, and `signal`. Deletion also supports `force` and `wait`. Mutations on namespaced resources must specify the actual namespace.
- `applyResource` uses Kite's create/update flow. An explicit `namespace` overrides the namespace in the YAML; cluster-scoped resources ignore it.
- Mutations do not refresh queries automatically. Call `refetch()` or invalidate the relevant TanStack Query caches after success.

## Events and Operational Actions

Import these APIs from `@kite-dev/plugin-sdk/resources`. Parameters without `?` are required:

| Area | Functions |
| ---- | --------- |
| Events and inspection | `useResourceEvents(ref, name, options?)`, `useDescribe(ref, name, options?)`, `useResourceHistory(ref, name, options?)`, `useRelatedResources(ref, name, options?)` |
| Workloads | `scaleDeployment(namespace, name, replicas)`, `restartWorkload(resource, name, namespace)`, `useWorkloadRevisions(resource, namespace, name, options?)`, `rollbackWorkload(resource, namespace, name, revision)` |
| Nodes | `drainNode(nodeName, options)`, `cordonNode(nodeName)`, `uncordonNode(nodeName)`, `taintNode(nodeName, taint)`, `untaintNode(nodeName, key)` |
| Pod debugging | `resizePod(namespace, name, body)`, `debugPod(namespace, name, body)`, `copyDebugPod(namespace, name, body)` |
| Pod files | `usePodFiles(namespace, podName, container, path, options?)`, `podDownloadFile(namespace, podName, container, path)`, `podPreviewFile(namespace, podName, container, path)`, `podUploadFile(namespace, podName, container, path, file)` |
| Configuration helpers | `useTemplates(options?)`, `useImageTags(image, options?)` |

- Inspection hooks accept a resource reference, name, and query options. `useResourceHistory` also supports `page` and `pageSize`. It returns Kite's operation history, not a complete resource revision history.
- `useRelatedResources` discovers relationships for only some built-in resources. For custom resources, query with `useResources` and match `ownerReferences` or other fields yourself.
- `scaleDeployment` applies only to Deployments. `restartWorkload` accepts `'deployments'` or `'statefulsets'` as `resource`; `useWorkloadRevisions` and `rollbackWorkload` also support `'daemonsets'`.
- `drainNode` accepts `{ force, gracePeriod, deleteLocalData, ignoreDaemonsets }` as `options`. `taintNode` accepts `{ key, value, effect }`, with `effect` set to `NoSchedule`, `PreferNoSchedule`, or `NoExecute`.
- `resizePod` accepts `Partial<Pod>`. `debugPod` accepts `{ image, targetContainerName, command? }` and creates an ephemeral debug container. `copyDebugPod` accepts `{ copyTo, targetContainerName, image?, command }` and creates a debug copy of the Pod.
- `podDownloadFile` and `podPreviewFile` trigger browser actions and return no value. `podUploadFile` returns a Promise.

## Kubernetes Types

`/k8s` exports `kubernetes-types` types grouped by API group and version. These are type-only exports with no runtime module:

```ts
import type { AppsV1, CoreV1, MetaV1 } from '@kite-dev/plugin-sdk/k8s'

type Deployment = AppsV1.Deployment
type Pod = CoreV1.Pod
type ObjectMeta = MetaV1.ObjectMeta
```

Other groups include `AutoscalingV1`, `AutoscalingV2`, `NetworkingV1`, and `RbacV1`. Use `import type`. Define your own CRD interfaces, optionally extending `KubernetesResource` from `/resources`.

## Custom API Requests

Use `apiClient` from `@kite-dev/plugin-sdk/api` to call Kite's existing backend APIs. The client handles Kite authentication, the current cluster (`x-cluster-name` header), and the deployment base path. It cannot register new backend APIs.

Combine `apiClient` with TanStack Query to manage loading, errors, and caching for custom queries. Use the host's shared `QueryClient` rather than creating another instance:

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

Include the plugin ID, cluster, namespace, and relevant parameters in query keys to avoid sharing caches between different queries. For mutations, use `useMutation` and invalidate related queries through `useQueryClient` after success.

| Method | Return value and behavior |
| ------ | ------------------------- |
| `get<T>`, `post<T>`, `put<T>`, `patch<T>`, `delete<T>` | Return parsed data; unsuccessful responses throw errors |
| `request` | Returns the raw `Response`; the caller checks its status and reads the body |

Pass paths relative to the API root: `apiClient.get('/pods/_all')` requests `/api/v1/pods/_all` under the deployment path. Do not repeat `/api/v1`. To target a specific cluster explicitly, use `/_clusters/<cluster>/...`.

Options accept `RequestInit` fields and `retryOnUnauthorized`. The latter defaults to `true`, meaning the client attempts to refresh the session after a 401 response.
