---
outline: deep
---

# Download a kubeconfig

Kite can generate a kubeconfig that lets you use `kubectl` against the Kubernetes API through Kite. The downloaded file contains a dedicated, stateful Kubeconfig Token; it does not contain your browser login token, a target cluster kubeconfig, or Cluster Agent credentials.

## Download and select clusters

1. Sign in and select a cluster you can access.
2. In the top toolbar, select **Download Kubeconfig** next to **Kubectl Terminal**.
3. The current accessible, enabled cluster is selected by default. Select more clusters, or use **Select all** / **Deselect all**. When there are many clusters, use the search box to filter them by name.
4. Select an expiration preset, or choose **Custom** and select the expiration year, month, day, hour, minute, and second.
5. Select **Download**. Kite downloads `kite-kubeconfig.yaml`.

The default lifetime is 30 days. Available presets are 1 day, 7 days, 30 days, and 1 year. Custom durations must be whole seconds from 3,600 seconds (1 hour) through 157,680,000 seconds (1,825 days). The expiry displayed in the dialog is an estimate; the server determines the final expiry time.

Each selected cluster gets its own cluster and context. If the current cluster is selected, it is the kubeconfig `current-context`; otherwise the first selected cluster is used.

## Use the downloaded file

Treat the file as a password. Restrict its permissions before using it:

```bash
chmod 600 ~/Downloads/kite-kubeconfig.yaml
export KUBECONFIG=~/Downloads/kite-kubeconfig.yaml
kubectl config get-contexts
kubectl get pods -A
```

You can also pass the file for one command:

```bash
kubectl --kubeconfig ~/Downloads/kite-kubeconfig.yaml get pods -A
```

Kite authorizes every proxied Kubernetes request using your current Kite account and RBAC permissions. Changes to your account, cluster access, namespace permissions, or resource permissions affect subsequent commands.

## Streaming and interactive commands

The proxy is intended for normal Kubernetes API requests as well as Watch, logs, `exec`, `attach`, and `port-forward` requests. For example:

```bash
kubectl get pods -A -w
kubectl logs -f deployment/example
kubectl exec -it pod/example -- sh
kubectl port-forward service/example 8080:80
```

The `ktctl` version and supported command scope have not yet been confirmed. Do not treat ktctl compatibility as a release guarantee until the project publishes the fixed version and command matrix.

## Token lifecycle and deletion

Every download creates a separate Kubeconfig Token. Tokens cannot be refreshed or extended; download a new kubeconfig when one expires. Deleting one token does not affect your other kubeconfig downloads.

In **Account Settings**, use the separate **Kubeconfig Tokens** section to view your token metadata and delete a token you no longer need. Administrators can view and delete tokens in their separate management view. Neither view exposes the kubeconfig JWT, its `jti`, or its hash.

Deleting a token removes its record, invalidates it immediately, and cannot be undone or recovered. After a token expires or is deleted, `kubectl` requests receive HTTP 401 with a Kubernetes Status message asking you to download a new kubeconfig. If the file is lost or exposed, delete its token immediately and download a replacement only if needed.
