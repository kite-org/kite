---
outline: deep
---

# Introduction to Plugins

Plugins are available starting with Kite **v0.16.0**.

A Kite plugin is a React frontend module that runs inside Kite. It can add pages, sidebar menus, and dedicated management interfaces for custom resources without rebuilding Kite.

Plugins are written and built with [`@kite-dev/plugin-sdk`](https://github.com/kite-org/kite-plugins/tree/main/packages/plugin-sdk), packaged as `.tar.gz` archives, and installed by a Kite administrator on the **Plugin management** page. Once installed and enabled, they are available to all signed-in users.

## What Plugins Can Do

- Register pages and routes
- Register sidebar menus
- Extend resource lists and details
- Provide custom resource pages

The [cert-manager plugin](https://github.com/kite-org/kite-plugins/tree/main/plugins/cert-manager) is a typical example. It provides management interfaces for custom resources such as Certificate, Issuer, CertificateRequest, Order, and Challenge, including resource lists, detail pages, status badges, and YAML editing.

## What Plugins Cannot Do

- Run backend code. Plugins contain only frontend modules. They cannot register new backend APIs or extend Kubernetes controller or operator behavior.

## Runtime and Security Model

Keep the following points in mind when using plugins:

1. **Plugins run as the signed-in user.** All Kubernetes requests from plugins go through the Kite backend and are subject to that user's RBAC permissions. Users cannot access resources they are not authorized to see, just as on native Kite pages. Plugins receive no additional permissions.
2. **Plugin management requires administrator access.** Installing, disabling, uninstalling, and configuring the catalog require Kite administrator permissions. Regular users can only use enabled plugins.
3. **Plugins are trusted code.** Plugin JavaScript executes in your browser with the same capabilities you have in Kite. Only install plugins from authors you trust.
4. **The runtime is shared.** Plugins and Kite share React, React Router, TanStack Query, and SDK implementations through Module Federation. This keeps plugin packages small and avoids multiple React instances.

## Installing and Using Plugins

To install a plugin:

1. Click your avatar in the upper right corner and select **Plugin management**. This option is only visible to administrators.
2. Go to **Settings → General**, enter the `catalog.json` URL under **Plugin catalog**, and save. Leave it empty to use the default catalog at `https://plugins.kitehq.dev/catalog.json`.
3. Return to **Plugin management**, select a plugin in the **Plugin catalog**, and click **Install**. Click a plugin's name to preview its README.
4. Open the plugin from the sidebar. Newly installed plugins are enabled automatically.

You can also use **Install from file** to upload a plugin's `.tar.gz` archive directly. Under **Installed plugins**, you can disable, enable, or uninstall a plugin.

## Related Repositories

| Repository                                               | Purpose                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [kite](https://github.com/kite-org/kite)                 | Host application: plugin loading, asset serving, and management APIs                             |
| [kite-plugins](https://github.com/kite-org/kite-plugins) | SDK, scaffolding tool, official plugins, and plugin catalog; the SDK is in `packages/plugin-sdk` |

## Next Steps

- [Quick Start](./quick-start): create and install a plugin from scratch
- [API Reference](./api): SDK extension points and interfaces
- [Internationalization](./i18n): support multiple languages
- [Debugging](./debugging): development workflow and troubleshooting
- [Publishing Plugins](./publishing): distribute plugins and contribute to the official repository
