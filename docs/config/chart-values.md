# Chart Values

This document describes all available configuration options for the Kite Helm Chart.

## Basic Configuration

| Parameter          | Description                                                | Default                 |
| ------------------ | ---------------------------------------------------------- | ----------------------- |
| `replicaCount`     | Number of replicas                                         | `1`                     |
| `image.repository` | Container image repository                                 | `ghcr.io/kite-org/kite` |
| `image.pullPolicy` | Image pull policy                                          | `IfNotPresent`          |
| `image.tag`        | Image tag. If set, will override the chart's `appVersion`. | `""`                    |
| `imagePullSecrets` | Image pull secrets for private repositories                | `[]`                    |
| `nameOverride`     | Override chart name                                        | `""`                    |
| `fullnameOverride` | Override full name                                         | `""`                    |
| `debug`            | Enable debug mode                                          | `false`                 |
| `basePath`         | Base path where Kite is served. See notes below.           | `""`                    |

## Authentication & Security

| Parameter              | Description                                                                              | Default                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `anonymousUserEnabled` | Enable anonymous user access with full admin privileges. Use with caution in production. | `false`                                              |
| `jwtSecret`            | Secret key for signing JWT tokens. Auto-generated on first boot if empty.                | `""`                                                 |
| `encryptKey`           | Secret key used for encrypting sensitive data. Change this in production.                | `"kite-default-encryption-key-change-in-production"` |
| `host`                 | Hostname for the application                                                             | `""`                                                 |

## Database Configuration

| Parameter | Description                                                              | Default  |
| --------- | ------------------------------------------------------------------------ | -------- |
| `db.type` | Database type: `sqlite`, `postgres`, `mysql`                             | `sqlite` |
| `db.dsn`  | Full DSN string for MySQL/Postgres. Required when type is mysql/postgres | `""`     |

### SQLite Configuration

| Parameter                                 | Description                                               | Default             |
| ----------------------------------------- | --------------------------------------------------------- | ------------------- |
| `db.sqlite.persistence.pvc.enabled`       | Whether to create a PVC to store the sqlite database file | `false`             |
| `db.sqlite.persistence.pvc.existingClaim` | Use existing PVC                                          | `""`                |
| `db.sqlite.persistence.pvc.storageClass`  | StorageClass for PVC (optional)                           | `""`                |
| `db.sqlite.persistence.pvc.accessModes`   | Access modes for PVC                                      | `["ReadWriteOnce"]` |
| `db.sqlite.persistence.pvc.size`          | Requested storage size for PVC                            | `1Gi`               |
| `db.sqlite.persistence.hostPath.enabled`  | Whether to use hostPath storage                           | `false`             |
| `db.sqlite.persistence.hostPath.path`     | hostPath path                                             | `/path/to/host/dir` |
| `db.sqlite.persistence.hostPath.type`     | hostPath type                                             | `DirectoryOrCreate` |
| `db.sqlite.persistence.mountPath`         | Mount path inside container                               | `/data`             |
| `db.sqlite.persistence.filename`          | SQLite filename inside mountPath                          | `kite.db`           |

## Environment Variables

| Parameter   | Description                              | Default |
| ----------- | ---------------------------------------- | ------- |
| `extraEnvs` | List of additional environment variables | `[]`    |

## Application Configuration

Kite supports loading cluster, OAuth/LDAP, and RBAC configuration from a YAML config file. When enabled, managed sections become read-only in the UI.

Available in Kite `v0.10.0` and later.

See [Configuration File](./config-file) for the full config file format, usage examples, and reference.

| Parameter               | Description                                                                    | Default |
| ----------------------- | ------------------------------------------------------------------------------ | ------- |
| `config.enabled`        | Enable configuration file mode                                                 | `false` |
| `config.existingSecret` | Name of an existing Secret containing a `config.yaml` key. Recommended approach. | `""`    |
| `config.superUser`      | Inline super user configuration (created on first startup only)                | `{}`    |
| `config.clusters`       | Inline cluster configurations (when no existingSecret)                         | `[]`    |
| `config.oauth`          | Inline OAuth provider configurations                                           | `[]`    |
| `config.ldap`           | Inline LDAP configuration                                                      | `{}`    |
| `config.rbac.roles`     | Inline RBAC role definitions                                                   | `[]`    |
| `config.rbac.roleMapping` | Inline RBAC role mappings                                                    | `[]`    |

## Service Account Configuration

| Parameter                    | Description                                         | Default |
| ---------------------------- | --------------------------------------------------- | ------- |
| `serviceAccount.create`      | Whether to create a service account                 | `true`  |
| `serviceAccount.automount`   | Automatically mount service account API credentials | `true`  |
| `serviceAccount.annotations` | Annotations for service account                     | `{}`    |
| `serviceAccount.name`        | Name of service account to use                      | `""`    |

## RBAC Configuration

| Parameter     | Description                      | Default           |
| ------------- | -------------------------------- | ----------------- |
| `rbac.create` | Whether to create RBAC resources | `true`            |
| `rbac.rules`  | List of RBAC rules               | See example below |

### RBAC Rules Example

```yaml
rbac:
  rules:
    - apiGroups: ["*"]
      resources: ["*"]
      verbs: ["*"]
    - nonResourceURLs: ["*"]
      verbs: ["*"]
```

## Pod Configuration

| Parameter            | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `podAnnotations`     | Kubernetes annotations for Pod | `{}`    |
| `podLabels`          | Kubernetes labels for Pod      | `{}`    |
| `podSecurityContext` | Pod security context           | `{}`    |
| `securityContext`    | Container security context     | `{}`    |

## Service Configuration

| Parameter      | Description  | Default     |
| -------------- | ------------ | ----------- |
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `8080`      |

## Ingress Configuration

| Parameter             | Description                | Default           |
| --------------------- | -------------------------- | ----------------- |
| `ingress.enabled`     | Whether to enable Ingress  | `false`           |
| `ingress.className`   | Ingress class name         | `"nginx"`         |
| `ingress.annotations` | Ingress annotations        | `{}`              |
| `ingress.hosts`       | Ingress host configuration | See example below |
| `ingress.tls`         | TLS configuration          | `[]`              |

### Ingress Host Configuration Example

```yaml
ingress:
  hosts:
    - host: kite.zzde.me
      paths:
        - path: /
          pathType: ImplementationSpecific
```

## Resource Limits

| Parameter   | Description                            | Default |
| ----------- | -------------------------------------- | ------- |
| `resources` | Container resource limits and requests | `{}`    |

### Resource Limits Example

```yaml
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 100m
    memory: 128Mi
```

## Health Checks

| Parameter        | Description                   | Default           |
| ---------------- | ----------------------------- | ----------------- |
| `livenessProbe`  | Liveness probe configuration  | See example below |
| `readinessProbe` | Readiness probe configuration | See example below |

### Health Check Example

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
```

## Storage Configuration

| Parameter      | Description                            | Default |
| -------------- | -------------------------------------- | ------- |
| `volumes`      | Additional volume configurations       | `[]`    |
| `volumeMounts` | Additional volume mount configurations | `[]`    |

## Scheduling Configuration

| Parameter      | Description               | Default |
| -------------- | ------------------------- | ------- |
| `nodeSelector` | Node selector             | `{}`    |
| `tolerations`  | Tolerations configuration | `[]`    |
| `affinity`     | Affinity configuration    | `{}`    |
