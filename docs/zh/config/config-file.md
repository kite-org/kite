# 配置文件

Kite 支持通过 YAML 配置文件来管理集群、OAuth/LDAP 和 RBAC 配置。通过配置文件管理的部分在 UI 中将变为**只读**——用户可以查看配置但无法通过界面修改。

这对于 GitOps 工作流非常有用，配置可以版本控制并通过 Helm 部署。

> 该功能仅适用于 Kite `v0.10.0` 及以上版本。

## 工作原理

1. Kite 从 `KITE_CONFIG_FILE` 环境变量指定的路径读取 YAML 配置文件。
2. 每次启动时，配置都会应用到数据库，覆盖已管理部分的现有值。
3. 配置文件中的敏感值支持 `${ENV_VAR}` 占位符，从环境变量中展开。
4. UI 自动检测已管理的部分，以只读模式显示并附带提示横幅。
5. 已管理部分的写入 API 返回 `403 Forbidden`。

## 配置文件格式

```yaml
superUser:
  username: "admin"
  password: "change-me-in-production"

clusters:
  - name: production
    description: "生产集群"
    config: |
      apiVersion: v1
      kind: Config
      clusters:
        - cluster:
            server: https://k8s.example.com
            certificate-authority-data: LS0t...
          name: production
      contexts:
        - context:
            cluster: production
            user: admin
          name: production
      current-context: production
      users:
        - name: admin
          user:
            token: eyJhb...
    prometheusURL: "http://prometheus:9090"
    default: true
  - name: local
    inCluster: true

oauth:
  - name: google
    clientId: "xxx.apps.googleusercontent.com"
    clientSecret: "client-secret-value"
    issuer: "https://accounts.google.com"
    scopes: "openid,profile,email"
    usernameClaim: "email"
    groupsClaim: "groups"
    enabled: true

ldap:
  enabled: true
  serverUrl: "ldaps://ldap.example.com:636"
  bindDn: "cn=svc-kite,ou=services,dc=example,dc=com"
  bindPassword: "bind-password"
  userBaseDn: "ou=users,dc=example,dc=com"
  userFilter: "(uid=%s)"
  usernameAttribute: "uid"
  displayNameAttribute: "cn"
  groupBaseDn: "ou=groups,dc=example,dc=com"
  groupFilter: "(member=%s)"
  groupNameAttribute: "cn"

rbac:
  roles:
    - name: admin
      description: "管理员，完全访问权限"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["*"]
    - name: viewer
      description: "只读访问"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "log"]
    - name: dev-team
      description: "开发团队权限"
      clusters: ["dev-*", "staging-*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "create", "update", "delete", "log"]
  roleMapping:
    - name: admin
      users: ["alice", "bob"]
      oidcGroups: ["platform-admins"]
    - name: viewer
      users: ["*"]
    - name: dev-team
      oidcGroups: ["developers"]
```

你只需包含想要管理的部分。例如，如果只想通过配置文件管理集群，只需包含 `clusters` 部分——OAuth、LDAP 和 RBAC 仍然可以通过 UI 编辑。

## 通过 Helm 使用

有两种方式通过 Helm 提供配置文件。

### 方式一：使用已有的 Secret（推荐）

创建并管理你自己的 Kubernetes Secret。这是生产环境推荐的方式，因为可以妥善保管敏感值（kubeconfig、OAuth 密钥、LDAP 密码）。

**步骤 1：** 在本地创建 `config.yaml` 文件。

**步骤 2：** 创建 Kubernetes Secret：

```bash
kubectl create secret generic kite-config \
  --from-file=config.yaml=./config.yaml \
  -n <namespace>
```

**步骤 3：** 在 Helm values 中引用：

```yaml
config:
  enabled: true
  existingSecret: "kite-config"
```

::: tip
你可以使用 [External Secrets Operator](https://external-secrets.io/)、[Sealed Secrets](https://sealed-secrets.netlify.app/) 或任何 GitOps 兼容的密钥管理方案来管理该 Secret。
:::

### 方式二：内联配置

直接在 Helm values 中定义配置，会自动生成 Secret。适合简单场景或开发环境。

```yaml
config:
  enabled: true
  superUser:
    username: "admin"
    password: "change-me-in-production"
  clusters:
    - name: local
      inCluster: true
      default: true
  rbac:
    roles:
      - name: admin
        clusters: ["*"]
        namespaces: ["*"]
        resources: ["*"]
        verbs: ["*"]
      - name: viewer
        clusters: ["*"]
        namespaces: ["*"]
        resources: ["*"]
        verbs: ["get", "log"]
    roleMapping:
      - name: admin
        oidcGroups: ["admins"]
      - name: viewer
        users: ["*"]
```

#### 使用环境变量占位符

对于内联配置中的敏感值，可以使用 `${ENV_VAR}` 占位符，启动时会从环境变量中展开。配合 `extraEnvs` 从 Kubernetes Secret 注入：

```yaml
# 从外部 Secret 引用环境变量
extraEnvs:
  - name: PROD_KUBECONFIG
    valueFrom:
      secretKeyRef:
        name: my-cluster-secrets
        key: prod-kubeconfig
  - name: OAUTH_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: my-oauth-secrets
        key: google-client-secret
  - name: LDAP_BIND_PWD
    valueFrom:
      secretKeyRef:
        name: my-ldap-secrets
        key: bind-password

# 在配置中使用占位符
config:
  enabled: true
  clusters:
    - name: production
      config: "${PROD_KUBECONFIG}"
      prometheusURL: "http://prometheus:9090"
      default: true
    - name: local
      inCluster: true
  oauth:
    - name: google
      clientId: "xxx.apps.googleusercontent.com"
      clientSecret: "${OAUTH_CLIENT_SECRET}"
      issuer: "https://accounts.google.com"
      enabled: true
  ldap:
    enabled: true
    serverUrl: "ldaps://ldap.example.com:636"
    bindDn: "cn=admin,dc=example,dc=com"
    bindPassword: "${LDAP_BIND_PWD}"
    userBaseDn: "ou=users,dc=example,dc=com"
    groupBaseDn: "ou=groups,dc=example,dc=com"
```

## 配置值参考

### 超级用户配置

| 字段       | 类型   | 描述           | 必填 |
| ---------- | ------ | -------------- | ---- |
| `username` | string | 超级用户用户名 | 是   |
| `password` | string | 超级用户密码   | 是   |

超级用户仅在首次启动且数据库中没有该用户时创建。后续启动会更新该用户的密码（如果配置文件中的密码发生了变化）。

### 集群配置

| 字段            | 类型    | 描述                    | 必填   |
| --------------- | ------- | ----------------------- | ------ |
| `name`          | string  | 唯一集群名称            | 是     |
| `description`   | string  | 集群描述                | 否     |
| `config`        | string  | Kubeconfig YAML 内容    | 否 *   |
| `prometheusURL` | string  | Prometheus 端点 URL     | 否     |
| `inCluster`     | boolean | 使用集群内服务账号      | 否     |
| `default`       | boolean | 设为默认集群            | 否     |

\* 必须提供 `config` 或 `inCluster: true`。

### OAuth 提供者配置

| 字段            | 类型    | 描述                                    | 必填 |
| --------------- | ------- | --------------------------------------- | ---- |
| `name`          | string  | 提供者名称（如 "google"、"github"）     | 是   |
| `clientId`      | string  | OAuth Client ID                         | 是   |
| `clientSecret`  | string  | OAuth Client Secret                     | 是   |
| `issuer`        | string  | OIDC Issuer URL（启用自动发现）         | 否   |
| `authUrl`       | string  | 授权端点（无 issuer 时）                | 否   |
| `tokenUrl`      | string  | Token 端点（无 issuer 时）              | 否   |
| `userInfoUrl`   | string  | 用户信息端点（无 issuer 时）            | 否   |
| `scopes`        | string  | 逗号分隔的 scopes                       | 否   |
| `usernameClaim` | string  | 用于用户名的 JWT claim                  | 否   |
| `groupsClaim`   | string  | 用于组的 JWT claim                      | 否   |
| `allowedGroups` | string  | 逗号分隔的允许组列表                    | 否   |
| `enabled`       | boolean | 启用此提供者                            | 否   |

### LDAP 配置

| 字段                   | 类型    | 描述                | 默认值         |
| ---------------------- | ------- | ------------------- | -------------- |
| `enabled`              | boolean | 启用 LDAP 认证      | `false`        |
| `serverUrl`            | string  | LDAP 服务器 URL     |                |
| `useStartTLS`          | boolean | 对 `ldap://` 使用 StartTLS | `false` |
| `bindDn`               | string  | 服务账号 DN         |                |
| `bindPassword`         | string  | 服务账号密码        |                |
| `userBaseDn`           | string  | 用户搜索 Base DN    |                |
| `userFilter`           | string  | 用户搜索过滤器      | `(uid=%s)`     |
| `usernameAttribute`    | string  | 用户名属性          | `uid`          |
| `displayNameAttribute` | string  | 显示名属性          | `cn`           |
| `groupBaseDn`          | string  | 组搜索 Base DN      |                |
| `groupFilter`          | string  | 组成员过滤器        | `(member=%s)`  |
| `groupNameAttribute`   | string  | 组名属性            | `cn`           |

### RBAC 配置

#### 角色

| 字段          | 类型     | 描述                                     | 必填 |
| ------------- | -------- | ---------------------------------------- | ---- |
| `name`        | string   | 角色名称                                 | 是   |
| `description` | string   | 角色描述                                 | 否   |
| `clusters`    | string[] | 集群匹配模式（`*`、`prod-*`、`!dev`）   | 是   |
| `namespaces`  | string[] | 命名空间匹配模式                         | 是   |
| `resources`   | string[] | 资源类型（`pods`、`*` 等）               | 是   |
| `verbs`       | string[] | 允许的操作（`get`、`create`、`*`）       | 是   |

#### 角色映射

| 字段         | 类型     | 描述                          | 必填 |
| ------------ | -------- | ----------------------------- | ---- |
| `name`       | string   | 要映射的角色名称              | 是   |
| `users`      | string[] | 用户名（`*` 表示所有用户）    | 否   |
| `oidcGroups` | string[] | OIDC/LDAP 组名                | 否   |

## 行为说明

- **启动覆盖**：每次启动时都会重新应用配置。通过数据库对已管理部分的修改会被覆盖。
- **超级用户**：首次启动时如果该用户不存在则创建。后续启动会同步更新密码。
- **跳过初始化向导**：当集群通过配置文件配置时，初始化向导会自动跳过。
- **部分管理**：你可以通过配置文件管理某些部分，其余部分留给 UI 管理。只有配置文件中存在的部分才会变为只读。
- **系统角色**：在 RBAC 配置中定义默认的 `admin` 和 `viewer` 系统角色时，会更新现有角色（不会重复创建）。
