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

`routes`、`menus`、`resources`、`themes` 均可省略，`definePlugin` 会把省略的字段填成空数组。它会从内联声明推断路由 ID 的字面量类型，并校验 `menus.route` 的取值；如果把路由数组提取成变量，需要加 `as const` 保留字面量类型。词典绑定和 `label()` 的用法见[国际化](../i18n)。

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

## 主题

插件可以提供配色主题。一个主题就是一份样式表，用来覆盖 Kite 的 CSS 变量，因此一份文件就能同时改变所有页面、YAML 编辑器和终端的配色。

```tsx
export default definePlugin({
  themes: [
    {
      id: 'nord',
      label: { en: 'Nord', zh: 'Nord 暗色' },
      styles: ['themes/nord.css'],
    },
  ],
})
```

| 字段    | 说明                                                                                       |
| ------- | ------------------------------------------------------------------------------------------ |
| `id`    | 主题 ID，插件内唯一。只能使用小写字母、数字和连字符，并且以字母或数字开头和结尾。           |
| `label` | 可选，主题选择器中显示的名称，省略时使用 ID；支持本地化标签。                              |
| `styles` | 一份或多份样式表路径，必须打包进插件包。                                                  |

样式表建议放在 `public/` 下，构建时会原样复制进归档，`styles` 中填写同样的相对路径。主题插件不需要声明路由、菜单或资源；三者都不声明时插件的 JavaScript 不会被加载，只会使用样式表。

已启用插件提供的主题会出现在用户菜单的 **Color Theme** 中，按插件名分组。只有选中该主题时 Kite 才加载对应样式表，因此样式表可以直接写 `:root` 和 `.dark`：

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

`ui/src/styles/themes/default.css` 中定义的变量都可以覆盖，未覆盖的沿用默认值。主题生效期间 Kite 还会在根节点加上 `color-<插件 ID>-<主题 ID>` 类，需要限定作用域时可以只用这个类。样式表中的相对 `url()` 会解析到插件包内的文件，随插件分发的图片和字体都可以正常引用：

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background: url('./aurora.webp') center / cover no-repeat;
}
```

带背景图的主题通常还需要把承载面改成半透明（`--background`、`--card`、`--popover`、`--sidebar`），否则内容区会被不透明的色块盖住。

## 配置页

插件可以声明一个配置页，让管理员在 **插件管理 → 已安装插件** 的该插件行里看到 **配置** 按钮，点开是一个由插件自己渲染的弹窗：

```tsx
import { lazy } from 'react'

const Settings = lazy(() => import('./src/settings'))

export default definePlugin({
  settings: {
    label: label('settings.title'),
    element: <Settings />,
  },
})
```

`label` 可选，省略时用插件名作为弹窗标题；`element` 是任意 React 节点，`plugin.config.tsx` 里要用 `React.lazy` 引入。没有声明 `settings` 的插件不会显示这个按钮。

配置本身存在 Kite 的后端数据库里，字段结构完全由插件决定，通过 `usePluginSettings()` 读写：

```tsx
import { useState } from 'react'
import { usePluginSettings } from '@kite-dev/plugin-sdk/hooks'
import { Button, Input, Label } from '@kite-dev/plugin-sdk/ui'

export default function Settings() {
  const { settings, isLoading, isSaving, save } = usePluginSettings<{
    grafanaUrl?: string
  }>()
  const [url, setUrl] = useState('')

  if (isLoading) return null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="grafana-url">Grafana URL</Label>
        <Input
          id="grafana-url"
          value={url || settings?.grafanaUrl || ''}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <Button
        disabled={isSaving}
        onClick={() => void save({ grafanaUrl: url })}
      >
        Save
      </Button>
    </div>
  )
}
```

配置是实例级的：管理员配置一次，所有用户共享；读取对所有登录用户开放，写入只有管理员可以。保存成功后宿主会给出统一提示。单次提交的 JSON 不超过 16 KiB，未配置过时 `settings` 是空对象，插件应当处理"尚未配置"的情况。卸载插件时会连带删除它的配置。
