---
outline: deep
---

# 宿主状态与交互

从 `@kite-dev/plugin-sdk/hooks` 读取 Kite 当前集群、命名空间、用户和主题，或控制收藏、终端等宿主功能。这些 React Hook 让插件与宿主保持同步，不需要自己维护一份状态。

## 当前集群与命名空间

```tsx
import { useCluster, useNamespace } from '@kite-dev/plugin-sdk/hooks'

export function CurrentScope() {
  const { currentCluster } = useCluster()
  const { namespace } = useNamespace()

  return (
    <p>
      {currentCluster ?? '未选择集群'} / {namespace === '_all' ? '全部命名空间' : namespace}
    </p>
  )
}
```

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useCluster()` | `{ currentCluster, setCurrentCluster }`，未选择集群时 `currentCluster` 为 `null` |
| `useClusters(options?)` | 可访问集群的查询结果，默认启用，可用 `{ enabled }` 关闭 |
| `useNamespace()` | `{ namespace, setNamespace }`，即插件的命名空间上下文 |

`ClusterInfo` 只含 `name`、`isDefault` 和可选的 `version`、`error`，不包含集群凭据。认证始终由 Kite 管理。

## 用户与插件配置

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useAuth()` | `{ user, isLoading, capabilities }`；`capabilities` 为 `{ aiEnabled, kubectlEnabled }`，是否为管理员用 `user?.isAdmin()` 判断 |
| `usePluginSettings<T>()` | 当前插件的配置：`{ settings, isLoading, isSaving, error, save }`，配置页示例见[插件配置](./plugin-config#配置页) |

`usePluginSettings` 读写的是插件在服务端保存的实例级配置，字段结构由插件自己决定，只有管理员能通过 `save()` 写入，普通用户只能读取。未配置过时 `settings` 为 `{}`。

## 外观与页面信息

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useTheme()` | `{ theme, actualTheme, setTheme }` |
| `usePageTitle(title)` | 设置页面标题 |
| `useIsMobile()` | 是否移动端布局 |
| `useVersionInfo()` | Kite 版本信息（`UseQueryResult<VersionInfo, Error>`） |

## 收藏与终端

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useFavorites()` | `{ favorites, addToFavorites, removeFromFavorites, isFavorite, toggleFavorite, refreshFavorites }` |
| `useTerminal()` | `{ isOpen, isMinimized, openTerminal, closeTerminal, minimizeTerminal, toggleTerminal }` |

`useTerminal` 控制的是全局终端面板，不创建 Pod 终端会话。

## 定时回调

`useInterval(callback, delay)` 按毫秒间隔执行回调。资源查询需要定时刷新时，直接使用查询 Hook 的 `refreshInterval` 选项即可。
