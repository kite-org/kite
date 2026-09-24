---
outline: deep
---

# Debugging

The plugin development server watches source files, rebuilds changes, and serves static files. Pages run inside Kite, using its actual components, current user, cluster, and API permissions.

## Start the Development Server

Run this in the plugin directory:

```sh
pnpm dev
```

After the first build, the terminal prints:

```text
Plugin URL: http://localhost:5174/plugin.json
```

In the `kite-plugins` workspace, build the SDK before starting a plugin:

```sh
pnpm --filter @kite-dev/plugin-sdk run build
pnpm --filter cert-manager dev
```

## Configure Kite

Pass the development URL to Kite as an environment variable:

```sh
PLUGIN_DEV_URL=http://localhost:5174/plugin.json ./kite
```

For Helm deployments, use the existing `extraEnvs` option:

```yaml
extraEnvs:
  - name: PLUGIN_DEV_URL
    value: http://localhost:5174/plugin.json
```

The URL must be accessible from your browser. `localhost` means the machine running the browser, not the Kite container. For remote development, forward the port to the browser's machine. You can also choose the listening address and port:

```sh
pnpm dev --host 0.0.0.0 --port 5174
```

Then update the hostname in the configuration to a development machine address your browser can reach. When Kite uses HTTPS, use a development URL that the browser allows. Remote HTTP services may be blocked as mixed content; configure HTTPS for the development server when needed.

## Edit and Refresh

1. Edit pages, styles, translations, or `plugin.config.tsx`.
2. Wait for the terminal to report a successful rebuild.
3. Refresh Kite to load the updated plugin.

Menus, routes, custom resource pages, list columns, and detail tabs use the existing plugin loading mechanism. Development plugins do not need installation and are not stored in the database. If an installed plugin has the same ID, the current Kite instance uses the development plugin instead. This setting applies to users of that Kite instance.

You do not need to increment versions during development. Restart `pnpm dev` after changing the plugin ID, version, or Vite configuration. Restart Kite after changing `PLUGIN_DEV_URL`; ordinary source changes only require a browser refresh. Remove the environment variable and restart Kite to return to installed plugins.

## Troubleshooting

- **Development URL fails to load:** open the URL printed in the terminal in your browser. Check that the server is running, the address and port are reachable, and the browser console has no loading errors.
- **Changes do not appear:** confirm the build succeeded, then refresh the entire Kite page. Switching menus does not reload modules that have already executed.
- **Build fails:** read the error in the development server's terminal. The watcher resumes building when you fix the source.
- **Plugin module or component fails:** check the browser console and page error messages. Kite's plugin error isolation still applies.

When ready to distribute the plugin, run `pnpm build` and `pnpm pack` to produce a release build and installation archive.
