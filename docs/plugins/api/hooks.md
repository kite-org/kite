---
outline: deep
---

# Host State and Interaction

Use `@kite-dev/plugin-sdk/hooks` to access Kite's current cluster, namespace, user, and theme, or control host features such as favorites and the terminal. These React hooks keep plugins in sync with Kite without maintaining a separate copy of its state.

## Current Cluster and Namespace

```tsx
import { useCluster, useNamespace } from '@kite-dev/plugin-sdk/hooks'

export function CurrentScope() {
  const { currentCluster } = useCluster()
  const { namespace } = useNamespace()

  return (
    <p>
      {currentCluster ?? 'No cluster selected'} / {namespace === '_all' ? 'All namespaces' : namespace}
    </p>
  )
}
```

| Hook | Result / action |
| ---- | --------------- |
| `useCluster()` | `{ currentCluster, setCurrentCluster }`; `currentCluster` is `null` when no cluster is selected |
| `useClusters(options?)` | Query result for accessible clusters. Enabled by default; use `{ enabled }` to disable it |
| `useNamespace()` | `{ namespace, setNamespace }`, the plugin's namespace context |

`ClusterInfo` contains only `name`, `isDefault`, and optional `version` and `error` fields. It does not include cluster credentials. Kite manages authentication.

## User and Plugin Settings

| Hook | Result / action |
| ---- | --------------- |
| `useAuth()` | `{ user, isLoading, capabilities }`, where `capabilities` is `{ aiEnabled, kubectlEnabled }`. Check administrator access with `user?.isAdmin()` |
| `usePluginSettings<T>()` | Current plugin settings: `{ settings, isLoading, isSaving, error, save }`. See the [settings page example](./plugin-config#settings-page) |

`usePluginSettings` reads and writes instance-wide plugin settings stored on the server. The plugin defines their structure. Only administrators can write through `save()`; other users can only read. Before configuration, `settings` is `{}`.

## Appearance and Page Information

| Hook | Result / action |
| ---- | --------------- |
| `useTheme()` | `{ theme, actualTheme, setTheme }` |
| `usePageTitle(title)` | Sets the page title |
| `useIsMobile()` | Whether the mobile layout is active |
| `useVersionInfo()` | Kite version information (`UseQueryResult<VersionInfo, Error>`) |

## Favorites and Terminal

| Hook | Result / action |
| ---- | --------------- |
| `useFavorites()` | `{ favorites, addToFavorites, removeFromFavorites, isFavorite, toggleFavorite, refreshFavorites }` |
| `useTerminal()` | `{ isOpen, isMinimized, openTerminal, closeTerminal, minimizeTerminal, toggleTerminal }` |

`useTerminal` controls the global kubectl terminal panel. To embed a Pod exec session, use the [Terminal component](./ui#terminal).

## Host Version

`useHostInfo()` synchronously returns `{ kiteVersion, sdkVersion }`, where `sdkVersion` is the SDK version installed in the host. Check these versions before enabling features that require a newer host.

```tsx
import { useHostInfo } from '@kite-dev/plugin-sdk/hooks'

export function HostVersion() {
  const { kiteVersion, sdkVersion } = useHostInfo()
  return <p>Kite {kiteVersion} · SDK {sdkVersion}</p>
}
```

Version information is available when the plugin renders; the hook does not send a request. Use semantic version comparisons instead of comparing version strings alphabetically.

## Repeating Callbacks

`useInterval(callback, delay)` runs a callback at an interval in milliseconds. To refresh a resource query periodically, use the query hook's `refreshInterval` option.
