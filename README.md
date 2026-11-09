<div align="center">

<img src="./docs/assets/logo.svg" alt="Kite logo" width="128" height="128">

# Kite

**All your clusters. One workspace.**

Kite is a lightweight, open-source Kubernetes workspace for multi-cluster operations, observability, access control, and AI-assisted troubleshooting.

Use **Kite Desktop (Beta)** on macOS and Windows, or deploy Kite as a shared web console.

[![Release](https://img.shields.io/github/v/release/kite-org/kite?style=flat-square&logo=github&label=Release)](https://github.com/kite-org/kite/releases)
[![Stars](https://img.shields.io/github/stars/kite-org/kite?style=flat-square&logo=github&label=Stars)](https://github.com/kite-org/kite/stargazers)
[![Downloads](https://img.shields.io/github/downloads/kite-org/kite/total?style=flat-square&logo=github&label=Downloads)](https://github.com/kite-org/kite/releases)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg?style=flat-square)](LICENSE)

[**Documentation**](https://kitehq.dev) · [**Releases**](https://github.com/kite-org/kite/releases) · [**Community**](https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg)

**English** · [中文](./README_zh.md)

</div>

<img width="1586" height="1167" alt="image" src="https://github.com/user-attachments/assets/5710204d-5d34-44af-85dc-3b436e205c12" />

## Why Kite

### Observe

- Monitor CPU, memory, and network usage with per-cluster Prometheus integrations.
- Stream and filter pod logs, then inspect events, conditions, and related resources in context.

### Operate

- Manage core Kubernetes resources, CRDs, and Helm releases across multiple clusters.
- Edit live YAML, scale or restart workloads, and use browser-based pod, node, and kubectl terminals.
- Find resources with global search and access pods or services through the built-in Kube Proxy.

### Govern

- Support OAuth, LDAP, local accounts, MFA, and passkey login.
- Control access with RBAC and per-cluster permissions, backed by audit logs for resource changes.

### Work with AI

- Inspect resources, logs, and Prometheus metrics with the built-in AI assistant.
- Review and confirm write operations before execution; the assistant respects the current user's RBAC permissions.

## Quick Start

### Kite Desktop (Beta)

Manage your clusters with local kubeconfig files on macOS and Windows, without deploying a Kite server.

Download: [macOS DMG](https://github.com/kite-org/kite/releases/latest/download/kite-darwin-arm64.dmg) · [Windows x64 installer](https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.exe).

On macOS (Apple Silicon, macOS 13+), you can also install with Homebrew:

```bash
brew install --cask kite-org/tap/kite
```

The macOS beta is not yet signed or notarized. If the first launch is blocked, run:

```bash
xattr -dr com.apple.quarantine "/Applications/Kite.app"
```

### Self-hosted with Helm

For a quick evaluation, install Kite from the OCI registry into a dedicated namespace:

```bash
helm install kite oci://ghcr.io/kite-org/charts/kite \
  --namespace kite-system \
  --create-namespace
```

Forward the service to your local machine:

```bash
kubectl port-forward --namespace kite-system svc/kite 8080:8080
```

Open [http://localhost:8080](http://localhost:8080), create the first administrator, and follow the setup flow to connect a cluster. When Kite runs inside the cluster it manages, choose the `in-cluster` connection type for the simplest setup.

> [!IMPORTANT]
> The default chart values are intended for evaluation. Before using Kite in production, enable persistent storage or configure an external database, replace the default encryption key, and review the chart's cluster-wide RBAC permissions. See the [installation guide](https://kitehq.dev/guide/installation) and [chart values](https://kitehq.dev/config/chart-values).

## Other Installation Options

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

The standalone manifest is intended for evaluation and stores application data inside the container unless you add persistent storage.

```bash
kubectl apply -f https://raw.githubusercontent.com/kite-org/kite/main/deploy/install.yaml
kubectl port-forward --namespace kube-system svc/kite 8080:8080
```

The manifest grants its service account `cluster-admin`. Review and restrict these permissions before using it outside a test environment.

### Build from Source

Building Kite requires Go 1.26, Node.js `^20.19.0` or `>=22.12.0`, pnpm, and Make.

```bash
git clone https://github.com/kite-org/kite.git
cd kite
make deps
make build
./kite
```

## Documentation

| Topic                                  | Guide                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Desktop (Beta)                         | [Desktop guide](./docs/guide/desktop.md)                                                                                        |
| Installation and exposure              | [Installation](https://kitehq.dev/guide/installation)                                                                           |
| Users, authentication, and permissions | [User management](https://kitehq.dev/config/user-management) · [RBAC](https://kitehq.dev/config/rbac-config)                    |
| Monitoring                             | [Prometheus setup](https://kitehq.dev/config/prometheus-setup)                                                                  |
| Operations                             | [Helm management](https://kitehq.dev/guide/helm-management) · [Kite Cluster Agent](https://kitehq.dev/guide/kite-cluster-agent) |
| AI                                     | [AI assistant](https://kitehq.dev/guide/ai-assistant)                                                                           |
| API                                    | [API documentation](https://kitehq.dev/api/authentication)                                                                      |

## Community

- Read the [contributing guidelines](./CONTRIBUTING.md) before opening a pull request.
- Report vulnerabilities according to the [security policy](./SECURITY.md).
- Ask questions and meet other users in the [Kite Slack community](https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg).

## Support This Project

If you find Kite helpful, please consider supporting its development. Your donations help maintain and improve the project.

<table>
  <tr>
    <td align="center">
      <b>Alipay</b><br>
      <img src="./docs/donate/alipay.jpeg" alt="Alipay QR Code" width="200">
    </td>
    <td align="center">
      <b>WeChat Pay</b><br>
      <img src="./docs/donate/wechat.jpeg" alt="WeChat Pay QR Code" width="200">
    </td>
    <td align="center">
      <b>PayPal</b><br>
      <a href="https://www.paypal.me/zxh326">
        <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg" alt="PayPal" width="150">
      </a>
    </td>
  </tr>
</table>

Thank you for your support! ❤️

## License

Kite is licensed under the [Apache License 2.0](LICENSE).
