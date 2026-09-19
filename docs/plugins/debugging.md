---
outline: deep
---

# Debugging

The plugin development server watches source files, rebuilds the plugin, and serves static assets. Pages run inside Kite, using its actual components, signed-in user, cluster, and API permissions.

## Start the Development Server

Run this command in the plugin directory:

```sh
pnpm dev
```

After the first build, the terminal prints:

```text
Plugin URL: http://localhost:5174/plugin.json
```

In the `kite-plugins` workspace, build the SDK first, then start the plugin:

```sh
pnpm --filter @kite-dev/plugin-sdk run build
pnpm --filter cert-manager dev
```

## Configure Kite

Pass the development URL to Kite as an environment variable:

```sh
PLUGIN_DEV_URL=http://localhost:5174/plugin.json ./kite
```

For Helm deployments, use the existing `extraEnvs` setting:

```yaml
extraEnvs:
  - name: PLUGIN_DEV_URL
    value: http://localhost:5174/plugin.json
```

Kite passes this URL to the browser, which fetches the plugin manifest and static assets directly. The URL must be reachable from the browser. `localhost` refers to the machine running the browser, not the Kite container. For remote development, you can forward the development server's port to the browser's machine. You can also specify a listening address and port:

```sh
pnpm dev --host 0.0.0.0 --port 5174
```

Then update the configured hostname to a development machine address the browser can reach. If Kite uses HTTPS, use a development URL that the browser allows it to access. Remote HTTP services may be blocked as mixed content; configure HTTPS for the development server when needed.

## Make Changes and Refresh

1. Edit pages, styles, translations, or `plugin.config.tsx`.
2. Wait for the terminal to report that the rebuild has finished.
3. Refresh the Kite page to load the latest manifest and code.

Menus, routes, custom resource pages, list columns, and detail tabs all load through the existing plugin system. Development plugins do not need to be installed and are not written to the database. If an installed plugin has the same ID, the current Kite instance uses the development plugin instead. This setting affects users accessing that Kite instance.

You do not need to increment the version during development. Restart `pnpm dev` after changing the plugin ID, version, or Vite configuration. Restart Kite after changing `PLUGIN_DEV_URL`; for ordinary plugin source changes, refreshing the browser is enough. Remove the environment variable and restart Kite to resume loading installed plugins.

## Troubleshooting

- **The development URL fails to load:** open the printed `plugin.json` URL in your browser and check that the server is running and its address and port are reachable. Kite logs development manifest loading errors in the browser console.
- **Changes do not appear:** confirm that the build succeeded, then refresh the entire Kite page. Switching menus alone does not reload modules that have already executed.
- **The build fails:** check the development server's terminal output. The watcher continues rebuilding after you fix the source.
- **A plugin module or component fails:** check the browser console and the error shown on the page. Development plugins use Kite's existing error isolation.

When ready to distribute the plugin, run `pnpm build` and `pnpm pack` to create a production build and installation archive.
