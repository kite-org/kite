---
outline: deep
---

# Quick Start

Create a plugin project with the scaffolding tool, write a React page, then package it as a `.tar.gz` archive and install it in Kite.

## Prerequisites

- Node.js `^20.19.0 || >=22.12.0` and pnpm 10.x
- An accessible Kite instance whose version satisfies the plugin's `engines.kite` range, currently `>=0.16.0` by default
- Administrator access to install plugins

## Create a Project

```sh
pnpm create @kite-dev/plugin-sdk my-plugin
cd my-plugin
pnpm install
```

The scaffolding tool prompts for a directory and display name. You can also supply them directly:

```sh
pnpm create @kite-dev/plugin-sdk my-plugin --yes --display-name "My Plugin"
```

Generated project structure:

```text
my-plugin/
  package.json       # Plugin identity and metadata
  plugin.config.tsx  # Plugin configuration: routes and menus
  vite.config.ts     # Build configuration (calls kitePlugin())
  tsconfig.json
  README.md          # Packaged with the plugin for catalog previews
  src/
    i18n.ts          # Internationalization configuration
    locales/
      en.json
      zh.json
    pages/
      home.tsx       # Lazy-loaded page component
      home.module.css
```

Set the plugin's name, display name, and version in `package.json`. See [Plugin Identity](./api/plugin-identity) for the fields.

## Write Pages and Menus

Edit `plugin.config.tsx` to declare routes and menus:

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

- Route paths are relative to `/plugins/my-plugin`. An empty string (`''`) is the plugin home page. Paths support named parameters such as `:namespace/:name`.
- A menu's `parent` can be a built-in Kite group (`core:workloads`, `core:storage`, `core:other`, etc.). Omit it to place the menu at the top level. `route` points to a plugin route, while `resource: { group, resource }` points directly to a custom resource list. These fields are mutually exclusive; a menu with neither is a group heading.
- `routes`, `menus`, and `resources` are optional. `resources` can add list columns or detail tabs, or replace complete custom resource pages. See [Plugin Configuration: Resource Extensions](./api/plugin-config#resource-extensions).
- `element` accepts any React node. Load page components with `React.lazy(() => import(...))`, keeping CSS and browser dependencies in the page modules.
- `plugin.config.tsx` runs once in Node.js during the build to extract route and menu metadata, so its declarations cannot depend on browser globals.

In `src/pages/home.tsx`, use `useCluster()` and `useNamespace()` to access the current cluster and namespace:

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

Use `useResources()` to query Kubernetes resources. For example, count ConfigMaps across all namespaces:

```tsx
import { useResources } from "@kite-dev/plugin-sdk/resources";
import type { CoreV1 } from "@kite-dev/plugin-sdk/k8s";

export default function ConfigMapsPage() {
  const configMaps = useResources<CoreV1.ConfigMap>(
    { group: "", resource: "configmaps" },
    { namespace: "_all" },
  );

  if (configMaps.isLoading) return <p>Loading…</p>;
  if (configMaps.error) return <p role="alert">{configMaps.error.message}</p>;
  return <p>{configMaps.data?.length ?? 0} ConfigMaps</p>;
}
```

Query results are filtered by the current user's RBAC permissions. Namespaces the user cannot access are excluded.

## Build and Package

```sh
pnpm run build   # Check types and build into dist/
pnpm run pack    # Package dist/ into an archive
```

`pnpm run pack` generates `my-plugin-0.1.0.tar.gz` and prints its SHA-256 digest.

Common scripts:

| Command | Purpose |
| ------- | ------- |
| `pnpm run type-check` | Check TypeScript types |
| `pnpm run lint` / `lint:fix` | Run ESLint checks or apply fixes |
| `pnpm run format` / `format:check` | Format with Prettier or check formatting |
| `pnpm run build` | Check types and build into `dist/` |
| `pnpm run dev` | Start the development server, watch files, and print the plugin's development URL |
| `pnpm run pack` | Package the current `dist/` directory |

## Install in Kite

1. Click your avatar in the upper right corner and select **Plugin management**.
2. Click **Install from file** and select `my-plugin-0.1.0.tar.gz`.
3. The plugin is enabled automatically. Open its new menu item under **Other** in the sidebar.

During development, run `pnpm dev` and set Kite's `PLUGIN_DEV_URL` environment variable to the printed URL. After changing code, wait for the build to finish and refresh Kite. You do not need to package and install every change. See [Debugging](./debugging).

To distribute an update, increment `version` in `package.json`, run `pnpm run build && pnpm run pack`, and install the new archive. Package contents for the same ID and version are immutable. If the contents change without a version increment, Kite rejects the installation.

## Styling

Host components include their own styles. For custom layouts, use CSS Modules and Kite's CSS variables to support light and dark themes:

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

Common variables include `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, and `--border`.

Kite's Tailwind build does not scan plugin source files. Your plugin's build must generate any utility classes it uses. Scope plugin styles to avoid global resets affecting Kite.

## Next Steps

- [Plugin Configuration](./api/plugin-config): configure routes, menus, resource extensions, themes, a settings page, and internationalization
- [Resource Queries and Operations](./api/resources): read resources, perform mutations, and call Kite APIs
- [UI Components](./api/ui): reuse resource lists, detail layouts, and YAML editors
- [Internationalization](./i18n): add English and Chinese translations
- [Debugging](./debugging): local development and troubleshooting
