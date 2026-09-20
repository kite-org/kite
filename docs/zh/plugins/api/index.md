---
outline: deep
---

# 入口点

`@kite-dev/plugin-sdk` 是插件与 Kite 之间唯一的接口边界。插件的页面、菜单、资源扩展、集群状态和 Kubernetes 请求都通过它的入口点接入；Kite 的内部模块不属于稳定接口，插件不要直接 import。

| 导入路径 | 用途 | 详见 |
| -------- | ---- | ---- |
| `@kite-dev/plugin-sdk` | `definePlugin`、插件配置、manifest 与插件定义类型 | [插件配置](./plugin-config) |
| `@kite-dev/plugin-sdk/resources` | 资源查询 Hook、扩展资源上下文、写操作、工作负载 / 节点 / Pod 操作 | [资源](./resources) |
| `@kite-dev/plugin-sdk/navigation` | 插件链接、资源链接、路由跳转、路由参数、插件上下文 | [导航](./navigation) |
| `@kite-dev/plugin-sdk/ui` | UI 基础组件、资源表格、详情页骨架、事件表、编辑器 | [UI 组件](./ui) |
| `@kite-dev/plugin-sdk/hooks` | 集群、命名空间、用户、外观、收藏、终端等状态 | [Hooks](./hooks) |
| `@kite-dev/plugin-sdk/observability` | 集群概览、资源用量、Pod 指标、日志流 | [可观测性](./observability) |
| `@kite-dev/plugin-sdk/api` | 认证的 Kite API 客户端 | [API 客户端](./api-client) |
| `@kite-dev/plugin-sdk/k8s` | Kubernetes 内置资源类型（仅类型，无运行时模块） | [资源](./resources#kubernetes-类型) |
| `@kite-dev/plugin-sdk/i18n` | `createPluginI18n()`：语言字典、`label()` 与 `useTranslation()` | [国际化](../i18n) |
| `@kite-dev/plugin-sdk/vite` | `kitePlugin()` 构建配置与 `sharedModules` 清单 | [构建与校验](./build) |
| `@kite-dev/plugin-sdk/validation` | manifest / 模块校验函数与宿主菜单分组 ID | [构建与校验](./build) |

React、React Router、TanStack Query、react-i18next 与 SDK 运行时由宿主通过 Module Federation 以单例共享。`sharedModules` 列出的完整清单是：`react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom`、`react-dom/client`、`react-router-dom`、`@tanstack/react-query`、`react-i18next`，以及 8 个运行时 SDK 入口（主入口、`/resources`、`/ui`、`/navigation`、`/i18n`、`/api`、`/observability`、`/hooks`）。`/k8s` 只有类型，`/vite` 与 `/validation` 只在构建和工具链中使用，不参与运行时共享。

## 约束与限制

**权限与信任**

- 插件只有前端代码，不能注册后端 API、控制器或 operator 行为。
- 插件的所有 Kubernetes 请求都经 Kite 后端转发，按当前登录用户的 RBAC 过滤，插件不会获得额外权限。
- 插件 JavaScript 与 Kite 同源运行，属于可信代码：只有信任作者时才安装。

**运行时约束**

- 不要创建自己的 `QueryClient`、React 根或 Router。
- 插件只能调用 Kite 既有端点，不能新增接口。
- 写操作不会自动刷新查询，需要自己 `refetch()` 或失效缓存。
- 同名资源的同一种页面被多个活动插件接管时，只有活动插件列表中的第一个匹配项生效；插件被禁用、卸载、不兼容或模块加载失败时回退到通用视图。

**能力边界**

- `list`、`detail` 只能接管自定义资源整页；原生资源只能用 `columns`、`tabs` 扩展。
- 自定义资源不支持 `fieldSelector`、`reduce`、通用 PATCH 和关联资源查询，写入请用 `updateResource` 或 `applyResource`。
- 资源查询不暴露服务端分页，需要刷新时用 `refreshInterval` 轮询。
