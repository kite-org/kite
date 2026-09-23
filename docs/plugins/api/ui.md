---
outline: deep
---

# UI Components

Import components from `@kite-dev/plugin-sdk/ui` to reuse Kite's resource tables, detail layouts, YAML editor, and basic controls. Components handle display and interaction; fetch data through [Resource Queries and Operations](./resources). You can also combine those APIs with your own layouts.

## ResourceTable

Build resource list pages with search, sorting, client-side pagination, and column visibility controls. Pass in query results and column definitions:

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

| Prop | Description |
| ---- | ----------- |
| `id`, `resourceName`, `data`, `columns` | Required. `id` identifies the table within the plugin, `resourceName` is its display name, and the caller provides data through resource hooks |
| `isLoading`, `error`, `onRefresh` | Loading state, error state, and refresh callback |
| `searchQueryFilter(item, query)` | Custom search matching; defaults to searching values in currently visible columns |
| `extraToolbars`, `emptyState`, `onCreateClick` | Additional toolbar content, empty state, and create-button callback |
| `defaultHiddenColumns` | Column IDs hidden by default |
| `namespace` | `{ value, onChange }`; shows a namespace selector when provided |
| `refreshInterval`, `onRefreshIntervalChange` | Shows a polling interval selector when both are provided. Pass the same interval to the resource hook to control polling |

The table also provides row counts and refresh controls. Search and filter state is stored per cluster and table in `sessionStorage`; column visibility is stored in `localStorage`.

## ResourceDetailShell

Build resource detail pages with a header, loading and error states, refresh controls, and optional resource actions. Use `tabs` to arrange overview, YAML, and other content:

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

| Prop | Description |
| ---- | ----------- |
| `resource`, `resourceLabel`, `name`, `data`, `isLoading`, `error`, `onRefresh`, `tabs` | Required. `resource` is the resource reference; `data` is the resource object |
| `namespace` | Namespace for namespaced resources |
| `tabs` | Defines all tabs. Each entry is `{ value, label, content }`, displayed in array order, with a `value` unique to the page. The shell does not automatically add overview or YAML tabs |
| `content` | A React node or a callback receiving `{ resource, refreshKey, onRefresh }`. The type of `resource` is inferred from `data`. Use `refreshKey` as a child component's `key` to reset it on manual refresh |
| `showDelete`, `showClone` | Show delete and clone actions; both are disabled by default |
| `showDescribe` | Show the Describe action; enabled by default |
| `onDeleted` | Callback after successful deletion |
| `headerActions`, `titleIcon`, `loadingMessage` | Custom header actions, title icon, and loading text |

Users can change tab order and visibility through Kite's tab controls.

## ResourceOverview

Display metadata and custom fields (`fields`) in an information card.

`children` appears below the information card in the main column, making it suitable for resource-specific content such as a Pod list. Events, related resources, labels, and annotations appear in the sidebar. Omitting `relatedResources` uses the built-in relationship query. Pass `relatedResources={null}` or custom content to skip it.

## ResourceYaml

`ResourceYaml<T>` accepts a resource object as `value` and manages YAML editing, validation, saving, and cancellation. Embed it in a detail page or use it independently.

| Prop | Description |
| ---- | ----------- |
| `value` | Resource object to display or edit |
| `onSave` | Receives the parsed object and returns a Promise. A failed save displays an error and preserves the draft. Omit it for read-only display |
| `title`, `actions` | Customize the header |
| `className` | Style the container |
| `fillHeight` | Fill the tab's available height |

## ResourceEvents

A standalone event table accepting `resource`, `name`, and an optional `namespace`:

```tsx
import { ResourceEvents } from '@kite-dev/plugin-sdk/ui'

<ResourceEvents
  resource={{ group: 'apps', resource: 'deployments' }}
  name="demo"
  namespace="default"
/>
```

## WorkloadPodsCard

Display Kite's compact Pod card, including status, ready container count, restarts, node, IP, and age. Clicking a Pod name opens the host's Pod detail dialog.

```tsx
import { WorkloadPodsCard } from '@kite-dev/plugin-sdk/ui'

<WorkloadPodsCard
  title="Pods"
  pods={pods}
  isLoading={isLoading}
  loadingText="Loading Pods…"
  emptyText="No Pods"
  ageLabel="Age"
/>
```

`title`, `pods`, `isLoading`, `loadingText`, `emptyText`, and `ageLabel` are all required. `pods` accepts Kubernetes `Pod[]`. The component displays the data you provide; fetch it through resource hooks. Text props accept `ReactNode`, so you can use your plugin's translations.

## Basic Controls

- Basic components: `Button`, `Badge`, `Input`, `Label`, and the `Card`, `Dialog`, `Select`, and `Tabs` component families.
- `NamespaceSelector`: supports `value`, `onChange`, `showAll`, `multiple`, `disabled`, `triggerClassName`, and `modal`.
- `YamlEditor`: supports `value`, `onChange` (receives `string | undefined`), `disabled`, and `height`.
