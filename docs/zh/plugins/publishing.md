---
outline: deep
---

# 发布插件

插件打包为 `.tar.gz` 安装包，支持直接分发、发布到 npm、自建 catalog，或通过官方 [kite-plugins](https://github.com/kite-org/kite-plugins) 仓库发布。

## 版本规则

- 版本号是**不带 `v` 前缀**的语义化版本（如 `0.1.3`）。
- **同一 ID + 版本对应不可变的包内容**。Kite 按内容 SHA-256 存储资产，任何内容变更——哪怕只改了一个字符串——都必须递增版本号，否则 Kite 拒绝安装。
- `engines.kite` 决定插件可安装的 Kite 版本范围。仅正式版本（`X.Y.Z` 或 `vX.Y.Z`）在安装和目录展示时校验该范围；开发、预发布等非正式构建跳过 Kite 版本匹配。所有构建仍会校验 SDK 兼容性。

## README

插件根目录的 `README.md` 会自动复制进 `dist/` 并包含在归档中。catalog 分发时，Kite 的插件目录可以在线预览这份 README。README 中指向未随包分发文件的链接请使用完整的仓库 URL。

## 发布到 npm

在插件项目的 `package.json` 中移除 `"private": true`，并将构建产物加入发布文件：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "files": ["dist"],
  "keywords": ["kite-plugin"]
}
```

保留项目的其他字段和脚本，构建后发布到公开的 npm registry：

```sh
pnpm run build
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

发布的包必须包含 `dist/plugin.json` 及其引用的所有资源。也可以将 `plugin.json` 和资源直接放在 npm 包根目录。npm 包版本必须与 `plugin.json` 中的版本一致。Kite 直接下载构建产物，不执行 npm 脚本或安装依赖。

带有 `kite-plugin` 关键词的包会在 npm 完成索引后出现在 Kite 插件目录中，排列在现有 catalog 插件之后，勾标识表示目录收录的插件。该关键词不代表安全性或兼容性认证。社区插件发现由浏览器直接请求 npmjs，搜索在前端筛选结果；安装和更新下载仍由 Kite 服务端执行。

在 **插件管理 → 从 npm 安装** 中输入包名，选择 **npmjs** 或 **npmmirror**，即可安装 `latest` 版本并自动启用。支持普通包名及 `@scope/my-plugin`，但清单中的插件 ID 仍须符合 Kite 的 ID 规则。当前 SDK 使用构建项目的包名作为插件 ID，因此发布 scoped 包时，需要在构建产物旁单独准备发布用的 `package.json`，填写 scoped 包名及相同版本。

更新时递增版本号、重新构建并发布。打开 **已安装插件** 或点击其刷新按钮时，Kite 会检查 npm 更新，点击 **更新** 即可安装提示的版本，并保留插件的启用状态。服务端从保存的 npmjs 或 npmmirror 下载地址识别包名和安装源，浏览器直接向各插件的安装源检查更新，各请求及超时相互独立。npmmirror 同步新版本可能需要时间。

发布选项参见 [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)，镜像说明参见 [npmmirror](https://npmmirror.com/)。

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
