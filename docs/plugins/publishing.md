---
outline: deep
---

# Publishing Plugins

Plugins are packaged as `.tar.gz` archives. Distribute them directly, publish to npm, host your own catalog, or publish through the official [kite-plugins](https://github.com/kite-org/kite-plugins) repository.

## Version Rules

- Use a **semantic version without a `v` prefix**, such as `0.1.3`.
- **Package contents for the same ID and version are immutable.** Kite stores assets by their SHA-256 digest. Any content change, even a single string, requires a version increment; otherwise, Kite rejects the installation.
- `engines.kite` specifies the Kite versions the plugin supports. Only stable releases (`X.Y.Z` or `vX.Y.Z`) enforce this range during installation and when displaying the catalog. Development, prerelease, and other non-release builds skip Kite version matching. All builds still check SDK compatibility.

## README

The plugin's root `README.md` is copied into `dist/` and included in the archive. When distributed through a catalog, Kite can preview this README. Use full repository URLs for links to files that are not included in the package.

## Publish to npm

In your plugin project's `package.json`, remove `"private": true` and include the build output:

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "files": ["dist"],
  "keywords": ["kite-plugin"]
}
```

Keep the project's other fields and scripts. Build and publish to the public npm registry:

```sh
pnpm run build
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

The published package must contain `dist/plugin.json` and all assets referenced by it. Kite also accepts `plugin.json` and its assets directly at the npm package root. The npm package version must match `plugin.json`'s version. Kite downloads built assets without running npm scripts or installing dependencies.

Packages with the `kite-plugin` keyword are discoverable in Kite's plugin catalog after npm indexes them. Community results appear after catalog entries; a check marks catalog-listed plugins. The keyword is not a safety or compatibility certification. Community discovery queries npmjs directly from your browser, and search filters the results locally. Installation and update downloads still run on the Kite server.

In **Plugin management → Install from npm**, enter the package name and select **npmjs** or **npmmirror**. Kite installs the `latest` version and enables it automatically. Both unscoped and scoped names (`@scope/my-plugin`) are supported; the manifest's plugin ID must still follow Kite's ID rules. The current SDK derives that ID from the build project's name, so scoped npm publishing requires a separate publishing `package.json` with the scoped name and matching version, alongside the built assets.

To update, increment the version, rebuild, and publish. Kite checks for npm updates when you open **Installed plugins** or click its refresh button. Click **Update** to install the displayed version while preserving the plugin's enabled state. The server identifies the package name and registry from the saved npmjs or npmmirror download URL. The browser checks each package directly against its installation registry, with independent requests and timeouts. npmmirror may take time to synchronize a newly published version.

See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) for publishing options and [npmmirror](https://npmmirror.com/) for mirror details.

## Private Distribution

### Direct Installation

Upload the `.tar.gz` archive through **Plugin management → Install from file**. This works for internal use and small groups. The archive limit is 50 MiB.

### Host a Static Catalog

Generate static files for a plugin catalog:

```sh
pnpm run catalog --base-url https://plugins.example.com/
```

Output:

```text
dist/catalog/
├── catalog.json          # Catalog index: metadata, versions, download URLs, SHA-256
├── packages/             # Plugin archives
└── readmes/              # README preview files
```

Upload `dist/catalog/` to any HTTP(S) static host, then enter the `catalog.json` URL under **Settings → General → Plugin catalog** in Kite. To host archives separately from the catalog:

```sh
pnpm run catalog \
  --base-url https://plugins.example.com/ \
  --package-base-url https://downloads.example.com/plugins/
```

Upload `packages/` first, then publish `catalog.json` and `readmes/`.

## Publish to the Official Catalog

Submit a completed plugin to [kite-org/kite-plugins](https://github.com/kite-org/kite-plugins). Once reviewed and merged, it can be published to the official catalog.

1. Fork and clone the repository.
2. Place the plugin source in `plugins/<plugin ID>/`, with the directory name matching `name` in `package.json`. Include a `README.md` describing the plugin's features and usage. Do not commit `dist/` or installation archives.
3. Run `pnpm install` at the repository root, then submit a PR with the plugin source and updated `pnpm-lock.yaml`.

After the PR is merged into `main`, the publishing workflow builds unpublished plugin versions and updates these catalogs:

| Catalog | URL |
| ------- | --- |
| GitHub Pages | `https://kite-org.github.io/kite-plugins/catalog.json` |
| EdgeOne | `https://plugins.kitehq.dev/catalog.json` (Kite's default catalog) |
