# Configuration File

Kite supports loading cluster, OAuth/LDAP, and RBAC configuration from a YAML file. When a section is configured this way, it becomes **read-only** in the UI — users can view the settings but cannot modify them through the dashboard.

This is useful for GitOps workflows where configuration is version-controlled and applied via Helm.

> Available in Kite `v0.10.0` and later.

## How It Works

1. Kite reads a YAML config file from the path specified by the `KITE_CONFIG_FILE` environment variable.
2. On every startup, the config is applied to the database, overwriting existing values for managed sections.
3. Sensitive values in the config file support `${ENV_VAR}` placeholder expansion from environment variables.
4. The UI automatically detects managed sections and displays them as read-only with an informational banner.
5. Write API endpoints for managed sections return `403 Forbidden`.

## Config File Format

```yaml
superUser:
  username: "admin"
  password: "change-me-in-production"

clusters:
  - name: production
    description: "Production cluster"
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
      description: "Administrator role with full access"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["*"]
    - name: viewer
      description: "Read-only access"
      clusters: ["*"]
      namespaces: ["*"]
      resources: ["*"]
      verbs: ["get", "log"]
    - name: dev-team
      description: "Development team access"
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

You only need to include the sections you want to manage. For example, if you only want to manage clusters via config file, just include the `clusters` section — OAuth, LDAP, and RBAC will remain editable through the UI.

## Using with Helm

There are two approaches to provide the config file via Helm.

### Approach 1: Existing Secret (Recommended)

Create and manage your own Kubernetes Secret containing the config file. This is the recommended approach for production since it keeps sensitive values (kubeconfigs, OAuth secrets, LDAP passwords) in a proper Secret.

**Step 1:** Create your `config.yaml` file locally.

**Step 2:** Create the Kubernetes Secret:

```bash
kubectl create secret generic kite-config \
  --from-file=config.yaml=./config.yaml \
  -n <namespace>
```

**Step 3:** Reference it in your Helm values:

```yaml
config:
  enabled: true
  existingSecret: "kite-config"
```

::: tip
You can manage the Secret with tools like [External Secrets Operator](https://external-secrets.io/), [Sealed Secrets](https://sealed-secrets.netlify.app/), or any GitOps-compatible secret management solution.
:::

### Approach 2: Inline Configuration

Define the configuration directly in Helm values. A Secret is automatically generated. Suitable for simple setups or development environments.

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

#### Using Environment Variable Placeholders

For sensitive values in inline configuration, use `${ENV_VAR}` placeholders. These are expanded from environment variables at startup. Combine with `extraEnvs` to inject secrets from Kubernetes Secrets:

```yaml
# Reference external secrets as environment variables
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

# Use placeholders in config
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

## Config Values Reference

### Super User Configuration

| Field      | Type   | Description                           | Required |
| ---------- | ------ | ------------------------------------- | -------- |
| `username` | string | Super user username                   | Yes      |
| `password` | string | Super user password                   | Yes      |

The super user is created on first startup if it doesn't exist. On subsequent startups, the password is updated to match the config file.

### Cluster Configuration

| Field           | Type    | Description                     | Required |
| --------------- | ------- | ------------------------------- | -------- |
| `name`          | string  | Unique cluster name             | Yes      |
| `description`   | string  | Cluster description             | No       |
| `config`        | string  | Kubeconfig YAML content         | No *     |
| `prometheusURL` | string  | Prometheus endpoint URL         | No       |
| `inCluster`     | boolean | Use in-cluster service account  | No       |
| `default`       | boolean | Set as default cluster          | No       |

\* Either `config` or `inCluster: true` must be provided.

### OAuth Provider Configuration

| Field           | Type    | Description                                 | Required |
| --------------- | ------- | ------------------------------------------- | -------- |
| `name`          | string  | Provider name (e.g., "google", "github")    | Yes      |
| `clientId`      | string  | OAuth client ID                             | Yes      |
| `clientSecret`  | string  | OAuth client secret                         | Yes      |
| `issuer`        | string  | OIDC issuer URL (enables auto-discovery)    | No       |
| `authUrl`       | string  | Authorization endpoint (if no issuer)       | No       |
| `tokenUrl`      | string  | Token endpoint (if no issuer)               | No       |
| `userInfoUrl`   | string  | User info endpoint (if no issuer)           | No       |
| `scopes`        | string  | Comma-separated scopes                      | No       |
| `usernameClaim` | string  | JWT claim for username                      | No       |
| `groupsClaim`   | string  | JWT claim for groups                        | No       |
| `allowedGroups` | string  | Comma-separated list of allowed groups      | No       |
| `enabled`       | boolean | Enable this provider                        | No       |

### LDAP Configuration

| Field                  | Type    | Description                          | Default        |
| ---------------------- | ------- | ------------------------------------ | -------------- |
| `enabled`              | boolean | Enable LDAP authentication           | `false`        |
| `serverUrl`            | string  | LDAP server URL                      |                |
| `useStartTLS`          | boolean | Use StartTLS for `ldap://`           | `false`        |
| `bindDn`               | string  | Service account DN                   |                |
| `bindPassword`         | string  | Service account password             |                |
| `userBaseDn`           | string  | Base DN for user searches            |                |
| `userFilter`           | string  | User search filter                   | `(uid=%s)`     |
| `usernameAttribute`    | string  | Username attribute                   | `uid`          |
| `displayNameAttribute` | string  | Display name attribute               | `cn`           |
| `groupBaseDn`          | string  | Base DN for group searches           |                |
| `groupFilter`          | string  | Group membership filter              | `(member=%s)`  |
| `groupNameAttribute`   | string  | Group name attribute                 | `cn`           |

### RBAC Configuration

#### Role

| Field         | Type     | Description                              | Required |
| ------------- | -------- | ---------------------------------------- | -------- |
| `name`        | string   | Role name                                | Yes      |
| `description` | string   | Role description                         | No       |
| `clusters`    | string[] | Cluster patterns (`*`, `prod-*`, `!dev`) | Yes      |
| `namespaces`  | string[] | Namespace patterns                       | Yes      |
| `resources`   | string[] | Resource types (`pods`, `*`, etc.)       | Yes      |
| `verbs`       | string[] | Allowed verbs (`get`, `create`, `*`)     | Yes      |

#### Role Mapping

| Field        | Type     | Description                     | Required |
| ------------ | -------- | ------------------------------- | -------- |
| `name`       | string   | Role name to map to             | Yes      |
| `users`      | string[] | Usernames (`*` for all users)   | No       |
| `oidcGroups` | string[] | OIDC/LDAP group names           | No       |

## Behavior Notes

- **Startup override**: Config is re-applied on every startup. Changes made to managed sections through the database will be overwritten.
- **Super user**: Created on first startup if it doesn't exist. On subsequent startups, the password is updated to match the config file.
- **Setup wizard skip**: When clusters are configured via config file, the initialization wizard is automatically skipped.
- **Partial management**: You can manage some sections via config file and leave others for UI management. Only sections present in the config file become read-only.
- **System roles**: The default `admin` and `viewer` system roles are updated (not duplicated) when defined in the RBAC config.
