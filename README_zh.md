<div align="center">

<img src="./docs/assets/logo.svg" alt="Kite Logo" width="128" height="128">

# Kite

**所有集群，一个工作空间。**

Kite 是一个轻量、开源的 Kubernetes 工作空间，面向多集群运维、可观测性、访问控制与 AI 辅助排障。

[![Release](https://img.shields.io/github/v/release/kite-org/kite?style=flat-square&logo=github&label=Release)](https://github.com/kite-org/kite/releases)
[![Stars](https://img.shields.io/github/stars/kite-org/kite?style=flat-square&logo=github&label=Stars)](https://github.com/kite-org/kite/stargazers)
[![Downloads](https://img.shields.io/github/downloads/kite-org/kite/total?style=flat-square&logo=github&label=Downloads)](https://github.com/kite-org/kite/releases)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg?style=flat-square)](LICENSE)

[**文档**](https://kitehq.dev/zh/) · [**版本发布**](https://github.com/kite-org/kite/releases) · [**社区**](https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg)

[English](./README.md) · **中文**

</div>

<img width="1586" height="1167" alt="image" src="https://github.com/user-attachments/assets/a88a63b7-5b71-444d-8d98-66f147a68ef7" />

## 为什么选择 Kite

### 可观测

- 通过各集群独立配置的 Prometheus 查看实时 CPU、内存和网络指标。
- 实时查看并过滤 Pod 日志，在同一上下文中检查事件、状态和关联资源。

### 运维

- 跨多个集群管理 Kubernetes 核心资源、CRD 和 Helm Release。
- 在线编辑 YAML、扩缩容或重启工作负载，并使用面向 Pod、Node 和 kubectl 的 Web 终端。
- 通过全局搜索快速定位资源，或使用内置 Kube Proxy 直接访问 Pod 和 Service。

### 治理

- 支持 OAuth、LDAP、本地账户、MFA 和 Passkey 登录。
- 通过 RBAC 和集群访问权限控制操作范围，并使用审计日志追踪资源变更。

### AI 辅助

- 使用内置 AI 助手检查资源、日志和 Prometheus 指标。
- 写操作执行前需要用户确认，且 AI 助手遵循当前用户的 RBAC 权限。

## 快速开始

### Helm

如需快速体验，可通过 OCI Registry 将 Kite 安装到独立的命名空间：

```bash
helm install kite oci://ghcr.io/kite-org/charts/kite \
  --namespace kite-system \
  --create-namespace
```

将服务转发到本地：

```bash
kubectl port-forward --namespace kite-system svc/kite 8080:8080
```

打开 [http://localhost:8080](http://localhost:8080)，创建首个管理员账户，并按照初始化流程连接集群。如果 Kite 运行在需要管理的集群中，选择 `in-cluster` 连接类型即可完成最简单的配置。

> [!IMPORTANT]
> Chart 默认值仅适合快速体验。用于生产环境前，请启用持久化存储或配置外部数据库、替换默认加密密钥，并检查 Chart 创建的集群级 RBAC 权限。详见[安装指南](https://kitehq.dev/zh/guide/installation)和 [Chart Values](https://kitehq.dev/zh/config/chart-values)。

## 其他安装方式

### Docker

```bash
mkdir -p data
docker run -d --name kite \
  -p 8080:8080 \
  -v "$(pwd)/data:/data" \
  -e DB_DSN=/data/db.sqlite \
  ghcr.io/kite-org/kite:latest
```

### Kubernetes Manifest

独立 Manifest 适合快速体验。除非额外挂载持久化存储，否则应用数据会保存在容器内。

```bash
kubectl apply -f https://raw.githubusercontent.com/kite-org/kite/main/deploy/install.yaml
kubectl port-forward --namespace kube-system svc/kite 8080:8080
```

该 Manifest 会为 ServiceAccount 授予 `cluster-admin` 权限。在测试环境之外使用前，请检查并收紧这些权限。

### 从源码构建

构建 Kite 需要 Go 1.27.3、Node.js `^20.19.0` 或 `>=22.12.0`、pnpm 和 Make。

```bash
git clone https://github.com/kite-org/kite.git
cd kite
make deps
make build
./kite
```

### macOS 桌面端原型

在 macOS 上构建并打开 MyGo 桌面应用：

```bash
make desktop
```

`make desktop-build` 只构建应用，产物位于
`bin/desktop/darwin-<architecture>/Kite MyGo.app`，使用供本机运行的临时签名。
应用在首次启动时分配并保存本机端口，无需 Kite 账户，使用所选集群的凭据和 Kubernetes 权限。
关闭主窗口会隐藏窗口，选择“退出 Kite”才会停止后端。

顶部工具栏的 AI 按钮会打开独立聊天窗口。再次点击会聚焦已有窗口，保留当前对话。
聊天窗口固定使用打开时的集群和资源上下文；关闭后重新打开即可切换上下文。
AI 修改集群资源前仍需用户确认。

Pod 和 Service 详情页支持本地 TCP 端口转发。选择目标端口，本地端口留空可自动分配，
也可以手动指定。连接只监听 `127.0.0.1`，顶部入口可查看、复制地址、以 HTTP 打开和停止。
切换页面不会中断连接，退出应用时全部关闭。Service 必须有 Pod 选择器，转发会绑定到一个
运行中的 Pod；该 Pod 停止后需要重新启动转发。集群凭据需要具备 Kubernetes 的
`pods/portforward` 权限。

桌面工具栏与 macOS 红黄绿窗口按钮合并为一行，侧栏和内容独立滚动。关闭主窗口会隐藏
窗口并保留后台连接，可从菜单栏 Kite 或 Dock 恢复；选择“退出 Kite”或按 Cmd+Q 才会
停止应用及所有连接。菜单栏显示本应用的本地转发，提供复制地址、以 HTTP 打开和停止。
Pod 日志和终端工具栏提供独立开窗按钮，新窗口固定集群和 Pod 上下文，重复打开相同目标
会聚焦已有窗口，并记住窗口位置和大小。顶部 kubectl 入口也会按集群独立开窗。
关闭日志或终端窗口时，仅结束该窗口自己的连接。

数据库、插件和本地加密密钥保存在 `~/Library/Application Support/Kite MyGo Local`。
加密密钥由当前 macOS 用户以文件形式保存，不再使用钥匙串。首次启动会尝试导入
`~/.kube/config`（或 `KUBECONFIG` 指定的文件）。保存的端口使浏览器本地偏好在重启后
保持；旧版随机端口下的偏好不会自动迁移。应用会在 Homebrew 常用目录、`~/.krew/bin` 和
`~/.local/bin` 查找凭据工具；其他位置需要加入应用的 `PATH`，或在 kubeconfig 中使用绝对路径。
下载文件保存到下载目录。云集群凭据插件仍需桌面端验证。此原型尚未接入公证和自动更新。

在同一台 Mac 上替换或重装应用会保留数据目录。备份或恢复时请先退出 Kite，再复制整个
数据目录，包括密钥文件；备份应作为敏感数据保管。如果 `encryption.key` 丢失，Kite 会停止
启动，不会为已有数据库生成新密钥。浏览器本地偏好由 macOS WebView 单独保存，不包含在
此目录备份中。旧版原型的 `~/Library/Application Support/Kite MyGo` 和
钥匙串条目仍然保留，但不会自动导入；如果本机 kubeconfig 中没有对应集群，需要重新导入。

## 文档

| 主题             | 指南                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 安装与访问       | [安装指南](https://kitehq.dev/zh/guide/installation)                                                                            |
| 用户、认证和权限 | [用户管理](https://kitehq.dev/zh/config/user-management) · [RBAC](https://kitehq.dev/zh/config/rbac-config)                     |
| 监控             | [Prometheus 配置](https://kitehq.dev/zh/config/prometheus-setup)                                                                |
| 运维             | [Helm 管理](https://kitehq.dev/zh/guide/helm-management) · [Kite Cluster Agent](https://kitehq.dev/zh/guide/kite-cluster-agent) |
| AI               | [AI 助手](https://kitehq.dev/zh/guide/ai-assistant)                                                                             |
| API              | [API 文档](https://kitehq.dev/zh/api/authentication)                                                                            |

## 社区

- 提交 Pull Request 前请先阅读[贡献指南](./CONTRIBUTING.md)。
- 请按照[安全策略](./SECURITY.md)报告安全漏洞。
- 加入 [Kite Slack 社区](https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg)，与其他用户交流。

## 支持本项目

如果你觉得 Kite 对你有帮助，请考虑支持本项目的开发。你的捐赠将帮助我们维护和改进项目。

<table>
  <tr>
    <td align="center">
      <b>支付宝</b><br>
      <img src="./docs/donate/alipay.jpeg" alt="支付宝二维码" width="200">
    </td>
    <td align="center">
      <b>微信支付</b><br>
      <img src="./docs/donate/wechat.jpeg" alt="微信支付二维码" width="200">
    </td>
    <td align="center">
      <b>PayPal</b><br>
      <a href="https://www.paypal.me/zxh326">
        <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg" alt="PayPal" width="150">
      </a>
    </td>
  </tr>
</table>

感谢你的支持！❤️

## 许可证

Kite 基于 [Apache License 2.0](LICENSE) 发布。
