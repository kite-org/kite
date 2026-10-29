<div align="center">

<img src="./docs/assets/logo.svg" alt="Kite logo" width="128" height="128">

# Kite

**All your clusters. One workspace.**

Kite is a lightweight, open-source Kubernetes workspace for multi-cluster operations, observability, access control, and AI-assisted troubleshooting.

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

### Helm

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

Building Kite requires Go 1.27.3, Node.js `^20.19.0` or `>=22.12.0`, pnpm, and Make.

```bash
git clone https://github.com/kite-org/kite.git
cd kite
make deps
make build
./kite
```

### macOS desktop prototype

On macOS, build and open the MyGo desktop app:

```bash
make desktop
```

`make desktop-build` builds only. The app is created at
`bin/desktop/darwin-<architecture>/Kite MyGo.app` with an ad hoc signature for local use.
It runs the existing Kite backend on a locally assigned, persistent loopback port.
The desktop app opens without a Kite account and uses the selected cluster's
credentials and Kubernetes permissions. The main toolbar shares the title bar with the macOS
window controls; the sidebar and content scroll independently. Closing the main
window hides it and keeps the backend running. Reopen it from the Kite menu bar
item or Dock. Choose Quit Kite (or Cmd+Q) to stop the app and all connections.

The toolbar's AI button opens a separate chat window. Opening it again focuses
the existing window without interrupting the conversation. Its cluster and resource
context stays fixed to the selection at opening; close and reopen it to change context.
AI actions that modify cluster resources still require confirmation.

Pod log and terminal toolbars have an open-in-window action. These windows keep
their cluster and Pod context while the main window navigates elsewhere. Opening
the same target again focuses its existing window; window bounds are remembered.
The main toolbar's kubectl terminal also opens in a separate window per cluster.
Closing a log or terminal window ends that window's connection.

Pod and Service detail pages offer local TCP port forwarding. Choose a target port
and leave the local port blank to assign a free port, or specify one. Connections
listen only on `127.0.0.1`; the toolbar lists them with copy, open-as-HTTP, and stop
actions. They survive page changes and close when the app quits. Services require
a Pod selector and resolve to one running Pod; restart the forward if that Pod
stops. The cluster credentials need Kubernetes permission to use `pods/portforward`.
The native Kite menu bar item lists this desktop app's local forwards, including
when the main window is hidden, with copy-address, open-as-HTTP, and stop actions.

The database, plugins and local encryption key live in
`~/Library/Application Support/Kite MyGo Local`. The encryption key is stored
as a file readable by the current macOS user, not in Keychain.
The initial launch imports `~/.kube/config` (or `KUBECONFIG`) when available.
The saved port keeps the browser origin and local preferences stable across restarts;
preferences from earlier builds with random ports are not migrated. The app also
looks for credential helpers in Homebrew's usual locations, `~/.krew/bin` and
`~/.local/bin`. Other helper locations must be available in the app's `PATH`,
or specified as an absolute path in the kubeconfig. Downloads use the Downloads
folder. Cloud credential helpers still need desktop validation. This prototype
does not include notarization or automatic updates.

Replacing or reinstalling the app on the same Mac keeps the data directory. To
back up or restore the data, quit Kite first and copy the entire directory,
including its key files; treat the backup as sensitive. If `encryption.key` is
missing, Kite stops rather than creating a new key for an existing database.
Browser-local preferences are kept separately by the macOS WebView and are not
included in this directory backup.
Earlier prototypes used `~/Library/Application Support/Kite MyGo` and Keychain;
those data are left in place and are not imported. Import clusters again in this
version if they are not found in the local kubeconfig.

## Documentation

| Topic                                  | Guide                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
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
