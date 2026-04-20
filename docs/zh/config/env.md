# 环境变量

Kite 默认支持一些环境变量，来改变一些配置项的默认值。

- **KITE_CONFIG_FILE**：配置文件路径。该功能仅适用于 Kite `v0.10.0` 及以上版本。设置后，Kite 从该文件加载集群、OAuth、LDAP、RBAC 和超级用户设置。详见[配置文件](/zh/config/config-file)。
- **KITE_USERNAME**：兼容旧配置的超级用户名环境变量。仅在未设置 `KITE_CONFIG_FILE` 时，用于环境变量到数据库配置的迁移。
- **KITE_PASSWORD**：兼容旧配置的超级用户密码环境变量。仅在未设置 `KITE_CONFIG_FILE` 时，用于环境变量到数据库配置的迁移。
- **KUBECONFIG**：兼容旧配置的 kubeconfig 环境变量。仅在未设置 `KITE_CONFIG_FILE` 时读取并导入集群配置。
- **ANONYMOUS_USER_ENABLED**：启用匿名用户访问，默认值为 `false`，当启用后所有访问将不再需要身份验证，并且默认拥有最高权限。

- **JWT_SECRET**：用于签名和验证 JWT 的密钥
- **KITE_ENCRYPT_KEY**：用于加密敏感数据的密钥, 例如用户密码，OAuth 的 clientSecret ，kubeconfig 等。

- **HOST**: 用户 OAuth 2.0 授权回调地址生成，默认会从请求头获取，如果您发现结果不及预期可以手动配置此环境变量。

- **NODE_TERMINAL_IMAGE**: 用于生成 Node Terminal Agent 的 Docker 镜像。

- **ENABLE_ANALYTICS**：启用数据分析功能，默认值为 `false`。当启用后，Kite 将收集有限数据以帮助改进产品。

- **PORT**：Kite 运行的端口，默认值为 `8080`。
