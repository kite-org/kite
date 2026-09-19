---
outline: deep
---

# API Reference

`@kite-dev/plugin-sdk` is the sole interface between plugins and Kite. All capabilities are exposed through the entry points below. Plugins must not import Kite's internal modules directly.

## Entry Points

| Import Path | Purpose |
| ----------- | ------- |
| `@kite-dev/plugin-sdk` | `definePlugin`, plugin configuration, and manifest types |
| `@kite-dev/plugin-sdk/navigation` | Plugin links, resource links, navigation, route parameters, and plugin context |
| `@kite-dev/plugin-sdk/resources` | Resource query hooks, resource extension context, mutations, and workload, node, and Pod operations |
| `@kite-dev/plugin-sdk/k8s` | Built-in Kubernetes resource types (type-only imports) |
| `@kite-dev/plugin-sdk/hooks` | Cluster, namespace, user, appearance, favorites, terminal, and other state |
| `@kite-dev/plugin-sdk/ui` | UI primitives, resource tables, detail page shells, event tables, and editors |
| `@kite-dev/plugin-sdk/observability` | Cluster overview, resource usage, Pod metrics, and log streams |
| `@kite-dev/plugin-sdk/api` | Authenticated Kite API client |
| `@kite-dev/plugin-sdk/i18n` | `createPluginI18n()`, typed translation keys, and the current language |
| `@kite-dev/plugin-sdk/vite` | `kitePlugin()` build configuration |
| `@kite-dev/plugin-sdk/validation` | Manifest and module validation, and host menu group IDs |

React, React Router, TanStack Query, react-i18next, and the SDK runtime are shared with Kite as singletons through Module Federation. Do not create your own `QueryClient`, a separate React root, or a Router inside a plugin.

## Plugin Configuration (definePlugin)

```tsx
export default definePlugin({
  i18n: translations,
  routes: [
    { id: 'deployments', path: '', title: label('nav.workloads'),
      element: <DeploymentsPage /> },
    { id: 'deployment', path: 'deployments/:namespace/:name',
      title: label('nav.deployment'), element: <DeploymentPage /> },
  ],
  menus: [
    { id: 'workloads', parent: 'core:workloads',
      label: label('nav.workloads'), route: 'deployments', icon: 'IconBox' },
  ],
})
```

### Routes

- `id`: a route ID unique within the plugin. It must start with a letter or digit and may contain letters, digits, underscores, and hyphens.
- `path`: a path relative to `/plugins/<plugin ID>`. An empty path is the plugin's home page. Named parameters (`:name`), optional parameters, and a trailing `*` are supported.
- `title`: the page title. Localized labels are supported; see [Internationalization](./i18n).
- `element`: any React node. Each route renders a complete page.

| Route Path | Actual URL |
| ---------- | ---------- |
| `''` | `/plugins/my-plugin` |
| `deployments/:namespace/:name` | `/plugins/my-plugin/deployments/default/demo` |

`routes`, `menus`, and `resources` are all optional. `definePlugin` fills omitted fields with empty arrays. It infers route ID literal types from inline declarations and validates `menus.route` values. If you extract the route array into a variable, use `as const` to preserve its literal types.

### Resource Extensions

Each entry in `resources` identifies a resource type by `group` (API group) and `resource` (plural resource name), using the `PluginResourceView<T>` type. Use an empty string for the core API group: a Pod is `{ group: '', resource: 'pods' }`, and a StorageClass is `{ group: 'storage.k8s.io', resource: 'storageclasses' }`.

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `group`, `resource` | `string` | Required; together they identify a unique resource target |
| `columns` | `PluginResourceColumn<T>[]` | Append columns to the host's list |
| `tabs` | `PluginResourceTab[]` | Append tabs to the host's detail page |
| `list` | `ReactNode` | Replace the entire list page for a custom resource |
| `detail` | `ReactNode` | Replace the entire detail page for a custom resource |

Provide at least one of these four extensions. A plugin cannot declare the same resource target more than once. `columns` and `tabs` support native resource pages and generic custom resource pages. `list` and `detail` can only replace custom resource pages, not native resource pages. API groups are validated for format, without restricting suffixes such as `k8s.io`.

#### List Columns

```tsx
// plugin.config.tsx
import { lazy } from 'react'
import { definePlugin, type PluginResourceColumn } from '@kite-dev/plugin-sdk'
import type { CoreV1 } from '@kite-dev/plugin-sdk/k8s'

import { label, translations } from './src/i18n'

const PolicyTab = lazy(() => import('./src/tabs/policy'))

const podColumns = [
  {
    id: 'team',
    header: label('columns.team'),
    accessorFn: (pod) => pod.metadata?.labels?.team ?? '—',
    order: 10,
  },
] satisfies PluginResourceColumn<CoreV1.Pod>[]

export default definePlugin({
  i18n: translations,
  resources: [
    {
      group: '',
      resource: 'pods',
      columns: podColumns,
      tabs: [
        { id: 'policy', label: label('tabs.policy'), element: <PolicyTab /> },
      ],
    },
  ],
})
```

Import `PluginResourceColumn<T, TValue>` from the SDK's root entry point. `T` is the resource type, and `TValue` is the column value type, which defaults to `unknown`. `label()` comes from the plugin's translation dictionary; see [Internationalization](./i18n).

| Field | Description |
| ----- | ----------- |
| `id`, `header` | Required. The ID must be unique among the columns for this resource. The header supports localized labels |
| `accessorFn` / `accessorKey` | Read the value used for display, sorting, and search. These options are mutually exclusive. `accessorKey` supports dot paths such as `metadata.labels.team` |
| `cell` | TanStack Table's cell rendering interface. `row.original` is the current resource. Render a separate React component when you need hooks |
| `size`, `minSize`, `maxSize` | Column width and its limits |
| `enableSorting`, `sortingFn` | Control sorting. Columns without an accessor cannot be sorted. `sortingFn` accepts a built-in TanStack name or a custom function |
| `sortDescFirst`, `sortUndefined`, `invertSorting` | Initial sort direction, placement of undefined values, and inverted sorting |
| `enableHiding`, `defaultHidden` | Whether the column can be hidden and whether it is hidden by default. Existing user visibility preferences take precedence |
| `order` | Default order among plugin columns; defaults to `0`. Plugin columns are appended after host columns |

When plugin columns are visible, the host's list and SSE requests fetch complete resources. Cells can read the current row directly without fetching the same resource again. Text search includes accessor values from visible plugin columns; label selectors are still handled by the backend. Accessors should return strings, numbers, or booleans.

#### Detail Tabs and Resource Context

Import `PluginResourceTab` from the SDK's root entry point. It has required `id`, `label`, and `element` fields, plus an optional `order`. IDs must be unique among the tabs for the resource. Labels support localization, and `element` accepts any React node. Plugin tabs are appended after host tabs. `order` defaults to `0`, and user ordering preferences take precedence.

In plugin cell components and tabs, use `useResourceContext<T>()` from `/resources` to access the resource already fetched by the host:

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
| `resource` | `T` | Resource object for the current row or detail page |
| `reference` | `ResourceReference` | API group, plural resource name, and available scope information for the current resource |
| `onRefresh` | `() => Promise<unknown>` | Refresh the host page's data |

This hook is only available in cell and tab extensions, not in replacement pages or standalone routes. Continue using `useResource` and `useResources` to query related resources. By default, they inherit the current cluster and the current object's namespace, which you can override through options.

#### Replace Custom Resource Lists and Details

`list` and `detail` accept React nodes. If you omit one, Kite continues using its generic view for that page. You do not need to declare a plugin route, and a menu can point directly to the custom resource list:

```tsx
// plugin.config.tsx
import { lazy } from 'react'
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

const GatewayList = lazy(() => import('./src/pages/gateway-list'))
const GatewayDetail = lazy(() => import('./src/pages/gateway-detail'))
const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

export default definePlugin({
  i18n: translations,
  menus: [
    {
      id: 'gateways',
      parent: 'core:traffic',
      label: label('navigation.gateways'),
      resource: gateways,
      icon: 'IconLoadBalancer',
    },
  ],
  resources: [
    { ...gateways, list: <GatewayList />, detail: <GatewayDetail /> },
  ],
})
```

Replacement pages fetch their own data through resource hooks. Detail pages use `useParams()` to read `name` and `namespace`. Menus, the CRD browser, and links within pages use the same custom resource URLs; see [Resource Page Navigation](#resource-page-navigation). Plugins can also declare `routes` for standalone pages such as an overview.

When multiple active plugins replace the same page type for a resource, Kite uses the first match in the active plugin list. If a plugin is disabled, uninstalled, incompatible, or its module fails to load, Kite uses the generic resource view. Rendering errors are handled by the plugin error boundary.

#### Loading and Isolation

The SDK writes metadata such as resource targets and column and tab labels into `plugin.json`. The host uses this metadata to show extension entry points. It loads a plugin module when its columns are visible, tab content when selected, and replacement pages when visited. React components can still use `lazy()` to split code into chunks.

The host prefixes extension IDs with the plugin identity, for example `plugin:my-plugin:column:team` and `plugin:my-plugin:tab:policy`. IDs do not include version numbers, so user preferences survive upgrades. A detail page can select a plugin tab with `?tab=plugin:my-plugin:tab:policy`. Extensions are removed when a plugin is disabled or uninstalled. If the current tab no longer exists, Kite switches to an available tab.

Column and tab extensions apply to host pages that use the resource table and detail page components. A `ResourceTable` or `ResourceDetailShell` rendered by a plugin does not automatically include content from other plugins. Its `tabs` organize the plugin's own detail page content and order. Loading or rendering errors in a plugin column or tab only affect that extension's area.

### Menus

- `id` and `label` are required. The ID must be unique among the plugin's menus and follows the same format as route IDs. Labels support localization.
- `route` points to a plugin route that can open without required parameters. `resource: { group, resource }` points directly to a custom resource list, with page replacements declared in `resources`; no extra route registration is needed. The two options are mutually exclusive. A menu with neither is a group heading.
- `parent` determines the menu's location:

| `parent` Value | Location |
| -------------- | -------- |
| Omitted | Top-level sidebar menu or group |
| `core:workloads`, etc. | Inside a built-in Kite group |
| `my-plugin:tools` | Inside this plugin's group with the ID `tools` |

Built-in group IDs are `core:application`, `core:workloads`, `core:traffic`, `core:storage`, `core:config`, `core:security`, and `core:other`. You can import `coreMenuGroupIds` from `/validation`.

A menu's parent must be a built-in group or a group declared by the same plugin, and cycles are not allowed. `order` sets the default ordering; user sidebar preferences take precedence. `icon` accepts a host icon name such as `IconBox` or `IconPackage`. Unknown names use the default icon.

::: warning
`plugin.config.tsx` runs once in Node.js during the build to extract navigation and resource extension metadata. The same file is also the browser entry point. Route, menu, and resource extension declarations must not depend on browser globals or user state. Import page and tab components with `React.lazy`.
:::

## Navigation

```tsx
import { PluginLink, usePluginNavigate } from '@kite-dev/plugin-sdk/navigation'
import { Button } from '@kite-dev/plugin-sdk/ui'

export function DeploymentActions() {
  const navigate = usePluginNavigate()

  return (
    <>
      <PluginLink route="deployment" params={{ namespace: 'default', name: 'demo' }}>
        Open details
      </PluginLink>
      <Button onClick={() => navigate('deployments')}>All Deployments</Button>
    </>
  )
}
```

- `PluginLink` accepts standard React Router Link props except `to`, plus `route`, `params`, `search`, and `hash`. Parameters are encoded automatically, and the plugin prefix is added.
- `usePluginNavigate()` returns `navigate(routeId, params?, options?)`.
- `/navigation` also exports `useParams`, `useSearchParams`, `useLocation`, and `Outlet`, with the same usage as react-router-dom.
- `usePlugin()` returns the plugin ID and route table. Use it with `resolvePluginRoute(context, routeId, params?)` to construct URLs manually.

### Resource Page Navigation

Import `ResourceLink` and `resolveResourcePath` from `/navigation` to navigate to Kite's custom resource pages without relying on plugin routes:

```tsx
import { ResourceLink } from '@kite-dev/plugin-sdk/navigation'

const gateways = { group: 'gateway.networking.k8s.io', resource: 'gateways' }

<ResourceLink resource={gateways}>All Gateways</ResourceLink>
<ResourceLink resource={gateways} name="demo" namespace="default">
  demo
</ResourceLink>
```

`ResourceLink` accepts `resource: PluginResourceTarget`, optional `name` and `namespace`, and standard React Router Link props except `to`. Omit `name` to open the list; provide it to open a detail page. For namespaced objects, also provide `namespace`. The URLs stay the same when a plugin replaces the pages:

| Page | URL |
| ---- | --- |
| List | `/crds/gateways.gateway.networking.k8s.io` |
| Namespaced detail | `/crds/gateways.gateway.networking.k8s.io/default/demo` |
| Cluster-scoped detail | `/crds/clusterissuers.cert-manager.io/demo` |

`resolveResourcePath(target, item?)` returns the same paths, where `item` is `{ name, namespace? }`. Parameters are encoded automatically, and Kite's Router handles the deployment base path. In event callbacks, use React Router's `useNavigate()` to navigate:

```tsx
import { resolveResourcePath, useParams } from '@kite-dev/plugin-sdk/navigation'
import { useNavigate } from 'react-router-dom'

const { name = '', namespace } = useParams<{ name: string; namespace: string }>()
const navigate = useNavigate()
const returnToList = () => navigate(resolveResourcePath(gateways))
```

## Resource Queries

Identify resources by API group and plural resource name:

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

Both use the current cluster and plugin namespace context by default. Query cache keys include the cluster and resource scope.

| Query Option | Purpose |
| ------------ | ------- |
| `cluster` | Query a specific accessible cluster |
| `namespace` | Override the plugin namespace |
| `enabled` | Enable or disable the query |
| `staleTime` | How long cached data stays fresh, in milliseconds |
| `refreshInterval` | Polling interval in milliseconds |

`ResourceListQueryOptions` extends the shared `ResourceQueryOptions` with `labelSelector`, `fieldSelector`, and `reduce`. Only `useResources` accepts these options. Detail, event, Describe, history, and related resource queries do not accept list filtering parameters. `fieldSelector` and `reduce` apply to built-in resource lists.

Use `_all` for all namespaces, or a comma-separated string to select multiple namespaces. A single-resource query requires the object's actual namespace. Cluster-scoped custom resources must declare `scope: 'Cluster'`. Kite automatically recognizes the scope of built-in resources.

### Custom Resources (CRDs)

Custom resources use the same hooks with types defined by the plugin:

```tsx
interface Certificate extends KubernetesResource {
  spec: { secretName: string; dnsNames?: string[] }
}

const certificates = useResources<Certificate>(
  { group: 'cert-manager.io', resource: 'certificates' },
  { namespace: '_all' }
)
```

Kite automatically selects the CRD's API version. Custom resource lists support `labelSelector` but not `fieldSelector`. The hooks return arrays of resources without exposing server-side pagination. Use `refreshInterval` to poll for updates.

## Mutations and Operations

The `/resources` entry point provides Promise-based mutations:

| Function | Behavior |
| -------- | -------- |
| `applyResource(yaml, namespace?)` | Create or update resources in the current cluster using YAML |
| `updateResource(ref, name, body, options?)` | Replace a built-in or custom resource with a complete object |
| `patchResource<T>(ref, name, body, options?)` | Submit a `DeepPartial<T>` for a supported built-in resource |
| `deleteResource(ref, name, options?)` | Delete a built-in or custom resource |

- Shared options are `namespace`, `cluster`, and `signal`. Deletion also supports `force` and `wait`. Mutations on namespaced resources must specify the actual namespace.
- `applyResource` uses Kite's create/update workflow. An explicit `namespace` overrides the namespace in the YAML; cluster-scoped resources ignore it. For custom resources, use `updateResource` or `applyResource`; custom resources do not support generic PATCH or Server-Side Apply through this API.
- Mutations do not refresh queries automatically. After success, call `refetch()` or invalidate the relevant cache entries with TanStack Query.

Other operations are grouped by area:

| Area | Functions |
| ---- | --------- |
| Events and inspection | `useResourceEvents`, `useDescribe`, `useResourceHistory`, `useRelatedResources` |
| Workloads | `scaleDeployment`, `restartWorkload`, `useWorkloadRevisions`, `rollbackWorkload` |
| Nodes | `drainNode`, `cordonNode`, `uncordonNode`, `taintNode`, `untaintNode` |
| Pod debugging | `resizePod`, `debugPod`, `copyDebugPod` |
| Pod files | `usePodFiles`, `podDownloadFile`, `podPreviewFile`, `podUploadFile` |
| Configuration helpers | `useTemplates`, `useImageTags` |

Additional details:

- Inspection hooks accept a resource reference, a name, and query options. `useResourceHistory` also supports `page` and `pageSize`. It returns operations recorded by Kite, not a complete revision history.
- `useRelatedResources` discovers relationships for a subset of built-in resources. For custom resources, use `useResources` and match `ownerReferences` or other fields yourself.
- `scaleDeployment` only applies to Deployments. `restartWorkload` supports Deployments and StatefulSets. Revision queries and rollback also support DaemonSets.
- `debugPod` creates an ephemeral debug container. `copyDebugPod` creates a copy of a Pod for debugging.

## Resource UI Components

Import these components from `/ui`. They are all optional; you can use the hooks with your own page layouts instead.

### WorkloadPodsCard

Displays the host's compact Pod card, including status, ready containers, restarts, node, IP, and age. Pod names open the host's Pod detail dialog.

```tsx
import { WorkloadPodsCard } from '@kite-dev/plugin-sdk/ui'

<WorkloadPodsCard
  title="Pods"
  pods={pods}
  isLoading={isLoading}
  loadingText="Loading pods…"
  emptyText="No pods found"
  ageLabel="Age"
/>
```

`pods` accepts Kubernetes `Pod[]`. The component only renders the supplied data; use resource hooks to load it. All displayed labels above accept `ReactNode` and can use your plugin's translations.

### ResourceTable

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

`ResourceTable` includes search, sorting, client-side pagination, row counts, column visibility, and refresh controls. `id` is a table identifier unique within the plugin; search and column preferences are persisted by cluster and table. `resourceName` is the display name. Optional props include `searchQueryFilter`, `defaultHiddenColumns`, `extraToolbars`, `emptyState`, and `onCreateClick`. Pass `namespace: { value, onChange }` to show a namespace selector. Pass both `refreshInterval` and `onRefreshIntervalChange` to show a polling interval selector, and pass the same interval to the resource hook to control polling.

### ResourceDetailShell

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

- `ResourceDetailShell` provides loading and error states, a resource header, refresh controls, and optional resource actions.
- `tabs` is the only way to define tabs. Each entry is `{ value, label, content }`, displayed in array order, with a `value` unique within the page. The shell does not automatically add Overview or YAML tabs. Users can still change ordering and visibility through Kite's tab controls.
- `content` can be a React node or a callback that receives `{ resource, refreshKey, onRefresh }`. The type of `resource` is inferred from `data`. To reset a child component on manual refresh, use `refreshKey` as its `key`.
- `ResourceYaml<T>` accepts a resource object as `value` and manages YAML editing, validation, saving, and cancellation independently. `onSave` receives the parsed object and returns a Promise. If saving fails, the component displays an error and keeps the draft. Without `onSave`, it is read-only. Use `title` and `actions` to customize the header, `className` to style the container, and `fillHeight` to fill the tab. It can also be used without a shell.
- Delete and clone actions are disabled by default; enable them with `showDelete` and `showClone`. `onDeleted` runs after deletion. `showDescribe` controls the Describe action, while `headerActions` and `titleIcon` customize the resource header.
- `ResourceOverview` displays metadata and custom fields in an information card. Its `children` appear below that card in the main column; use them for Pod lists and other resource-specific sections. Events, related resources, labels, and annotations appear in the sidebar. For custom resources, provide your own `relatedResources` content or pass `relatedResources={null}` to skip the built-in relationship query.
- `ResourceEvents` is a standalone event table that accepts `resource`, `name`, and an optional `namespace`.

### Primitives and Editors

The `/ui` entry point includes `Button`, `Badge`, `Input`, `Label`, the `Card` family, `Dialog`, `Select`, the `Tabs` family, and the following components:

```tsx
import { NamespaceSelector, YamlEditor } from '@kite-dev/plugin-sdk/ui'

<NamespaceSelector
  value={namespace}
  onChange={setNamespace}
  showAll={false}
  multiple={false}
/>

<YamlEditor value={yaml} onChange={(v) => setYaml(v ?? '')} height="400px" />
```

`YamlEditor`'s `onChange` receives `string | undefined`; the component also supports `disabled`. `NamespaceSelector` also supports `disabled`, `triggerClassName`, and `modal`.

## Cluster and Application Hooks

Import these hooks from `/hooks`:

| Hook | Result or Action |
| ---- | ---------------- |
| `useCluster()` | `currentCluster` and `setCurrentCluster` |
| `useClusters(options?)` | Query result for accessible clusters; enabled by default |
| `useNamespace()` | Plugin namespace selection and `setNamespace` |
| `useAuth()` | `user`, `isLoading`, and `capabilities`, including helpers such as `isAdmin()` |
| `useTheme()` | `theme`, `actualTheme`, and `setTheme` |
| `useFavorites()` | Favorites and operations to create, read, update, and delete them |
| `useTerminal()` | Open, close, or minimize the global terminal panel |
| `usePageTitle(title)` | Set the page title |
| `useIsMobile()` | Whether the layout is mobile |
| `useInterval(callback, delay)` | Run a callback at an interval |
| `useVersionInfo()` | Kite version information |

`currentCluster` is `null` when no cluster is selected. `ClusterInfo` only contains `name`, `isDefault`, and optional `version` and `error` fields; it does not include cluster credentials. Authentication is always managed by Kite. `useTerminal` controls the global terminal panel and does not create Pod terminal sessions.

## Kubernetes Types

The `/k8s` entry point exposes types from `kubernetes-types`, grouped by API group and version. These are types only, with no runtime module:

```ts
import type { AppsV1, CoreV1, MetaV1 } from '@kite-dev/plugin-sdk/k8s'

type Deployment = AppsV1.Deployment
type Pod = CoreV1.Pod
type ObjectMeta = MetaV1.ObjectMeta
```

Other groups include `AutoscalingV1`, `AutoscalingV2`, `NetworkingV1`, and `RbacV1`. Use `import type`. Define your own custom resource interfaces, optionally extending `KubernetesResource` from `/resources`.

## Metrics and Logs

The `/observability` entry point provides:

- `useOverview(options?)`: cluster overview data.
- `useResourceUsageHistory(duration, options?)`: resource usage history.
- `usePodMetrics(namespace, podName, duration, options?)`: Pod time-series metrics.
- `useLogsWebSocket(namespace, podName, options?)`: streaming logs.

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

These hooks use the current cluster, and metric query caches are isolated by cluster. Log streaming is enabled by default. Options include `enabled`, `container`, `tailLines`, `timestamps`, `previous`, `sinceSeconds`, and `labelSelector`. Results include loading and connection states, errors, download speed, `refetch`, `stopStreaming`, and `clearLogs`. The page controls how many log lines to retain.

## Calling Other Kite APIs

`apiClient` from `/api` provides `get`, `post`, `put`, `patch`, `delete`, and `request`. It automatically includes Kite authentication, the current cluster, and the deployment base path.

Pass API-relative paths: `apiClient.get('/pods/_all')` requests `/api/v1/pods/_all` under the deployment base path. Do not include `/api/v1` again. Typed methods return parsed data and reject unsuccessful responses. `request` returns the raw `Response`, whose status you must check yourself. Options accept `RequestInit` fields and `retryOnUnauthorized`.

For custom queries, use `useQuery`, `useMutation`, or `useQueryClient` from `@tanstack/react-query` directly. Include the plugin identity, cluster, namespace, and relevant parameters in query keys:

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

::: warning
Frontend plugins cannot register backend APIs. They can only call Kite's existing endpoints.
:::

## Validation API

Build and packaging commands validate the manifest automatically. Tooling can also import these functions from `/validation`:

- `validateManifest(input)`: validate metadata, versions, asset paths, routes, menus, and resource extension declarations.
- `validateNavigation(pluginId, input)`: validate routes, menus, resource targets, and column and tab metadata, including unique IDs, menu parent-child relationships, and localized labels.
- `validateModule(manifest, input)`: check that the module's route, menu, and resource extension metadata matches the manifest, and validate route and tab `element` values and the contracts for column accessors and sorting functions.
- `coreMenuGroupIds`: the host's public menu group IDs.

For complete parameter, option, and response types, see the TypeScript declarations under [`packages/plugin-sdk/src/`](https://github.com/kite-org/kite-plugins/tree/main/packages/plugin-sdk/src) in the plugin repository.
