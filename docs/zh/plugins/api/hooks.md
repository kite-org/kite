---
outline: deep
---

# Hooks

从 `/hooks` 导入：

| Hook | 结果 / 动作 |
| ---- | ----------- |
| `useCluster()` | `{ currentCluster, setCurrentCluster }`，未选择集群时 `currentCluster` 为 `null` |
| `useClusters(options?)` | 可访问集群的查询结果，默认启用，可用 `{ enabled }` 关闭 |
| `useNamespace()` | `{ namespace, setNamespace }`，即插件的命名空间上下文 |
| `useAuth()` | `{ user, isLoading, capabilities }`；`capabilities` 为 `{ aiEnabled, kubectlEnabled }`，是否为管理员用 `user?.isAdmin()` 判断 |
| `useTheme()` | `{ theme, actualTheme, setTheme }` |
| `useFavorites()` | `{ favorites, addToFavorites, removeFromFavorites, isFavorite, toggleFavorite, refreshFavorites }` |
| `useTerminal()` | `{ isOpen, isMinimized, openTerminal, closeTerminal, minimizeTerminal, toggleTerminal }` |
| `usePageTitle(title)` | 设置页面标题 |
| `useIsMobile()` | 是否移动端布局 |
| `useInterval(callback, delay)` | 按毫秒间隔执行回调 |
| `useVersionInfo()` | Kite 版本信息（`UseQueryResult<VersionInfo, Error>`） |
| `usePluginSettings<T>()` | 当前插件的配置：`{ settings, isLoading, isSaving, error, save }`，只有声明了[配置页](./plugin-config#配置页)的插件才用得上 |

`ClusterInfo` 只含 `name`、`isDefault` 和可选的 `version`、`error`，不包含集群凭据。认证始终由 Kite 管理；`useTerminal` 控制的是全局终端面板，不创建 Pod 终端会话。

`usePluginSettings` 读写的是插件在服务端保存的实例级配置，字段结构由插件自己决定，只有管理员能通过 `save()` 写入，普通用户只能读取。未配置过时 `settings` 为 `{}`。
