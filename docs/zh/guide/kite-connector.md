---
outline: deep
---

# Kite Connector

Kite Connector 用于接入 Kite Server 无法主动访问的 Kubernetes 集群。Connector 运行在目标集群一侧，主动连接 Kite，并通过这条连接转发 Kite 发起的 Kubernetes API 请求。

## 背景

在私有网络、边缘环境或受防火墙限制的场景中，目标集群可能只能访问 Kite，Kite Server 却无法直接访问集群的 kube-apiserver。传统的 kubeconfig 接入方式要求 Kite Server 能够连接 kube-apiserver，因此无法覆盖这种单向网络环境。

Kite Connector 将连接方向反转：

- Connector 从集群侧主动连接 Kite Server，不要求 Kite 主动进入集群网络。
- Kubernetes 凭据保留在 Connector 运行环境中，不需要上传到 Kite Server。
- Kite 仍然使用现有 Kubernetes Client 访问集群，资源管理、日志和终端等功能不需要单独实现一套协议。

## 原理

连接链路如下：

```text
Kite Kubernetes Client
        │
        ▼
Kite Server 本地回环端口
        │
        ▼
WebSocket 隧道（由 Connector 主动建立）
        │
        ▼
Connector 本地 Kubernetes API 反向代理
        │
        ▼
目标集群 kube-apiserver
```

具体过程：

1. 在 Kite UI 中创建 Connector 集群时，Kite 生成一个随机连接 Token，只保存 Token 的 SHA-256 哈希，并在创建成功后展示一次原始 Token。
2. Connector 使用 Token 连接 Kite Server 的 `/api/v1/connector/connect` WebSocket 接口。Kite 校验 Token 后，将连接绑定到对应集群。
3. Kite Server 为该集群创建一个仅监听 `127.0.0.1` 的随机端口。现有 Kubernetes Client 连接这个端口，请求由隧道转发到 Connector。
4. Connector 同样在本机创建一个仅监听 `127.0.0.1` 的 Kubernetes API 反向代理，并使用本地 ServiceAccount 或 kubeconfig 访问 kube-apiserver。
5. Connector 会移除来自 Kite 的 `Authorization` 和 `Impersonate-*` 请求头，再由本地 Kubernetes Transport 注入 Connector 自己的集群凭据。

一条 Connector WebSocket 可以承载多个 Kubernetes API 连接。日志、Watch 和终端等流式请求也通过同一条隧道传输。

## 使用方式

### 1. 创建 Connector 集群

进入 Kite 的 **设置 → 集群管理**，选择 **添加集群**，然后：

1. 填写集群名称和描述。
2. 将集群类型选择为 **Kite Connector**。
3. 创建集群。

创建成功后，Kite 会展示仅出现一次的连接信息，可以选择命令行或 Kubernetes YAML。

命令行方式：

```bash
kite connector --server='https://kite.example.com' --token='<connector-token>'
```

`--server` 可以包含 Kite 的 Base Path。例如：

```bash
kite connector --server='https://kite.example.com/kite' --token='<connector-token>'
```

Connector 会自动在该地址后追加 `/api/v1/connector/connect`，不要在 `--server` 中手动填写这段 API 路径。

Kubernetes YAML 方式会创建以下资源：

- `kube-system` 命名空间中的 `kite-connector-token` Secret，用于保存 Connector Token。
- `kube-system` 命名空间中的 `kite-connector` ServiceAccount。
- 将该 ServiceAccount 绑定到 `cluster-admin` 的 ClusterRoleBinding。
- `kube-system` 命名空间中的单副本 `kite-connector` Deployment。

可以通过以下两种方式部署：

**方式一：通过 URL 直接部署**

创建成功后，Kite 会生成一个 Manifest 下载 URL，可以直接用 `kubectl apply` 部署：

```bash
kubectl apply -f 'https://kite.example.com/api/v1/connector/manifest?grant=<manifest-grant>'
```

该 URL 包含一个与 Connector Token 分离的加密 Manifest Grant。Grant 会在 10 分钟后过期，只要 JWT Secret 不变，Kite 重启后仍然有效。Grant 在过期前可以重复使用，因此请尽快执行该命令，或改用对话框中展示的 YAML。返回的 YAML 仍包含 Connector Token，必须按敏感凭据处理。

**方式二：复制 YAML 手动部署**

在连接信息对话框中复制 YAML 并保存为文件后，可以直接部署：

```bash
kubectl apply -f kite-connector.yaml
```

Deployment 使用的镜像由平台设置中的 **Connector Image** 配置，默认为 `ghcr.io/kite-org/kite:latest`。通过 Secret 将 Token 注入 Connector 进程。

### 2. 在目标集群中启动

使用命令行自行启动时，应在能够访问 kube-apiserver 的 Pod 中运行生成的命令。未指定 `--kubeconfig` 时，Connector 使用 `rest.InClusterConfig()` 读取 Pod 的 ServiceAccount 凭据。

Connector 成功连接后，集群管理页面会显示为“已连接”。连接中断时，Connector 每隔 5 秒尝试重新连接。

### 3. 使用本地 kubeconfig 测试

本地开发和测试时，可以显式指定 kubeconfig：

```bash
kite connector \
  --server='http://localhost:8080' \
  --token='<connector-token>' \
  --kubeconfig='/path/to/kubeconfig'
```

此时 Connector 使用 kubeconfig 当前上下文中的 API Server 和认证信息。`http://` 仅建议用于本机测试，生产环境应使用 `https://`。

## 需要注意的点

### Token 安全

- Connector Token 当前没有有效期，在对应集群存在且处于启用状态时可以持续用于重新连接。禁用集群会停止 Kite 使用该集群，并拒绝后续新建或重连的 Connector 握手，但不会主动关闭已经建立的 Connector Session；重新启用后原 Token 仍然有效。
- Kite 数据库只保存 Token 哈希，原始 Token 只在创建集群后展示一次，请立即妥善保存。
- 当前没有单独的 Token 轮换接口。Token 泄露时，应删除并重新创建 Connector 集群，生成新 Token。
- `--token` 会出现在进程参数和 Shell 历史中。应限制 Connector 主机的登录与进程查看权限，不要在日志、工单或聊天中粘贴真实 Token。

### 服务端身份校验

- 生产环境必须使用 `https://`，并使用 Connector 运行环境信任的 CA 签发 Kite Server 证书。Connector 会按标准 TLS 规则校验证书域名和信任链，从而避免连接到伪造的 Kite Server。
- 使用 `http://` 时没有服务端身份校验，Token 和隧道数据也不受 TLS 保护，只适合受控的本地测试。
- 当前连接使用 Bearer Token，尚未实现 mTLS、客户端证书签发和证书轮换。

### Kubernetes 权限与审计

- Connector 的 ServiceAccount 或 kubeconfig 权限决定 Kite 能够在集群中执行哪些操作。若需要使用日志、终端等功能，应同时授予对应的 Kubernetes RBAC 权限。
- 当前生成的 YAML 会把 Connector ServiceAccount 绑定到 `cluster-admin`，拥有整个集群的管理权限。部署前应确认这符合你的安全要求。
- Kite 用户仍受 Kite 自身 RBAC 控制，但 kube-apiserver 看到的请求身份是 Connector 使用的 ServiceAccount 或 kubeconfig 用户，而不是实际的 Kite 登录用户。
- Connector 不接受 Kite 传入的 Kubernetes `Authorization` 或 `Impersonate-*` 请求头。

### 网络与可用性

- Connector 只需要主动访问 Kite Server 和目标集群 kube-apiserver，不需要向集群外暴露新的监听端口。
- Kite Server 和 Connector 进程都会创建仅绑定 `127.0.0.1` 的随机监听端口，这是内部转发链路的正常行为。
- Kite 前方的 Ingress 或反向代理必须支持 WebSocket Upgrade 和长连接。
- 当前尚未实现跨多个 Kite Server 副本的 Connector Session 路由。使用 Connector 集群时，应先使用单个 Kite Server 副本。
- 隧道断开会中止正在运行的日志、Watch 或终端连接。Connector 重连后，需要由客户端重新发起这些流式请求。
- 终端和命令执行优先使用 WebSocket，并在升级失败时回退到 SPDY；API Server 及中间代理需要支持对应的连接升级。
