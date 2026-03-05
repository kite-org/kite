# Kite - 现代化的 Kubernetes Dashboard

<div align="center">

<img src="./docs/assets/logo.svg" alt="Kite Logo" width="128" height="128">

_一个现代 Kubernetes Dashboard_

<a href="https://trendshift.io/repositories/21820" target="_blank"><img src="https://trendshift.io/api/badge/repositories/21820" alt="kite-org%2Fkite | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=flat&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19+-61DAFB?style=flat&logo=react)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Apache-green.svg)](LICENSE)
<a href="https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg"><img alt="Join Kite" src="https://badgen.net/badge/Slack/Join%20Kite/0abd59?icon=slack" /></a>

[**在线 Demo**](https://kite-demo.zzde.me) | [**文档**](https://kite.zzde.me)
<br>
[English](./README.md) | **中文**

</div>

Kite是一款轻量级、现代化的Kubernetes仪表板工具，它将实时可观测性、多集群管理和资源管理功能，以及企业级用户管理功能（如OAuth、RBAC和审计日志功能），以及AI代理功能整合到一个工作空间中。它不仅仅是一个工具，而更像是一个平台。

![Dashboard Overview](docs/screenshots/overview.png)
_集群概览，包含实时指标和资源统计_

## ✨ 功能特性

### 用户界面

- 暗色/亮色/彩色主题，支持自动跟随系统偏好
- 跨所有资源的全局搜索
- 适配桌面、平板和移动端的响应式设计
- 国际化支持（中文和英文）

### 多集群管理

- 在多个 Kubernetes 集群间切换
- 按集群独立配置 Prometheus
- 自动从 kubeconfig 发现集群
- 细粒度的集群访问权限控制

### 资源管理

- 全面覆盖：Pods、Deployments、Services、ConfigMaps、Secrets、PVs、PVCs、Nodes 等
- 基于 Monaco 编辑器的实时 YAML 编辑（语法高亮和校验）
- 提供容器、卷、事件和状态等详细视图
- 资源关系展示（例如 Deployment → Pods）
- 支持创建、更新、删除、扩缩容和重启操作
- 支持 CRD（Custom Resource Definitions）
- 基于 Docker 和容器镜像仓库 API 的镜像标签快速选择器
- 可自定义侧边栏并添加 CRD 快捷入口
- 通过 Kube Proxy 直接访问 Pod/Service（无需 `kubectl port-forward`）

### 监控与可观测性

- 实时 CPU、内存和网络图表（Prometheus）
- 支持过滤和搜索的实时 Pod 日志
- 面向 Pod 和 Node 的 Web 终端
- 内置 kubectl 控制台
- AI 助手

### 安全

- OAuth 集成
- 基于角色的访问控制
- 用户管理和角色分配

---

## 🚀 快速开始

有关详细说明，请参阅[文档](https://kite.zzde.me/guide/installation.html)。

### Docker

```bash
docker run -d -p 8080:8080 -v ./data:/data -e DB_DSN=/data/db.sqlite ghcr.io/kite-org/kite:latest
```

### 在 Kubernetes 中部署

#### 使用 Helm (推荐)

1.  **添加 Helm 仓库**

    ```bash
    helm repo add kite https://kite-org.github.io/kite/
    helm repo update
    ```

2.  **使用默认值安装**

    ```bash
    helm install kite kite/kite -n kube-system
    ```

#### 使用 kubectl

1.  **应用部署清单**

    ```bash
    kubectl apply -f deploy/install.yaml
    # 或在线安装
    # 注意：此方法可能不适合生产环境，因为他没有配置任何持久化相关内容，你需要手动挂载持久化卷并设置环境变量 DB_DSN=/data/db.sqlite 来确保数据不会丢失。或者也可以外部数据库。
    # 参考: https://kite.zzde.me/zh/faq.html#%E6%8C%81%E4%B9%85%E5%8C%96%E7%9B%B8%E5%85%B3
    kubectl apply -f https://raw.githubusercontent.com/kite-org/kite/refs/heads/main/deploy/install.yaml
    ```

2.  **通过端口转发访问**

    ```bash
    kubectl port-forward -n kube-system svc/kite 8080:8080
    ```

### 从源码构建

1.  **克隆仓库**

    ```bash
    git clone https://github.com/kite-org/kite.git
    cd kite
    ```

2.  **构建项目**

    ```bash
    make deps
    make build
    ```

3.  **运行服务**

    ```bash
    make run
    ```

---

## 🔍 问题排查

有关问题排查，请参阅[文档](https://kite.zzde.me)。

## 💖 支持本项目

如果您觉得 Kite 对您有帮助，请考虑支持本项目的开发！您的捐赠将帮助我们维护和改进这个项目。

### 捐赠方式

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

感谢您的支持！❤️

## 🤝 贡献

我们欢迎贡献！请参阅我们的[贡献指南](https://kite.zzde.me/zh/faq.html#%E6%88%91%E5%9C%A8%E5%93%AA%E9%87%8C%E5%8F%AF%E4%BB%A5%E8%8E%B7%E5%BE%97%E5%B8%AE%E5%8A%A9)了解如何参与。

## 📄 许可证

本项目采用 Apache License 2.0 许可证 - 详见 [LICENSE](LICENSE) 文件。
