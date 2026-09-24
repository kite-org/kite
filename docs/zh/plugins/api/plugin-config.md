---
outline: deep
---

# 插件配置

在 `plugin.config.tsx` 中通过 `definePlugin()` 声明插件的路由、菜单、资源扩展、主题、配置页和词典。

所有配置项均可省略，`routes`、`menus`、`resources` 和 `themes` 默认为空数组。

| 配置项 | 用途 |
| ------ | ---- |
| [`routes`](#路由) | 注册插件页面和路由 |
| [`menus`](#菜单) | 注册侧边栏菜单和分组 |
| [`resources`](#资源扩展) | 添加列表列、详情 Tab 或接管 CRD 页面 |
| [`themes`](#主题) | 提供配色主题 |
| [`settings`](#配置页) | 提供管理员配置页 |
| [`i18n`](#国际化) | 注册插件词典 |

## 路由

注册插件首页和带命名空间、名称参数的详情页：

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

为 ID 为 `my-plugin` 的插件添加“证书管理”分组，并在分组下放置 Certificate 列表菜单：

安装示例使用的图标库：

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

- `id`、`label` 必填：ID 在插件内唯一，格式与路由 ID 相同；标签支持本地化。
- `route` 指向一个无需必填参数即可打开的插件路由；`resource: { group, resource }` 直接指向某个自定义资源的列表页，由 `resources` 中的页面定义接管，无需额外注册路由。两者互斥，都不带的菜单是分组标题。
- `parent` 决定菜单位置：

| `parent` 取值 | 位置 |
| ------------- | ---- |
| 省略 | 侧边栏顶级菜单或分组 |
| `core:workloads` 等 | Kite 内置分组内 |
| `my-plugin:tools` | 本插件中 ID 为 `tools` 的分组内 |

内置分组 ID 为 `core:application`、`core:workloads`、`core:traffic`、`core:storage`、`core:config`、`core:security`、`core:other`，可从 `/validation` 导入 `coreMenuGroupIds`。

菜单父级只能是内置分组或同一插件声明的分组，不允许成环；作为父级的分组菜单自身不能带 `route` 或 `resource`。`order` 设置默认排序（菜单项默认 `50`，用户侧边栏偏好优先）。

`icon` 接受 React 元素或内置图标名称。可直接使用 `@tabler/icons-react`、`lucide-react` 等图标库，也可以传入自定义组件。图标库由插件自行安装，使用的图标会随插件打包。

自定义组件需将 `className` 传给实际的图标元素，并使用 `currentColor` 继承菜单颜色。例如，为第三方图标调整线条粗细：

```tsx
import { IconCertificate } from '@tabler/icons-react'

function CertificateIcon({ className }: { className?: string }) {
  return <IconCertificate className={className} stroke={1.5} />
}
```

在菜单中设置 `icon: <CertificateIcon />` 即可使用。自定义图标在菜单显示时加载，在侧边栏、配置侧边栏和全局搜索的菜单入口中使用相同的图标。顶级分组标题不显示图标。

也可以直接填写以下内置图标名称，例如 `icon: 'IconShieldCheck'`。未指定或使用未内置的 `Icon...` 名称时，使用 `IconBox`：

```text
IconBox           IconRocket           IconStack2        IconTopologyBus  IconPackage
IconPlayerPlay    IconClockHour4       IconRouter        IconShield       IconNetwork
IconLoadBalancer  IconRoute            IconFileDatabase  IconDatabase     IconMap
IconLock          IconArrowsHorizontal IconUser          IconUsers        IconShieldCheck
IconKey           IconBoxMultiple      IconServer2       IconBell         IconCode
```

`definePlugin` 会从内联声明推断路由 ID 的字面量类型，并校验 `menus.route` 的取值；如果把路由数组提取成变量，需要加 `as const` 保留字面量类型。

## 资源扩展

通过 `plugin.config.tsx` 的 `resources` 配置，为 Kite 的资源列表添加列、为详情页添加 Tab，或替换某种 CRD 的完整页面。查询和修改资源数据见[资源查询与操作](./resources)。

`resources` 中的每一项用 `group`（API 组）和 `resource`（复数资源名）定位一种资源，类型是 `PluginResourceView<T>`。核心 API 组用空字符串，例如 Pod 是 `{ group: '', resource: 'pods' }`，StorageClass 是 `{ group: 'storage.k8s.io', resource: 'storageclasses' }`；API 组按格式校验，不限制 `k8s.io` 这类后缀。

| 字段 | 类型 | 作用 |
| ---- | ---- | ---- |
| `group`、`resource` | `string` | 必填，共同组成唯一的资源目标 |
| `columns` | `PluginResourceColumn<T>[]` | 向宿主列表追加列 |
| `tabs` | `PluginResourceTab[]` | 向宿主详情页追加 Tab |
| `list` | `ReactNode` | 接管自定义资源的完整列表页 |
| `detail` | `ReactNode` | 接管自定义资源的完整详情页 |

四种扩展至少提供一种，且同一插件内不能重复声明相同的资源目标。宿主按需加载插件模块：列可见时加载，Tab 被选中时加载，接管页面在访问时加载。`columns`、`tabs` 对原生资源和通用 CR 页面都生效；`list`、`detail` 只接管自定义资源整页，不会替换原生资源页面。

### 添加列表列

给 Pod 列表增加 Team 列，显示资源的 `team` 标签：

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

`PluginResourceColumn<T, TValue>` 从 SDK 根入口导入，`T` 是资源类型，`TValue` 是列值类型（默认 `unknown`）。

| 字段 | 说明 |
| ---- | ---- |
| `id`、`header` | 必填；ID 在该资源的列中唯一，标题支持本地化标签 |
| `accessorFn` / `accessorKey` | 读取用于显示、排序和搜索的值，两者互斥；`accessorKey` 支持 `metadata.labels.team` 这类点路径 |
| `cell` | TanStack Table 单元格渲染接口，`row.original` 是当前资源；需要 Hook 时渲染独立的 React 组件 |
| `size`、`minSize`、`maxSize` | 列宽及其范围 |
| `enableSorting`、`sortingFn` | 控制排序；有 accessor 的列默认参与排序，`sortingFn` 可用 TanStack 内置名称（`auto`、`text`、`alphanumeric`、`datetime` 等）或自定义函数 |
| `sortDescFirst`、`sortUndefined`、`invertSorting` | 首次排序方向、空值位置（默认排在最后）和反向排序 |
| `enableHiding`、`defaultHidden` | 是否允许隐藏、是否默认隐藏；已有用户显隐偏好优先 |
| `order` | 插件列之间的默认顺序，默认 `0`，相同取值按 ID 排序；插件列统一追加在宿主列之后 |

只要存在可见的插件列，宿主列表请求（包括开启 watch 时）就会拉取完整资源对象，因此单元格可以直接读取当前行，不需要再次请求同一资源。文本搜索会匹配当前可见列的取值（含插件列 accessor 的返回值），标签选择器仍由后端处理。accessor 建议返回字符串、数字或布尔值。

### 添加详情 Tab

给 Pod 详情页增加“策略”Tab：

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

`PluginResourceTab` 从 SDK 根入口导入：

| 字段 | 说明 |
| ---- | ---- |
| `id` | 必填，在该资源的 Tab 中唯一 |
| `label` | 必填，本地化标签 |
| `element` | 必填，任意 React 节点 |
| `order` | 可选，默认 `0`，相同取值按 ID 排序 |

插件 Tab 追加在宿主 Tab 之后，用户排序与显隐偏好优先。

在列或 Tab 组件中读取当前资源和触发刷新，见[读取扩展中的当前资源](./resources#读取扩展中的当前资源)。

### 接管 CRD 列表和详情

`list`、`detail` 接收实际的 React 节点。只提供其中一项时，另一页仍使用 Kite 的通用视图。无需声明插件路由，菜单也可以直接指向该 CRD：

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

接管页面自行通过资源 Hook 请求数据，详情页用 `useParams()` 读取 `name` 和 `namespace`。菜单、CRD 浏览器和页面内链接使用同一套 CRD URL，见[打开资源页面](./navigation#打开资源页面)。表格、详情页和 YAML 编辑器可以复用 [UI 组件](./ui)。

多个活动插件接管同一资源的同一种页面时，只有活动插件列表中的第一个匹配项生效。插件被禁用、卸载、不兼容或模块加载失败时，Kite 回退到通用视图。

### 扩展的标识与深链

宿主会给扩展 ID 加插件前缀，例如 `plugin:my-plugin:column:team`、`plugin:my-plugin:tab:policy`。这些 ID 不含版本号，因此升级插件不会丢失用户偏好；详情页可以用 `?tab=plugin:my-plugin:tab:policy` 直接选中该 Tab，值在页面上不存在时回退到第一个可见 Tab。

例如，打开 `default` 命名空间中名为 `demo` 的 Pod，并选中 `my-plugin` 提供的“策略”Tab：

```text
/pods/default/demo?tab=plugin:my-plugin:tab:policy
```

列和 Tab 扩展作用于使用宿主资源表格与详情页组件的页面；插件自己渲染的 `ResourceTable`、`ResourceDetailShell` 不会自动插入其他插件的内容。插件列或 Tab 的加载、渲染错误只影响对应的扩展区域。

## 主题

插件可以提供配色主题。一个主题就是一份样式表，用来覆盖 Kite 的 CSS 变量，因此一份文件就能同时改变所有页面、YAML 编辑器和终端的配色。

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

配置是实例级的：管理员配置一次，所有用户共享；读取对所有登录用户开放，写入只有管理员可以。保存成功后宿主会给出统一提示。单次提交的 JSON 不超过 16 KiB，未配置过时 `settings` 是空对象，插件应当处理"尚未配置"的情况。卸载插件时会连带删除它的配置。

## 国际化

`i18n` 可选，接收插件的中英文词典。通常将 `createPluginI18n()` 返回的 `resources` 命名为 `translations`，再传入配置：

```tsx
import { definePlugin } from '@kite-dev/plugin-sdk'

import { translations } from './src/i18n'

export default definePlugin({
  i18n: translations,
})
```

声明菜单、路由或 Tab 标签时使用同一模块的 `label()`；页面组件通过 `useTranslation()` 读取文案，随 Kite 的语言切换更新。词典结构、绑定方式和完整示例见[国际化指南](../i18n)。
