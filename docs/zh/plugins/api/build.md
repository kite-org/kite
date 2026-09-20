---
outline: deep
---

# 构建与校验

`/vite` 的 `kitePlugin({ entry? })` 返回 Vite 配置，负责打包插件产物并生成 `plugin.json`；同入口导出的 `sharedModules` 是[入口点](./)列出的共享模块清单，不要在插件里重复打包。构建、打包与安装流程见[快速开始](../quick-start)。

`kitePlugin` 在构建和打包时自动调用这些校验，工具链也可以直接使用：

| 导出 | 作用 |
| ---- | ---- |
| `validateManifest(input)` | 校验元数据、版本、`sdkVersion` / `requires.kite`、资产路径、路由、菜单、资源扩展和主题声明 |
| `validateNavigation(pluginId, input)` | 校验路由、菜单、资源目标、主题及列 / Tab 元数据，包括 ID 唯一性、路径冲突、菜单父子关系、图标名称和本地化标签 |
| `validateDefinition(pluginId, input)` | 在导航校验之上检查运行时定义，包括路由 / Tab 的 `element`、列 accessor 与排序函数的契约 |
| `validateModule(manifest, input)` | 校验模块与 `plugin.json` 的路由、菜单、资源扩展和主题元数据完全一致 |
| `validatePluginIdentity(id, name)` | 校验插件 ID 与显示名 |
| `coreMenuGroupIds` | 宿主公开的菜单分组 ID |
| `defaultKiteRange` | 当前 SDK 默认写入 `requires.kite` 的 Kite 版本范围 |

各模块完整的参数、选项和响应类型见插件仓库 [`packages/plugin-sdk/src/`](https://github.com/kite-org/kite-plugins/tree/main/packages/plugin-sdk/src) 下的 TypeScript 声明。
