---
outline: deep
---

# 发布插件

插件构建打包后就是一个 `.tar.gz` 归档，分发方式完全取决于你的需求：直接安装、自建 catalog，或提交到官方 [kite-plugins](https://github.com/kite-org/kite-plugins) 仓库。

## 版本规则

- 版本号是**不带 `v` 前缀**的语义化版本（如 `0.1.3`）。
- **同一 ID + 版本对应不可变的包内容**。Kite 按内容 SHA-256 存储资产，任何内容变更——哪怕只改了一个字符串——都必须递增版本号，否则 Kite 拒绝安装。
- `engines.kite` 决定插件可安装的 Kite 版本范围，安装和目录展示时都会校验。

## README

插件根目录的 `README.md` 会自动复制进 `dist/` 并包含在归档中。catalog 分发时，Kite 的插件目录可以在线预览这份 README。README 中指向未随包分发文件的链接请使用完整的仓库 URL。

## 私有分发

### 直接安装

在 **插件管理 → 从文件安装** 上传 `.tar.gz`。适合内部使用和小范围共享。归档上限 50 MiB。

### 自建静态 catalog

为插件目录生成可托管的静态文件：

```sh
pnpm run catalog --base-url https://plugins.example.com/
```

产出：

```text
dist/catalog/
├── catalog.json          # 目录索引：元数据、版本、下载 URL、SHA-256
├── packages/             # 各插件归档
└── readmes/              # README 预览文件
```

把 `dist/catalog/` 上传到任意 HTTP(S) 静态主机，然后在 Kite **设置 → 通用 → 插件目录** 中填入 `catalog.json` 地址。归档与 catalog 分开托管时：

```sh
pnpm run catalog \
  --base-url https://plugins.example.com/ \
  --package-base-url https://downloads.example.com/plugins/
```

先上传 `packages/`，再发布 `catalog.json` 和 `readmes/`。

## 提交到 kite-plugins 仓库

官方仓库 [kite-org/kite-plugins](https://github.com/kite-org/kite-plugins) 是一个 pnpm workspace，通过 GitHub Releases + Pages + EdgeOne 双端点发布官方目录：

| 目录         | 地址                                                         |
| ------------ | ------------------------------------------------------------ |
| GitHub Pages | `https://kite-org.github.io/kite-plugins/catalog.json`       |
| EdgeOne      | `https://kite-plugins.zzde.me/catalog.json`（Kite 默认目录） |

### 添加插件

Fork 并 clone 仓库，从根目录运行脚手架（目录名即插件 ID）：

```sh
pnpm create @kite-dev/plugin-sdk plugins/my-plugin
pnpm install
```

开发与验证：

```sh
pnpm --filter my-plugin run dev     # watch 单个插件
pnpm run type-check                 # 全部插件类型检查
pnpm run lint                       # ESLint
pnpm run format:check               # Prettier
pnpm run build                      # 全部插件构建
```

提交 PR 前确保：插件 ID 唯一且符合规范、版本为合法 semver、中英文词典键对齐、README 包含面向用户的使用说明。CI 会在 PR 上运行 lint、格式化和 catalog 构建校验。
