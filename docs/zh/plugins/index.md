---
outline: deep
---

# 插件简介

插件功能自 Kite **v0.16.0** 起提供。

Kite 插件是一个运行在 Kite 内部的 React 前端模块。它可以在不重新编译 Kite 的前提下，为 Kite 增加页面、侧边栏菜单和针对自定义资源的专属管理界面。

插件通过 [`@kite-dev/plugin-sdk`](https://github.com/kite-org/kite-plugins/tree/main/packages/plugin-sdk) 编写和构建，打包为 `.tar.gz` 归档，由 Kite 管理员在 **插件管理** 页面安装。安装后，供所有登录用户使用。

## 插件能做什么

- 注册页面和路由
- 注册侧边栏菜单
- 扩展资源列表和详情
- 接管自定义资源页面

一个典型的插件例子是 [cert-manager 插件](https://github.com/kite-org/kite-plugins/tree/main/plugins/cert-manager)：它为 Certificate、Issuer、CertificateRequest、Order、Challenge 等 CRD 提供了完整的管理界面，包含资源列表、详情页、状态徽标和 YAML 编辑。

## 插件不能做什么

- 不执行任何后端代码。插件只有前端模块，不能注册新的后端 API，也不能扩展 Kubernetes controller / operator 行为。

## 运行与安全模型

理解以下几点对正确使用插件很重要：

1. **插件以当前登录用户的身份运行**。插件发起的所有 Kubernetes 请求都经由 Kite 后端转发，并受该用户的 RBAC 权限约束——用户看不到自己无权访问的资源，这与在 Kite 原生页面中操作完全一致。插件不会获得任何额外权限。
2. **插件管理是管理员操作**。安装、停用、卸载、目录配置均需要 Kite 管理员权限；普通用户只能使用已启用的插件。
3. **插件是受信任代码**。插件 JavaScript 在您的浏览器中执行，等同于其作者可以直接使用您在 Kite 中的全部操作能力。只安装来自可信作者的插件。
4. **运行时共享**。插件与 Kite 通过 Module Federation 共享 React、React Router、TanStack Query 等运行时和 SDK 实现，插件包因此非常小，也不会出现双 React 实例问题。

## 安装与使用

面向使用者的安装说明：

1. 点击右上角头像，选择 **插件管理**（仅管理员可见）。
2. 在 **设置 → 通用** 中找到 **插件目录**，填写 `catalog.json` 地址并保存。留空则使用默认目录 `https://kite-plugins.zzde.me/catalog.json`。
3. 回到 **插件管理**，在 **插件目录** 中选择插件并点击 **安装**，点击插件名可预览 README。
4. 从侧边栏打开插件。新安装的插件自动启用。

也可以使用 **从文件安装** 直接上传插件的 `.tar.gz` 归档。在 **已安装插件** 中可以停用、启用或卸载插件。

## 相关仓库

| 仓库                                                     | 作用                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [kite](https://github.com/kite-org/kite)                 | 宿主应用：插件加载、资产分发、管理 API                              |
| [kite-plugins](https://github.com/kite-org/kite-plugins) | SDK、创建器、官方插件集合与插件目录；SDK 位于 `packages/plugin-sdk` |

## 接下来

- [快速开始](./quick-start)：从零创建并安装一个插件
- [API 参考](./api)：SDK 全部扩展点和接口
- [国际化](./i18n)：多语言支持
- [调试](./debugging)：开发迭代与问题排查
- [发布插件](./publishing)：分发插件并提交到官方仓库
