---
outline: deep
---

# 插件配置

`plugin.config.tsx` 是插件唯一的声明式入口，同时被构建期（提取 manifest）和浏览器（插件入口）使用。

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

`routes`、`menus`、`resources` 均可省略，`definePlugin` 会把省略的字段填成空数组。它会从内联声明推断路由 ID 的字面量类型，并校验 `menus.route` 的取值；如果把路由数组提取成变量，需要加 `as const` 保留字面量类型。词典绑定和 `label()` 的用法见[国际化](../i18n)。

::: warning
`plugin.config.tsx` 在构建时会在 Node.js 中执行一次，用来提取导航和资源扩展元数据；同一份文件也是浏览器入口。路由、菜单、资源扩展声明不能依赖浏览器全局或用户状态，页面和 Tab 组件请用 `React.lazy` 引入。
:::

## 路由

- `id`：路由 ID，插件内唯一。必须由字母或数字开头，可含字母、数字、下划线、连字符。
- `path`：相对 `/plugins/<插件 ID>` 的路径，不能以 `/` 开头，也不能包含 `\` 或 `.`、`..` 段；空字符串是插件首页，支持命名参数（`:name`）、可选参数（`:name?`）和尾部 `*`。
- `title`：可选页面标题，支持本地化标签。
- `element`：必填，任意 React 节点，每个路由渲染一个完整页面。

参数名不同的同形路径（例如 `deployments/:namespace/:name` 与 `deployments/:ns/:name`）视为冲突，不能同时声明。

| 路由 path | 实际 URL |
| --------- | -------- |
| `''` | `/plugins/my-plugin` |
| `deployments/:namespace/:name` | `/plugins/my-plugin/deployments/default/demo` |

## 菜单

- `id`、`label` 必填：ID 在插件内唯一，格式与路由 ID 相同；标签支持本地化。
- `route` 指向一个无需必填参数即可打开的插件路由；`resource: { group, resource }` 直接指向某个自定义资源的列表页，由 `resources` 中的页面定义接管，无需额外注册路由。两者互斥，都不带的菜单是分组标题。
- `parent` 决定菜单位置：

| `parent` 取值 | 位置 |
| ------------- | ---- |
| 省略 | 侧边栏顶级菜单或分组 |
| `core:workloads` 等 | Kite 内置分组内 |
| `my-plugin:tools` | 本插件中 ID 为 `tools` 的分组内 |

内置分组 ID 为 `core:application`、`core:workloads`、`core:traffic`、`core:storage`、`core:config`、`core:security`、`core:other`，可从 `/validation` 导入 `coreMenuGroupIds`。

菜单父级只能是内置分组或同一插件声明的分组，不允许成环；作为父级的分组菜单自身不能带 `route` 或 `resource`。`order` 设置默认排序（菜单项默认 `50`，用户侧边栏偏好优先）；`icon` 接受宿主图标名（如 `IconBox`、`IconPackage`），未知名称回退默认图标。
