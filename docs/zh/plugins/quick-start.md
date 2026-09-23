---
outline: deep
---

# 快速开始

使用脚手架创建插件项目，编写 React 页面后，打包为 `.tar.gz` 安装到 Kite。

## 前置要求

- Node.js `^20.19.0 || >=22.12.0`，pnpm 10.x
- 一个可以访问的 Kite 实例（版本需满足插件的 `engines.kite` 范围，当前默认 `>=0.16.0`）
- 管理员权限（用于安装插件）

## 创建项目

```sh
pnpm create @kite-dev/plugin-sdk my-plugin
cd my-plugin
pnpm install
```

脚手架会询问目录和显示名称，也可以直接指定：

```sh
pnpm create @kite-dev/plugin-sdk my-plugin --yes --display-name "My Plugin"
```

生成的项目结构：

```text
my-plugin/
  package.json       # 插件身份与元数据
  plugin.config.tsx  # 插件配置：路由和菜单
  vite.config.ts     # 构建配置（一行调用 kitePlugin()）
  tsconfig.json
  README.md          # 会随插件打包，用于目录预览
  src/
    i18n.ts          # 词典绑定
    locales/
      en.json
      zh.json
    pages/
      home.tsx       # 懒加载的页面组件
      home.module.css
```

在 `package.json` 中设置插件的名称、显示名称和版本，字段说明见[插件身份](./api/plugin-identity)。

## 编写页面和菜单

编辑 `plugin.config.tsx`，声明路由和菜单：

```tsx
import { lazy } from "react";
import { definePlugin } from "@kite-dev/plugin-sdk";

import { label, translations } from "./src/i18n";

const HomePage = lazy(() => import("./src/pages/home"));

export default definePlugin({
  i18n: translations,
  routes: [
    {
      id: "home",
      path: "",
      title: label("navigation.home"),
      element: <HomePage />,
    },
  ],
  menus: [
    {
      id: "home",
      parent: "core:other",
      label: label("navigation.home"),
      route: "home",
      icon: "IconBox",
    },
  ],
});
```

要点：

- 路由路径相对于 `/plugins/my-plugin`。空字符串 `''` 是插件首页；路径支持 `:namespace/:name` 这样的命名参数。
- `menus` 中的 `parent` 可以是 Kite 内置分组（`core:workloads`、`core:storage`、`core:other` 等），也可以省略形成顶级菜单。`route` 指向插件路由，`resource: { group, resource }` 直接指向 CRD 列表；两者都不带的菜单是分组标题。
- `routes`、`menus`、`resources` 均可省略。`resources` 可追加列表列、详情 Tab 或接管自定义资源页面，详见[插件配置：资源扩展](./api/plugin-config#资源扩展)。
- `element` 接收任意 React 节点。页面组件用 `React.lazy(() => import(...))` 懒加载，CSS 和浏览器依赖放在页面模块里。
- `plugin.config.tsx` 会在构建时于 Node.js 中执行一次以提取路由和菜单元数据，因此其中的声明不能依赖浏览器全局变量。

在 `src/pages/home.tsx` 中使用 `useCluster()` 和 `useNamespace()` 读取当前集群和命名空间：

```tsx
import { useCluster, useNamespace } from "@kite-dev/plugin-sdk/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kite-dev/plugin-sdk/ui";

import { useTranslation } from "../i18n";
import styles from "./home.module.css";

export default function HomePage() {
  const { currentCluster } = useCluster();
  const { namespace } = useNamespace();
  const { t } = useTranslation();

  return (
    <main className={styles.page}>
      <Card>
        <CardHeader>
          <CardTitle>{t("navigation.home")}</CardTitle>
          <CardDescription>{t("context.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className={styles.context}>
            <dt>{t("context.cluster")}</dt>
            <dd>{currentCluster ?? "—"}</dd>
            <dt>{t("context.namespace")}</dt>
            <dd>
              {namespace === "_all" ? t("context.allNamespaces") : namespace}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </main>
  );
}
```

使用 `useResources()` 查询 Kubernetes 资源，例如统计所有命名空间的 ConfigMap 数量：

```tsx
import { useResources } from "@kite-dev/plugin-sdk/resources";
import type { CoreV1 } from "@kite-dev/plugin-sdk/k8s";

export default function ConfigMapsPage() {
  const configMaps = useResources<CoreV1.ConfigMap>(
    { group: "", resource: "configmaps" },
    { namespace: "_all" },
  );

  if (configMaps.isLoading) return <p>加载中…</p>;
  if (configMaps.error) return <p role="alert">{configMaps.error.message}</p>;
  return <p>{configMaps.data?.length ?? 0} 个 ConfigMap</p>;
}
```

注意查询结果会随当前用户的 RBAC 权限自动过滤——无权访问的命名空间不会出现在结果中。

## 构建与打包

```sh
pnpm run build   # 类型检查 + 产物输出到 dist/
pnpm run pack    # 打包 dist/ 为归档
```

`pnpm run pack` 生成安装包 `my-plugin-0.1.0.tar.gz`，并打印 SHA-256 摘要。

常用脚本一览：

| 命令                               | 作用                                         |
| ---------------------------------- | -------------------------------------------- |
| `pnpm run type-check`              | TypeScript 检查                              |
| `pnpm run lint` / `lint:fix`       | ESLint 检查 / 自动修复                       |
| `pnpm run format` / `format:check` | Prettier 格式化 / 检查                       |
| `pnpm run build`                   | 类型检查并构建到 `dist/`                     |
| `pnpm run dev`                     | 启动开发服务并监听文件变更，输出开发插件地址 |
| `pnpm run pack`                    | 打包当前 `dist/`                             |

## 安装到 Kite

1. 点击右上角头像，选择 **插件管理**。
2. 点击 **从文件安装**，选择 `my-plugin-0.1.0.tar.gz`。
3. 安装完成后插件自动启用，侧边栏 **其他** 分组中出现菜单项，点击即可打开插件页面。

开发时运行 `pnpm dev`，将输出地址配置到 Kite 的 `PLUGIN_DEV_URL` 启动环境变量。修改代码并等待构建完成后，刷新 Kite 页面即可，无需反复打包安装。详见[调试](./debugging)。

发布安装包时，递增 `package.json` 中的 `version` → `pnpm run build && pnpm run pack` → 再次从文件安装。同一 ID + 版本的安装包内容不可变，内容变了就必须换版本号，否则 Kite 会拒绝安装。

## 样式

宿主组件自带样式。自定义布局请使用 CSS Modules 并引用 Kite 的 CSS 变量，这样能自动适配明暗主题：

```css
/* src/pages/home.module.css */
.panel {
  padding: 1rem;
  color: var(--card-foreground);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}
```

常用变量：`--background`、`--foreground`、`--card`、`--card-foreground`、`--primary`、`--primary-foreground`、`--muted`、`--muted-foreground`、`--border`。

注意 Kite 的 Tailwind 构建不会扫描插件源码，插件内使用的工具类需要由自己的构建生成；插件样式应限制作用域，避免全局 reset 影响 Kite。

## 下一步

- [插件配置](./api/plugin-config)：配置路由、菜单、资源扩展、主题、配置页和词典
- [资源查询与操作](./api/resources)：读取资源、执行写操作和调用 Kite API
- [UI 组件](./api/ui)：复用资源列表、详情页和 YAML 编辑器
- [国际化](./i18n)：完善中英文词典
- [调试](./debugging)：本地开发与问题排查
