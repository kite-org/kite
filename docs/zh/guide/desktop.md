---
title: Kite 桌面版（Beta）
description: 下载适用于 macOS 和 Windows 的 Kite 桌面版，连接本地 kubeconfig，在电脑上管理 Kubernetes。
---

# Kite 桌面版（Beta）

Kite 桌面版将 Kubernetes 工作空间带到你的电脑上。无需部署 Kite 服务或创建 Kite 账号，即可查看资源、管理 Helm Release、查看日志和使用 AI 助手。集群访问使用 kubeconfig 中的凭据，并遵循对应的 Kubernetes 权限。

## 下载

[前往最新 Release 下载 Kite 桌面版 →](https://github.com/kite-org/kite/releases/latest)

直接下载适合你电脑的最新桌面安装包：

| 平台           | 系统要求                                  | 安装包                                                                                                     |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| macOS          | Apple Silicon（M1 及更新芯片），macOS 13+ | [kite-darwin-arm64.dmg](https://github.com/kite-org/kite/releases/latest/download/kite-darwin-arm64.dmg)   |
| Windows        | x64                                       | [kite-windows-amd64.exe](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.exe) |
| Windows 便携版 | x64                                       | [kite-windows-amd64.zip](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.zip) |

桌面安装包随 Kite Release 发布。如果列表中尚未出现这些文件，说明该版本的桌面安装包还未发布。其他命令行程序压缩包不是桌面安装包。

目前未提供 Intel Mac 和 Linux 的桌面安装包，你仍可[自行部署 Kite](./installation)，通过浏览器使用。

## 安装与连接

1. **macOS：**打开 DMG，将 Kite 拖入「应用程序」。**Windows：**运行安装程序；或解压便携 ZIP 后打开 `Kite.exe`，并将附带的 DLL 保留在同一目录。
2. 打开 Kite。应用会读取默认的 `~/.kube/config`；如果应用能获取到 `KUBECONFIG` 环境变量，则读取其中指定的文件。
3. 如需连接其他配置，可在导入对话框中选择或拖入 kubeconfig 文件，然后选择集群开始使用。

::: info macOS Beta 安装提示
当前 macOS 构建尚未经过 Apple 公证。如果系统阻止打开，请先确认安装包来自 Kite 官方 Release，再通过系统「隐私与安全性 → 仍要打开」完成首次启动。
:::

## 桌面版特性

- **实时同步 kubeconfig。**关联文件变化时，自动更新凭据、添加或移除 context，重启 Kite 后仍会继续同步。粘贴 YAML 则是一次性导入。
- **独立窗口。**在主界面切换页面时，可以让 Pod 日志、终端、本地 kubectl 终端或 AI 对话保持在独立窗口中。使用本地 kubectl 终端需先在电脑上安装 `kubectl`。
- **本地端口转发。**将 Pod 或 Service 端口转发到本机，通过工具栏或菜单栏 / 系统托盘管理连接。切换页面不会断开转发，退出 Kite 时会停止连接。

在「设置 → 集群」中管理关联的 kubeconfig 文件。移除来源会停止同步并移除 Kite 中的对应连接，不会删除原文件或 Kubernetes 资源。如果文件无法读取或格式无效，Kite 会保留最后一次有效配置，并在设置中显示错误。

## 云厂商认证

如果 kubeconfig 通过 `exec` 调用认证命令，需要先在同一台电脑上安装对应工具并完成登录。Kite 会使用 kubeconfig 引用的命令，不内置 AWS CLI、Google Cloud CLI 或其他云厂商工具。

在 macOS 上，Kite 也会查找常见 Homebrew 目录、`~/.krew/bin` 和 `~/.local/bin`。如果工具安装在其他位置，可在 kubeconfig 中使用可执行文件的绝对路径，或让该命令在应用的 `PATH` 中可用。依赖终端 shell 配置才能运行的命令，在从 Finder 启动 Kite 时可能无法找到。

Beta 阶段仍在验证云厂商认证流程。如果连接失败，请检查本机认证工具的安装位置、可执行文件路径和登录状态。

## 选择桌面版还是自行部署？

桌面版适合使用已有集群凭据的个人本地工作空间。如果需要共享 Web 控制台、Kite 账号、统一认证和团队权限管理，请参考[自行部署指南](./installation)。
