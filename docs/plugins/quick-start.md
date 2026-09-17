---
outline: deep
---

# Quick Start

This page walks through creating a Kite plugin from scratch: scaffold a project, write a page, build and package it, and install it in Kite.

## Prerequisites

- Node.js `^20.19.0 || >=22.12.0` and pnpm 10.x
- An accessible Kite instance whose version satisfies the plugin's `engines.kite` range, currently `>=0.16.0` by default
- Administrator access to install the plugin

## Create a Project

```sh
pnpm create @kite-dev/plugin-sdk my-plugin
cd my-plugin
pnpm install
```

The scaffolding tool asks for a directory and display name. You can also specify them directly:

```sh
pnpm create @kite-dev/plugin-sdk my-plugin --yes --display-name "My Plugin"
```

The generated project has this structure:

```text
my-plugin/
  package.json       # Plugin identity and metadata
  plugin.config.tsx  # Plugin configuration: routes and menus
  vite.config.ts     # Build configuration: a call to kitePlugin()
  tsconfig.json
  README.md          # Included in the package for catalog previews
  src/
    i18n.ts          # Translation dictionary bindings
    locales/
      en.json
      zh.json
    pages/
      home.tsx       # Lazily loaded page component
      home.module.css
```

## Configure Plugin Identity

The plugin ID and metadata come from `package.json`. You do not need to write `plugin.json` yourself; it is generated during the build:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "My first Kite plugin",
  "author": "Your Team",
  "license": "Apache-2.0",
  "engines": {
    "kite": ">=0.16.0"
  }
}
```

| Field | Description |
| ----- | ----------- |
| `name` | Plugin ID, also used in URLs. Use 1–64 lowercase letters, digits, or hyphens, starting and ending with a letter or digit. Do not use an npm scope |
| `displayName` | Name shown in plugin management, between 1 and 128 characters |
| `version` | Semantic version without a `v` prefix. Increment it whenever the package contents change |
| `engines.kite` | Supported Kite version range. Defaults to `>=0.16.0` when omitted and is written to `requires.kite` in `plugin.json` during the build |
| `description` / `author` / `homepage` / `license` | Optional metadata |

## Write a Page and Menu

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

Key points:

- Route paths are relative to `/plugins/my-plugin`. An empty string, `''`, is the plugin's home page. Paths support named parameters such as `:namespace/:name`.
- A menu's `parent` can be a built-in Kite group such as `core:workloads`, `core:storage`, or `core:other`. Omit it to create a top-level menu. `route` points to a plugin route; `resource: { group, resource }` points directly to a custom resource list. A menu with neither is a group heading.
- `routes`, `menus`, and `resources` are all optional. `resources` can add list columns or detail tabs, or provide custom resource pages. See [API Reference: Resource Extensions](./api#resource-extensions).
- `element` accepts any React node. Load page components with `React.lazy(() => import(...))`, and keep CSS and browser dependencies in the page module.
- `plugin.config.tsx` runs once in Node.js during the build to extract route and menu metadata, so its declarations must not depend on browser globals.

The generated `src/pages/home.tsx` demonstrates basic host integration by reading the current cluster and namespace:

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

To try the resource hooks, write a page that queries resources:

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

Query results are automatically filtered by the current user's RBAC permissions. Namespaces the user cannot access are excluded.

## Build and Package

```sh
pnpm run build   # Type-check and build into dist/
pnpm run pack    # Package dist/ as an archive
```

The `pack` script runs `kite-plugin pack`, creates `my-plugin-0.1.0.tar.gz`, and prints its SHA-256 digest. The archive contains the contents of `dist/` at its root, including the generated `plugin.json`, Federation entry, JavaScript chunks, styles, and README. There is no enclosing directory.

Common scripts:

| Command | Purpose |
| ------- | ------- |
| `pnpm run type-check` | Run TypeScript checks |
| `pnpm run lint` / `lint:fix` | Run ESLint checks or apply fixes |
| `pnpm run format` / `format:check` | Format with Prettier or check formatting |
| `pnpm run build` | Type-check and build into `dist/` |
| `pnpm run dev` | Start the development server, watch for changes, and print the development plugin URL |
| `pnpm run pack` | Package the current `dist/` contents |

## Install in Kite

1. Click your avatar in the upper right corner and select **Plugin management**.
2. Click **Install from file** and select `my-plugin-0.1.0.tar.gz`.
3. The plugin is enabled automatically after installation. Its menu appears in the sidebar's **other** group. Click it to open the plugin page.

During development, run `pnpm dev` and pass the printed URL to Kite through the `PLUGIN_DEV_URL` startup environment variable. After changing code and waiting for the build to finish, refresh the Kite page. You do not need to repeatedly package and install the plugin. See [Debugging](./debugging).

To publish an updated package, increment `version` in `package.json`, run `pnpm run build && pnpm run pack`, and install the new file. Package contents are immutable for a given ID and version. If the contents change, you must use a new version number or Kite will reject the installation.

## Styling

Host components include their own styles. For custom layouts, use CSS Modules and Kite's CSS variables to support both light and dark themes:

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

Kite's Tailwind build does not scan plugin source code. Your plugin's build must generate any utility classes it uses. Scope plugin styles to avoid global resets affecting Kite.

## Next Steps

- [API Reference](./api): routes, menus, resource queries, mutations, UI components, and other extension points
- [Internationalization](./i18n): complete the English and Chinese dictionaries
- [Debugging](./debugging): set up an efficient development workflow
