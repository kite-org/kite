---
outline: deep
---

# Cluster Agent

Cluster Agent 用于接入 Kite Server 无法主动访问的 Kubernetes 集群。Cluster Agent 运行在目标集群一侧，主动连接 Kite，并通过这条连接转发 Kite 发起的 Kubernetes API 请求。

## 背景

在私有网络、边缘环境或受防火墙限制的场景中，目标集群可能只能访问 Kite，Kite Server 却无法直接访问集群的 kube-apiserver。传统的 kubeconfig 接入方式要求 Kite Server 能够连接 kube-apiserver，因此无法覆盖这种单向网络环境。

Cluster Agent 将连接方向反转：

- Cluster Agent 从集群侧主动连接 Kite Server，不要求 Kite 主动进入集群网络。
- Kubernetes 凭据使用集群注册公钥加密后再上传到 Kite Server。

## 原理

连接链路如下：

```text
Kite Kubernetes Client
        │
        ▼
Kite Server Kubernetes 认证 Transport
        │
        ▼
remotedialer Server
        │
        ▼
WebSocket 隧道（由 Cluster Agent 主动建立）
        │
        ▼
Cluster Agent 代拨 TCP
        │
        ▼
目标集群 kube-apiserver
```

具体过程：

1. 在 Kite UI 中创建 Cluster Agent 集群时，Kite 生成一个随机连接 Token 和一对 X25519 注册密钥，只保存 Token 的 SHA-256 哈希，将注册私钥加密存入数据库，并在创建成功后展示一次原始 Token 和公钥。
2. Cluster Agent 加载集群内 ServiceAccount 或 kubeconfig，加密后发送到 `/api/v1/cluster-agent/register`。Cluster Agent 每 10 分钟刷新一次这份注册信息。
3. Kite Server 使用集群私钥解密注册信息，并将解密后的配置和凭据保存在进程内存中。
4. 注册成功后，Cluster Agent 使用连接 Token 连接 `/api/v1/cluster-agent/connect` WebSocket 接口。Kite 校验 Token 后，将此 Session 绑定到对应集群。
5. 后续通过这个 websocket 隧道，Kite Server 可以直接访问集群的 kube-apiserver，转发 Kubernetes API 请求和流式请求。

## 使用方式

### 1. 创建 Cluster Agent 集群

进入 Kite 的 **设置 → 集群管理**，选择 **添加集群**，然后：

1. 填写集群名称和描述。
2. 将集群类型选择为 **Cluster Agent**。
3. 创建集群。

创建成功后，Kite 会展示仅出现一次的连接信息，可以选择命令行或 Kubernetes YAML。

命令行方式：

```bash
kite cluster-agent --server='https://kite.example.com' --token='<cluster-agent-token>' --public-key='<registration-public-key>'
```

`--server` 可以包含 Kite 的 Base Path。例如：

```bash
kite cluster-agent --server='https://kite.example.com/kite' --token='<cluster-agent-token>' --public-key='<registration-public-key>'
```

Cluster Agent 会按需自动追加 `/api/v1/cluster-agent/register` 和 `/api/v1/cluster-agent/connect` 路径，`--server` 只需填写 Kite Server 的基础地址。

Kubernetes YAML 方式会创建以下资源：

- `kube-system` 命名空间中的 `kite-cluster-agent-token` Secret，用于保存 Cluster Agent Token。
- `kube-system` 命名空间中的 `kite-cluster-agent` ServiceAccount。
- 将该 ServiceAccount 绑定到 `cluster-admin` 的 ClusterRoleBinding。
- `kube-system` 命名空间中的单副本 `kite-cluster-agent` Deployment。

可以通过以下两种方式部署：

**方式一：通过 URL 直接部署**

创建成功后，Kite 会生成一个 Manifest 下载 URL，可以直接用 `kubectl apply` 部署：

```bash
kubectl apply -f 'https://kite.example.com/api/v1/cluster-agent/manifest?grant=<manifest-grant>'
```

该 URL 包含一个与 Cluster Agent Token 分离的加密 Manifest Grant。Grant 会在 10 分钟后过期，只要 JWT Secret 不变，Kite 重启后仍然有效。Grant 在过期前可以重复使用，因此请尽快执行该命令，或改用对话框中展示的 YAML。返回的 YAML 仍包含 Cluster Agent Token，必须按敏感凭据处理。

**方式二：复制 YAML 手动部署**

在连接信息对话框中复制 YAML 并保存为文件后，可以直接部署：

```bash
kubectl apply -f kite-cluster-agent.yaml
```

Deployment 使用的镜像由平台设置中的 **Cluster Agent Image** 配置，默认为 `ghcr.io/kite-org/kite:latest`。通过 Secret 将 Token 注入 Cluster Agent 进程。

### 2. 在目标集群中启动

使用命令行自行启动时，应在能够访问 kube-apiserver 的 Pod 中运行生成的命令。未指定 `--kubeconfig` 时，Cluster Agent 使用 `rest.InClusterConfig()` 读取 Pod 的 ServiceAccount 凭据。

Cluster Agent 成功连接后，集群管理页面会显示为“已连接”。连接中断时，Cluster Agent 每隔 5 秒尝试重新连接。

### 3. 使用本地 kubeconfig 测试

本地开发和测试时，可以显式指定 kubeconfig：

```bash
kite cluster-agent \
  --server='http://localhost:8080' \
  --token='<cluster-agent-token>' \
  --public-key='<registration-public-key>' \
  --kubeconfig='/path/to/kubeconfig'
```

此时 Cluster Agent 使用 kubeconfig 当前上下文中的 API Server 和认证信息。`http://` 仅建议用于本机测试，生产环境应使用 `https://`。

## 需要注意的点

### Token 安全

- Cluster Agent Token 当前没有有效期，在对应集群存在且处于启用状态时可以持续用于重新连接。禁用集群会主动关闭已经建立的 Cluster Agent Session，并拒绝后续重连；Cluster Agent 会持续重试，重新启用后可使用原 Token 自动恢复连接。
- Kite 数据库只保存 Token 哈希，原始 Token 只在创建集群后展示一次，请立即妥善保存。
- X25519 私钥使用 `KITE_ENCRYPT_KEY` 加密存储，公钥会固定在生成的 Cluster Agent 命令和 Deployment Manifest 中。
- 当前没有单独的 Token 轮换接口。Token 泄露时，应删除并重新创建 Cluster Agent 集群，生成新 Token。
- `--token` 会出现在进程参数和 Shell 历史中。应限制 Cluster Agent 主机的登录与进程查看权限，不要在日志、工单或聊天中粘贴真实 Token。

### 服务端身份校验

- 生产环境必须使用 `https://`，并使用 Cluster Agent 运行环境信任的 CA 签发 Kite Server 证书。Cluster Agent 会按标准 TLS 规则校验证书域名和信任链，从而避免连接到伪造的 Kite Server。
- 使用 `http://` 时没有服务端身份校验，Token 和隧道数据也不受 TLS 保护，只适合受控的本地测试。
- 当前连接使用 Bearer Token，尚未实现 mTLS、客户端证书签发和证书轮换。

### Kubernetes 权限与审计

- Cluster Agent 的 ServiceAccount 或 kubeconfig 权限决定 Kite 能够在集群中执行哪些操作。若需要使用日志、终端等功能，应同时授予对应的 Kubernetes RBAC 权限。
- 当前生成的 YAML 会把 Cluster Agent ServiceAccount 绑定到 `cluster-admin`，拥有整个集群的管理权限。部署前应确认这符合你的安全要求。
- Kite 用户仍受 Kite 自身 RBAC 控制，但 kube-apiserver 看到的请求身份是 Cluster Agent 使用的 ServiceAccount 或 kubeconfig 用户，而不是实际的 Kite 登录用户。
- Cluster Agent 集群不会转发用户级 Kubernetes Impersonation。Kite Server 会移除 `Impersonate-*` 请求头，并使用 Cluster Agent 注册的凭据访问 Kubernetes。

### 网络与可用性

- Cluster Agent 只需要主动访问 Kite Server 和目标集群 kube-apiserver，不需要向集群外暴露新的监听端口。
- Kite Server 的 Kubernetes Transport 会直接调用 remotedialer Session，不会创建 HTTPS 回环代理。Cluster Agent 作为 TCP 代拨端，不启动本地 HTTP 监听端口。
- Kite 前方的 Ingress 或反向代理必须支持 WebSocket Upgrade 和长连接。
- 当前尚未实现跨多个 Kite Server 副本的 Cluster Agent Session 路由。使用 Cluster Agent 集群时，应先使用单个 Kite Server 副本。
- 隧道断开会中止正在运行的日志、Watch 或终端连接。Cluster Agent 重连后，需要由客户端重新发起这些流式请求。
- 终端和命令执行优先使用 WebSocket，并在升级失败时回退到 SPDY；API Server 及中间代理需要支持对应的连接升级。
