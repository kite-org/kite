---
outline: deep
---

# Publishing Plugins

A built and packaged plugin is a `.tar.gz` archive. You can distribute it however you need: install it directly, host your own catalog, or contribute it to the official [kite-plugins](https://github.com/kite-org/kite-plugins) repository.

## Version Rules

- Use a semantic version **without a `v` prefix**, such as `0.1.3`.
- **Package contents are immutable for a given ID and version.** Kite stores assets by their SHA-256 digest. Any content change, even a single string, requires a version increment or Kite will reject the installation.
- `engines.kite` defines the supported Kite version range. Kite checks it during installation and when displaying the catalog.

## README

The plugin's root `README.md` is automatically copied into `dist/` and included in the archive. When distributing through a catalog, users can preview this README in Kite. Use full repository URLs for README links to files that are not included in the package.

## Private Distribution

### Direct Installation

Upload the `.tar.gz` file through **Plugin management → Install from file**. This works well for internal use and sharing with a small group. The archive size limit is 50 MiB.

### Host a Static Catalog

Generate static files for the plugin catalog:

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

Upload `dist/catalog/` to any HTTP(S) static host, then enter the `catalog.json` URL in Kite under **Settings → General → Plugin catalog**. To host archives separately from the catalog:

```sh
pnpm run catalog \
  --base-url https://plugins.example.com/ \
  --package-base-url https://downloads.example.com/plugins/
```

Upload `packages/` first, then publish `catalog.json` and `readmes/`.

## Contribute to the kite-plugins Repository

The official [kite-org/kite-plugins](https://github.com/kite-org/kite-plugins) repository is a pnpm workspace. It publishes the official catalog through GitHub Releases, with GitHub Pages and EdgeOne hosting two catalog endpoints:

| Catalog      | URL                                                                |
| ------------ | ------------------------------------------------------------------ |
| GitHub Pages | `https://kite-org.github.io/kite-plugins/catalog.json`             |
| EdgeOne      | `https://plugins.kitehq.dev/catalog.json` (Kite's default catalog) |

### Add a Plugin

Fork and clone the repository, then run the scaffolding tool from its root. The directory name becomes the plugin ID:

```sh
pnpm create @kite-dev/plugin-sdk plugins/my-plugin
pnpm install
```

Develop and validate the plugin:

```sh
pnpm --filter my-plugin run dev     # Watch a single plugin
pnpm run type-check                 # Type-check all plugins
pnpm run lint                       # ESLint
pnpm run format:check               # Prettier
pnpm run build                      # Build all plugins
```

Before submitting a PR, check that the plugin ID is unique and valid, the version follows semver, the English and Chinese dictionary keys match, and the README includes usage instructions. CI runs lint, formatting, and catalog build checks on pull requests.
