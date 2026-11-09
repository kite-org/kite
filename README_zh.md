<div align="center">

<img src="./docs/assets/logo.svg" alt="Kite Logo" width="128" height="128">

# Kite

**所有集群，一个工作空间。**

Kite 是一个轻量、开源的 Kubernetes 工作空间，面向多集群运维、可观测性、访问控制与 AI 辅助排障。

你可以在 macOS 和 Windows 上使用 **Kite 桌面版（Beta）**，也可以将 Kite 部署为共享 Web 控制台。

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

### Kite 桌面版（Beta）

在 macOS 和 Windows 上使用本地 kubeconfig 管理集群，无需部署 Kite 服务。

下载安装包：[macOS DMG](https://github.com/kite-org/kite/releases/latest/download/kite-darwin-arm64.dmg) · [Windows x64](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.exe)。

macOS（Apple Silicon，macOS 13+）也可以通过 Homebrew 安装：

```bash
brew install --cask kite-org/tap/kite
```

macOS Beta 版尚未签名和公证，首次打开如被系统拦截，请执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Kite.app"
```

### 通过 Helm 自行部署

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

构建 Kite 需要 Go 1.26、Node.js `^20.19.0` 或 `>=22.12.0`、pnpm 和 Make。

```bash
git clone https://github.com/kite-org/kite.git
cd kite
make deps
make build
./kite
```

## 文档

| 主题             | 指南                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 桌面版（Beta）   | [桌面版指南](./docs/zh/guide/desktop.md)                                                                                       |
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
