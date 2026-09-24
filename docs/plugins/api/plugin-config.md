---
outline: deep
---

# Plugin Configuration

Use `definePlugin()` in `plugin.config.tsx` to declare routes, menus, resource extensions, themes, a settings page, and translation dictionaries.

All configuration fields are optional. `routes`, `menus`, `resources`, and `themes` default to empty arrays.

| Field | Purpose |
| ----- | ------- |
| [`routes`](#routes) | Register plugin pages and routes |
| [`menus`](#menus) | Register sidebar menus and groups |
| [`resources`](#resource-extensions) | Add list columns or detail tabs, or replace custom resource pages |
| [`themes`](#themes) | Provide color themes |
| [`settings`](#settings-page) | Provide an administrator settings page |
| [`i18n`](#internationalization) | Register translation dictionaries |

## Routes

Register a plugin home page and a detail page with namespace and name parameters:

```tsx
import { lazy } from 'react'
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

const DeploymentsPage = lazy(() => import('./src/pages/deployments'))
const DeploymentPage = lazy(() => import('./src/pages/deployment'))

export default definePlugin({
  i18n: translations,
  routes: [
    {
      id: 'deployments',
      path: '',
      title: label('navigation.deployments'),
      element: <DeploymentsPage />,
    },
    {
      id: 'deployment',
      path: 'deployments/:namespace/:name',
      title: label('navigation.deployment'),
      element: <DeploymentPage />,
    },
  ],
})
```

- `id`: A route ID unique within the plugin. It must start with a letter or digit and may contain letters, digits, underscores, and hyphens.
- `path`: A path relative to `/plugins/<plugin ID>`. It cannot start with `/` or contain `\`, `.` segments, or `..` segments. An empty string is the plugin home page. Named parameters (`:name`), optional parameters (`:name?`), and a trailing `*` are supported.
- `title`: An optional page title that supports localized labels.
- `element`: Required. Any React node; each route renders a complete page.

Paths with the same structure but different parameter names, such as `deployments/:namespace/:name` and `deployments/:ns/:name`, conflict and cannot both be declared.

| Route path | URL |
| ---------- | --- |
| `''` | `/plugins/my-plugin` |
| `deployments/:namespace/:name` | `/plugins/my-plugin/deployments/default/demo` |

## Menus

Add a Certificate management group with a Certificate list menu for a plugin whose ID is `my-plugin`:

Install the icon library used in this example:

```sh
pnpm add @tabler/icons-react
```

```tsx
import { definePlugin } from '@kite-dev/plugin-sdk'
import { IconCertificate } from '@tabler/icons-react'

import { label, translations } from './src/i18n'

export default definePlugin({
  i18n: translations,
  menus: [
    {
      id: 'cert-manager',
      label: label('navigation.certManager'),
    },
    {
      id: 'certificates',
      parent: 'my-plugin:cert-manager',
      label: label('navigation.certificates'),
      icon: <IconCertificate />,
      resource: { group: 'cert-manager.io', resource: 'certificates' },
    },
  ],
})
```

- `id` and `label` are required. IDs must be unique within the plugin and follow the same format as route IDs. Labels support localization.
- `route` points to a plugin route that can open without required parameters. `resource: { group, resource }` points directly to a custom resource list, which can use a page declared in `resources` without an additional plugin route. These fields are mutually exclusive. A menu with neither field is a group heading.
- `parent` determines the menu's location:

| `parent` value | Location |
| -------------- | -------- |
| Omitted | Top-level sidebar menu or group |
| `core:workloads`, etc. | Inside a built-in Kite group |
| `my-plugin:tools` | Inside this plugin's group with ID `tools` |

Built-in group IDs are `core:application`, `core:workloads`, `core:traffic`, `core:storage`, `core:config`, `core:security`, and `core:other`. Import `coreMenuGroupIds` from `/validation` to access them.

A parent must be a built-in group or a group declared by the same plugin. Cycles are not allowed, and parent groups cannot have `route` or `resource` fields. `order` sets the default position (menu items default to `50`); users' sidebar preferences take precedence.

`icon` accepts a React element or a built-in icon name. Use libraries such as `@tabler/icons-react` or `lucide-react`, or pass your own component. Install the icon library in your plugin; the icons you use are bundled with it.

Custom components must forward `className` to the icon element and use `currentColor` to inherit the menu color. For example, wrap a third-party icon to adjust its stroke width:

```tsx
import { IconCertificate } from '@tabler/icons-react'

function CertificateIcon({ className }: { className?: string }) {
  return <IconCertificate className={className} stroke={1.5} />
}
```

Set `icon: <CertificateIcon />` on the menu to use it. Custom icons load when their menus are displayed and appear in the sidebar, Configure Sidebar, and global search navigation results. Top-level group headings do not display icons.

You can also use any of these built-in names, such as `icon: 'IconShieldCheck'`. If omitted or set to an `Icon...` name outside this list, it defaults to `IconBox`:

```text
IconBox           IconRocket           IconStack2        IconTopologyBus  IconPackage
IconPlayerPlay    IconClockHour4       IconRouter        IconShield       IconNetwork
IconLoadBalancer  IconRoute            IconFileDatabase  IconDatabase     IconMap
IconLock          IconArrowsHorizontal IconUser          IconUsers        IconShieldCheck
IconKey           IconBoxMultiple      IconServer2       IconBell         IconCode
```

`definePlugin` infers route ID literal types from inline declarations and checks `menus.route` values. If you extract the route array into a variable, use `as const` to preserve those literal types.

## Resource Extensions

Use `resources` in `plugin.config.tsx` to add columns to Kite's resource lists, add tabs to detail pages, or replace complete pages for a CRD. To query or modify resource data, see [Resource Queries and Operations](./resources).

Each entry has type `PluginResourceView<T>` and identifies a resource by `group` (API group) and `resource` (plural resource name). Use an empty string for the core API group: a Pod is `{ group: '', resource: 'pods' }`, and a StorageClass is `{ group: 'storage.k8s.io', resource: 'storageclasses' }`. API groups are validated for format without restricting suffixes such as `k8s.io`.

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `group`, `resource` | `string` | Required; together they identify a unique resource target |
| `columns` | `PluginResourceColumn<T>[]` | Append columns to host lists |
| `tabs` | `PluginResourceTab[]` | Append tabs to host detail pages |
| `list` | `ReactNode` | Replace the complete custom resource list page |
| `detail` | `ReactNode` | Replace the complete custom resource detail page |

Provide at least one of these four extensions. A plugin cannot declare the same resource target more than once. Kite loads plugin modules on demand: when a column is visible, a tab is selected, or a replacement page is opened. `columns` and `tabs` apply to both native resource pages and generic custom resource pages. `list` and `detail` replace only custom resource pages, not native resource pages.

### Adding List Columns

Add a Team column to the Pod list that displays the resource's `team` label:

```tsx
// plugin.config.tsx
import { definePlugin, type PluginResourceColumn } from '@kite-dev/plugin-sdk'
import type { CoreV1 } from '@kite-dev/plugin-sdk/k8s'

import { label, translations } from './src/i18n'

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
    },
  ],
})
```

Import `PluginResourceColumn<T, TValue>` from the SDK's root entry point. `T` is the resource type; `TValue` is the column value type and defaults to `unknown`.

| Field | Description |
| ----- | ----------- |
| `id`, `header` | Required. IDs must be unique among columns for the resource. Headers support localized labels |
| `accessorFn` / `accessorKey` | Read the value used for display, sorting, and search. These are mutually exclusive. `accessorKey` supports dotted paths such as `metadata.labels.team` |
| `cell` | TanStack Table cell renderer. `row.original` is the current resource. Render a separate React component when you need hooks |
| `size`, `minSize`, `maxSize` | Column width and its limits |
| `enableSorting`, `sortingFn` | Control sorting. Columns with an accessor are sortable by default. `sortingFn` accepts a TanStack built-in name (`auto`, `text`, `alphanumeric`, `datetime`, etc.) or a custom function |
| `sortDescFirst`, `sortUndefined`, `invertSorting` | Initial sort direction, placement of missing values (last by default), and inverted sorting |
| `enableHiding`, `defaultHidden` | Whether the column can be hidden and whether it starts hidden. Existing user preferences take precedence |
| `order` | Default order among plugin columns, starting at `0`, with ties sorted by ID. All plugin columns appear after host columns |

When any plugin column is visible, host list requests retrieve complete resource objects, including when watch is enabled. Cells can read the current row directly without requesting the resource again. Text search matches values from visible columns, including plugin accessor results. Label selectors are still processed by the backend. Accessors should return strings, numbers, or booleans.

### Adding Detail Tabs

Add a Policy tab to Pod detail pages:

```tsx
import { lazy } from 'react'
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

const PolicyTab = lazy(() => import('./src/tabs/policy'))

export default definePlugin({
  i18n: translations,
  resources: [
    {
      group: '',
      resource: 'pods',
      tabs: [
        {
          id: 'policy',
          label: label('tabs.policy'),
          element: <PolicyTab />,
        },
      ],
    },
  ],
})
```

Import `PluginResourceTab` from the SDK's root entry point:

| Field | Description |
| ----- | ----------- |
| `id` | Required; unique among tabs for this resource |
| `label` | Required; a localized label |
| `element` | Required; any React node |
| `order` | Optional; defaults to `0`, with ties sorted by ID |

Plugin tabs appear after host tabs. Users' order and visibility preferences take precedence.

To access the current resource or refresh the page from a column or tab component, see [Reading the Current Resource in an Extension](./resources#reading-the-current-resource-in-an-extension).

### Replacing CRD List and Detail Pages

`list` and `detail` accept React nodes. If you provide only one, the other page uses Kite's generic view. You do not need plugin routes, and menus can point directly to the CRD:

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

Replacement pages fetch their data through resource hooks. Detail pages use `useParams()` to read `name` and `namespace`. Menus, the CRD browser, and page links use the same CRD URLs; see [Opening Resource Pages](./navigation#opening-resource-pages). Reuse [UI Components](./ui) for tables, detail layouts, and YAML editing.

If multiple active plugins replace the same page type for the same resource, the first match in the active plugin list takes effect. Kite falls back to its generic view when a plugin is disabled, uninstalled, incompatible, or fails to load.

### Extension IDs and Deep Links

Kite prefixes extension IDs with the plugin ID, for example `plugin:my-plugin:column:team` and `plugin:my-plugin:tab:policy`. These IDs do not include a version, so plugin upgrades preserve user preferences. Use `?tab=plugin:my-plugin:tab:policy` to select a tab directly. If that tab does not exist on the page, Kite selects the first visible tab.

For example, open the Pod named `demo` in the `default` namespace and select the Policy tab provided by `my-plugin`:

```text
/pods/default/demo?tab=plugin:my-plugin:tab:policy
```

Column and tab extensions apply to pages that use the host's resource table and detail components. A plugin's own `ResourceTable` and `ResourceDetailShell` do not automatically include other plugins' extensions. A plugin column or tab loading or rendering error affects only that extension's area.

## Themes

Plugins can provide color themes. A theme is a stylesheet that overrides Kite's CSS variables, so one file can change the colors of pages, YAML editors, and terminals.

```tsx
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

export default definePlugin({
  i18n: translations,
  themes: [
    {
      id: 'nord',
      label: label('themes.nord'),
      styles: ['themes/nord.css'],
    },
  ],
})
```

| Field | Description |
| ----- | ----------- |
| `id` | Theme ID, unique within the plugin. Use lowercase letters, digits, and hyphens, starting and ending with a letter or digit |
| `label` | Optional name shown in the theme selector; defaults to the ID and supports localized labels |
| `styles` | One or more stylesheet paths, included in the plugin package |

Place stylesheets in `public/`; the build copies them unchanged into the package. Use the corresponding relative paths in `styles`. Theme plugins do not need routes, menus, or resources. If all three are absent, Kite loads only the stylesheets, without loading the plugin's JavaScript.

Themes from enabled plugins appear under **Color Theme** in the user menu, grouped by plugin name. Kite loads a stylesheet only when its theme is selected, so it can target `:root` and `.dark` directly:

```css
/* public/themes/nord.css */
:root {
  --background: oklch(0.98 0.005 250);
  --primary: oklch(0.62 0.13 220);
  --border: oklch(0.9 0.01 250);
}

.dark {
  --background: oklch(0.26 0.02 250);
  --primary: oklch(0.78 0.1 220);
  --border: oklch(1 0 0 / 12%);
}
```

You can override any variable defined in `ui/src/styles/themes/default.css`. Unspecified variables retain their defaults. While a theme is active, Kite adds `color-<plugin ID>-<theme ID>` to the root element; use that class when you need to limit selector scope. Relative `url()` values resolve to files in the plugin package, so bundled images and fonts can be referenced normally:

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background: url('./aurora.webp') center / cover no-repeat;
}
```

Themes with background images usually need translucent surfaces (`--background`, `--card`, `--popover`, and `--sidebar`); otherwise, opaque surfaces will cover the image.

## Settings Page

Declare a settings page to add a **Configure** button to the plugin's row under **Plugin management → Installed plugins**. The button opens a dialog rendered by the plugin:

```tsx
import { lazy } from 'react'
import { definePlugin } from '@kite-dev/plugin-sdk'

import { label, translations } from './src/i18n'

const Settings = lazy(() => import('./src/settings'))

export default definePlugin({
  i18n: translations,
  settings: {
    label: label('settings.title'),
    element: <Settings />,
  },
})
```

`label` is optional; the dialog title defaults to the plugin's name. `element` accepts any React node and should be imported with `React.lazy` in `plugin.config.tsx`. Plugins without `settings` do not show this button.

Settings are stored in Kite's backend database. The plugin defines their structure and reads and writes them through `usePluginSettings()`:

```tsx
import { useState } from 'react'
import { usePluginSettings } from '@kite-dev/plugin-sdk/hooks'
import { Button, Input, Label } from '@kite-dev/plugin-sdk/ui'

export default function Settings() {
  const { settings, isLoading, isSaving, save } = usePluginSettings<{
    grafanaUrl?: string
  }>()
  const [url, setUrl] = useState<string>()
  const grafanaUrl = url ?? settings?.grafanaUrl ?? ''

  if (isLoading) return null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="grafana-url">Grafana URL</Label>
        <Input
          id="grafana-url"
          value={grafanaUrl}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <Button
        disabled={isSaving}
        onClick={() => void save({ grafanaUrl })}
      >
        Save
      </Button>
    </div>
  )
}
```

Settings are shared across the Kite instance: an administrator configures them once for all users. All signed-in users can read them, but only administrators can write them. Kite shows a confirmation after a successful save. Each JSON submission is limited to 16 KiB. Before configuration, `settings` is an empty object, so the plugin should handle unset values. Uninstalling the plugin also removes its settings.

## Internationalization

The optional `i18n` field accepts the plugin's English and Chinese dictionaries. Name the `resources` returned by `createPluginI18n()` as `translations` and pass them into the configuration:

```tsx
import { definePlugin } from '@kite-dev/plugin-sdk'

import { translations } from './src/i18n'

export default definePlugin({
  i18n: translations,
})
```

Use `label()` from the same module for menu labels, route titles, and tab labels. Page components use `useTranslation()` so their text updates when Kite's language changes. See the [Internationalization guide](../i18n) for dictionary structure, binding, and complete examples.
