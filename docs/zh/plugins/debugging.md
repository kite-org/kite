---
outline: deep
---

# 调试

插件开发服务负责监听源码、重新构建并提供静态文件。页面运行在 Kite 内，复用真实的组件、当前用户、集群和 API 权限。

## 启动开发服务

在插件目录运行：

```sh
pnpm dev
```

首次构建完成后，终端输出：

```text
Plugin URL: http://localhost:5174/plugin.json
```

在 `kite-plugins` workspace 中，先构建 SDK，再启动对应插件：

```sh
pnpm --filter @kite-dev/plugin-sdk run build
pnpm --filter cert-manager dev
```

## 配置 Kite

将开发地址作为环境变量传给 Kite：

```sh
PLUGIN_DEV_URL=http://localhost:5174/plugin.json ./kite
```

使用 Helm 部署时，通过已有的 `extraEnvs` 配置：

```yaml
extraEnvs:
  - name: PLUGIN_DEV_URL
    value: http://localhost:5174/plugin.json
```

Kite 将地址传给浏览器，由浏览器直接获取插件 manifest 和静态资源。地址必须能被浏览器访问；`localhost` 指浏览器所在的机器，而不是 Kite 容器。远程开发可以通过端口转发将服务映射到浏览器所在的机器。也可以指定监听地址和端口：

```sh
pnpm dev --host 0.0.0.0 --port 5174
```

此时将配置中的主机名改成浏览器能够访问的开发机地址。HTTPS Kite 页面应配合浏览器允许访问的开发地址，远程 HTTP 服务可能被浏览器拦截为混合内容；需要时为开发服务配置 HTTPS。

## 修改与刷新

1. 修改页面、样式、翻译或 `plugin.config.tsx`。
2. 等待终端提示重新构建完成。
3. 刷新 Kite 页面，读取最新的 manifest 和代码。

菜单、路由、资源页面接管以及列表列、详情 Tab 扩展均通过现有插件机制加载。开发插件无需安装，也不写入数据库；如果存在相同 ID 的已安装插件，当前实例优先使用开发插件。此配置作用于访问该 Kite 实例的用户。

开发期间无需递增版本号。修改插件 ID、版本或 Vite 配置后，重启 `pnpm dev`。修改 `PLUGIN_DEV_URL` 后需要重启 Kite；平时修改插件源码只需刷新浏览器。移除环境变量并重启 Kite 后，恢复加载已安装插件。

## 排查问题

- 开发地址请求失败：在浏览器中打开输出的 `plugin.json` 地址，确认服务正在运行、地址和端口可达。Kite 浏览器控制台会记录开发 manifest 的加载错误。
- 改动没有生效：先确认构建成功，再刷新整个 Kite 页面。仅切换菜单不会重新加载已经执行的模块。
- 构建失败：查看开发服务终端中的错误。修正源码后监听器会继续构建。
- 插件模块或组件异常：查看浏览器控制台和页面错误提示；插件仍使用 Kite 的错误隔离机制。

准备分发时运行 `pnpm build` 和 `pnpm pack`，生成正式构建和安装包。
