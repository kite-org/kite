# 什么是 Kite？

Kite 是一个轻量级、现代化的 Kubernetes Dashboard，将实时可观测性、多集群与资源管理、企业级用户治理（OAuth、RBAC 和审计日志）以及 AI Agent 集成到同一个工作空间中。它不只是一个工具，更像一个平台。

![Dashboard Overview](/screenshots/overview.png)

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
- 资源关系展示（例如 Deployment -> Pods）
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

## Kite 与 Headlamp / Kubernetes Dashboard 的差异

Headlamp 和 Kubernetes Dashboard 都是优秀的集群操作工具，核心侧重在资源查看与控制。Kite 具备这些 Dashboard 能力，但定位是面向团队协作的运维平台：

- 在同一个工作空间整合可观测性、多集群运维、治理能力与 AI 助手
- 内置团队治理能力：OAuth、RBAC、用户角色映射与审计日志
- 不止资源视图，还覆盖运维工作流：Web 终端、内置 kubectl 控制台、Kube Proxy
- 让运维、开发和管理员在同一套系统中协作，而不是拼接多个工具

一句话：它们更像 Dashboard 工具，Kite 更像 Kubernetes 日常运维与协作平台。

## 开始使用

准备好探索 Kite 了吗？查看[安装指南](./installation)。
