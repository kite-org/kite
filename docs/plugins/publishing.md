---
outline: deep
---

# Publishing Plugins

Plugins are packaged as `.tar.gz` archives. Distribute them directly, host your own catalog, or publish through the official [kite-plugins](https://github.com/kite-org/kite-plugins) repository.

## Version Rules

- Use a **semantic version without a `v` prefix**, such as `0.1.3`.
- **Package contents for the same ID and version are immutable.** Kite stores assets by their SHA-256 digest. Any content change, even a single string, requires a version increment; otherwise, Kite rejects the installation.
- `engines.kite` specifies the Kite versions the plugin supports. Only stable releases (`X.Y.Z` or `vX.Y.Z`) enforce this range during installation and when displaying the catalog. Development, prerelease, and other non-release builds skip Kite version matching. All builds still check SDK compatibility.

## README

The plugin's root `README.md` is copied into `dist/` and included in the archive. When distributed through a catalog, Kite can preview this README. Use full repository URLs for links to files that are not included in the package.

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
