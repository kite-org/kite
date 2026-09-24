---
outline: deep
---

# 发布插件

插件打包为 `.tar.gz` 安装包，支持直接分发、自建 catalog，或通过官方 [kite-plugins](https://github.com/kite-org/kite-plugins) 仓库发布。

## 版本规则

- 版本号是**不带 `v` 前缀**的语义化版本（如 `0.1.3`）。
- **同一 ID + 版本对应不可变的包内容**。Kite 按内容 SHA-256 存储资产，任何内容变更——哪怕只改了一个字符串——都必须递增版本号，否则 Kite 拒绝安装。
- `engines.kite` 决定插件可安装的 Kite 版本范围。仅正式版本（`X.Y.Z` 或 `vX.Y.Z`）在安装和目录展示时校验该范围；开发、预发布等非正式构建跳过 Kite 版本匹配。所有构建仍会校验 SDK 兼容性。

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

## 发布到官方目录

将开发完成的插件提交到 [kite-org/kite-plugins](https://github.com/kite-org/kite-plugins)，审核合并后即可发布到官方目录。

1. Fork 并 clone 仓库。
2. 将插件源码放入 `plugins/<插件 ID>/`，目录名与 `package.json` 中的 `name` 一致。附上介绍插件功能和使用方法的 `README.md`，不要提交 `dist/` 或安装包。
3. 在仓库根目录运行 `pnpm install`，将插件源码和更新后的 `pnpm-lock.yaml` 一起提交 PR。

PR 合并到 `main` 后，发布流程会自动构建尚未发布的插件版本并更新以下目录：

| 目录         | 地址                                                       |
| ------------ | ---------------------------------------------------------- |
| GitHub Pages | `https://kite-org.github.io/kite-plugins/catalog.json`     |
| EdgeOne      | `https://plugins.kitehq.dev/catalog.json`（Kite 默认目录） |
