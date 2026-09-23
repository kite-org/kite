# Kubeconfig API

Kite 提供 kubeconfig 下载接口、Token 管理接口和 Kubernetes API 代理。下载请求使用现有的已认证浏览器会话。代理仅接受专用 Kubeconfig Token，不接受浏览器登录 Token 或 API 密钥。

所有 Token 管理响应仅返回元数据，绝不返回 JWT、其 `jti` 或哈希。

## 下载 kubeconfig

```http
POST /api/v1/kubeconfig
Content-Type: application/json
```

```json
{
  "clusterUUIDs": [
    "7be79e50-6213-4e73-bdf4-f606d9ae81e2"
  ],
  "ttlSeconds": 2592000
}
```

`clusterUUIDs` 至少包含一个当前登录用户有权访问的已启用集群 UUID。`ttlSeconds` 必须是 3,600 至 157,680,000 之间的整数。

成功时直接返回下载 YAML：

```http
200 OK
Content-Type: application/yaml
Content-Disposition: attachment; filename="kite-kubeconfig.yaml"
Cache-Control: no-store
Pragma: no-cache
```

响应不是 JSON Token 响应。其内容是一个 kubeconfig，其中选中 contexts 共用一个 bearer token。

常见错误包括：请求或 UUID 无效时的 `400`、浏览器会话缺失或过期时的 `401`、用户无集群权限时的 `403`、集群不存在时的 `404`、集群已禁用时的 `409`，以及签名或文件生成失败时的 `500`。

## 当前用户 Token 管理

```http
GET    /api/users/me/kubeconfig-tokens
DELETE /api/users/me/kubeconfig-tokens/:id
```

这些接口需要已认证用户。列表仅包含当前用户拥有的 Token。`DELETE` 会物理删除 Token 记录；Token 会立即失效且不可恢复。不存在的 Token（包括属于其他用户的 Token）返回 `404`。

列表示例：

```json
{
  "tokens": [
    {
      "id": 42,
      "name": "kubeconfig-alice-20260814153045.987",
      "createdAt": "2026-08-14T07:30:45Z",
      "expiresAt": "2026-09-13T07:30:45Z",
      "lastUsedAt": "2026-08-14T08:00:00Z",
      "signingKeyId": "primary"
    }
  ]
}
```

客户端根据过期时间计算有效和已过期状态。

## 管理员 Token 管理

```http
GET    /api/v1/admin/kubeconfig-tokens
DELETE /api/v1/admin/kubeconfig-tokens/:id
```

这些接口需要已认证管理员。管理员列表在相同的安全元数据外，还包含 `ownerId` 和 `owner`。管理员可物理删除任意 Token；删除后立即失效且不可恢复。

列表支持 `page`（默认 `1`）、`size`（默认 `20`，最大 `100`）、`owner`（不区分大小写的用户名子串）和 `status`（`active` 或 `expired`）参数。结果按 `createdAt` 降序排列，响应包含 `tokens`、`total`、`page` 和 `size`。

## Kubernetes API 代理

```http
GET|POST|PUT|PATCH|DELETE /api/v1/clusters/:clusterUUID/k8s-proxy/*path
Authorization: Bearer <kubeconfig-jwt>
```

代理会转发所选集群的 Kubernetes API 路径，包括 discovery、资源操作、日志、Watch 和受支持的 Upgrade 请求。每次请求都会检查 Token 状态、所有者状态、集群访问权限和当前 Kite RBAC 权限。过期、已删除、无效或浏览器登录 Token 的请求会得到 HTTP `401` 的 Kubernetes `Status` 响应；无授权请求得到 `403`。

转发到目标 Kubernetes API 前，会移除外部 bearer token、Cookie 和 `Impersonate-*` 请求头。

## 认证模型

Kubeconfig Token 是独立签发的 JWT，包含 `iss`、`sub`、`jti`、`token_use=kubeconfig`、`iat`、`nbf` 和 `exp` claims。它不可刷新，并有服务端状态记录，因此仅校验签名不足以获得访问权限。Kite 会在每个代理请求中检查对应记录，并应用当前 RBAC，而不是在 Token 中嵌入权限快照。

### 有状态 Token 模块

Kite 使用进程内 `pkg/statefultoken` 模块处理有状态 Token 的签发、签名校验、服务端状态校验、删除和最近使用时间更新。Kubeconfig 域通过存储适配层将该模块连接到 `kubeconfig_tokens` 记录；集群选择、kubeconfig YAML 生成、用户启用状态检查、Kubernetes 请求解析和当前 RBAC 仍由 Kubeconfig/集群业务层负责。

该模块不用于浏览器会话 JWT，也不在 Token 中保存集群或资源权限。当前 Kubeconfig Token 使用单个 HS256 密钥和 KID；密钥验证集合与无中断密钥轮换尚未实现。
