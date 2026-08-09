---
outline: deep
---

# Kite Connector

Kite Connector is used to onboard Kubernetes clusters that Kite Server cannot reach directly. The Connector runs inside the target cluster, initiates the connection to Kite, and forwards Kubernetes API requests issued by Kite over that connection.

## Background

In private networks, edge environments, or firewall-restricted scenarios, the target cluster may be able to reach Kite while Kite Server cannot connect to the cluster's kube-apiserver. The traditional kubeconfig onboarding method requires Kite Server to connect to kube-apiserver, so it cannot cover this one-way network topology.

Kite Connector reverses the connection direction:

- The Connector dials Kite Server from the cluster side; Kite does not need to enter the cluster network.
- Kubernetes credentials stay in the Connector's runtime environment and are never uploaded to Kite Server.
- Kite still uses its existing Kubernetes Client to access the cluster, so resource management, logs, and terminals do not need a separate protocol.

## How It Works

The connection chain looks like this:

```text
Kite Kubernetes Client
        │
        ▼
Kite Server local loopback port
        │
        ▼
WebSocket tunnel (established by the Connector)
        │
        ▼
Connector local Kubernetes API reverse proxy
        │
        ▼
Target cluster kube-apiserver
```

The detailed process:

1. When you create a Connector cluster in the Kite UI, Kite generates a random connection token, stores only its SHA-256 hash, and shows the raw token once after creation.
2. The Connector connects to Kite Server's `/api/v1/connector/connect` WebSocket endpoint using the token. Kite validates the token and binds the connection to the corresponding cluster.
3. Kite Server creates a random port listening only on `127.0.0.1` for that cluster. The existing Kubernetes Client connects to this port, and requests are tunneled to the Connector.
4. The Connector also creates a Kubernetes API reverse proxy listening only on `127.0.0.1` and uses its local ServiceAccount or kubeconfig to reach kube-apiserver.
5. The Connector strips any `Authorization` and `Impersonate-*` headers coming from Kite, then its local Kubernetes Transport injects the Connector's own cluster credentials.

A single Connector WebSocket can carry multiple Kubernetes API connections. Streaming requests such as logs, watches, and terminals also travel over the same tunnel.

## Usage

### 1. Create a Connector Cluster

Go to **Settings → Cluster Management** in Kite, select **Add Cluster**, and then:

1. Fill in the cluster name and description.
2. Set the cluster type to **Kite Connector**.
3. Create the cluster.

After creation, Kite shows the connection info only once, and you can choose the command-line or Kubernetes YAML option.

Command-line option:

```bash
kite connector --server='https://kite.example.com' --token='<connector-token>'
```

`--server` may include Kite's Base Path. For example:

```bash
kite connector --server='https://kite.example.com/kite' --token='<connector-token>'
```

The Connector automatically appends `/api/v1/connector/connect` to this address; do not add this API path to `--server` manually.

The Kubernetes YAML option creates the following resources:

- A `kite-connector-token` Secret in the `kube-system` namespace to hold the Connector Token.
- A `kite-connector` ServiceAccount in the `kube-system` namespace.
- A ClusterRoleBinding that binds this ServiceAccount to `cluster-admin`.
- A single-replica `kite-connector` Deployment in the `kube-system` namespace.

You can deploy in either of the following ways:

**Option 1: Deploy directly via URL**

After creation, Kite generates a manifest download URL that you can apply directly with `kubectl apply`:

```bash
kubectl apply -f 'https://kite.example.com/api/v1/connector/manifest?grant=<manifest-grant>'
```

The URL contains an encrypted manifest grant that is separate from the Connector Token. The grant expires after 10 minutes and remains valid across Kite restarts while the JWT secret is unchanged. It can be reused until it expires, so apply it promptly or use the YAML shown in the dialog. The returned YAML contains the Connector Token and must still be handled as a secret.

**Option 2: Copy the YAML and deploy manually**

Copy the YAML from the connection info dialog, save it to a file, and then deploy:

```bash
kubectl apply -f kite-connector.yaml
```

The image used by the Deployment is configured via **Connector Image** in the platform settings, defaulting to `ghcr.io/kite-org/kite:latest`. The token is injected into the Connector process via a Secret.

### 2. Start It in the Target Cluster

When starting manually via the command line, run the generated command inside a Pod that can reach kube-apiserver. When `--kubeconfig` is not specified, the Connector uses `rest.InClusterConfig()` to read the Pod's ServiceAccount credentials.

Once the Connector connects successfully, the cluster management page shows it as "Connected". If the connection drops, the Connector retries every 5 seconds.

### 3. Test with a Local kubeconfig

For local development and testing, you can specify a kubeconfig explicitly:

```bash
kite connector \
  --server='http://localhost:8080' \
  --token='<connector-token>' \
  --kubeconfig='/path/to/kubeconfig'
```

The Connector then uses the API server and credentials from the kubeconfig's current context. `http://` is recommended only for local testing; production should use `https://`.

## Things to Note

### Token Security

- The Connector Token currently has no expiry. As long as the corresponding cluster exists and is enabled, it can be used to reconnect. Disabling a cluster stops Kite from using it and rejects subsequent new or reconnecting Connector handshakes, but does not actively close already-established Connector sessions; re-enabling the cluster keeps the original token valid.
- The Kite database stores only the token hash. The raw token is shown only once after cluster creation, so save it somewhere safe immediately.
- There is no dedicated token rotation endpoint yet. If a token leaks, delete and recreate the Connector cluster to generate a new token.
- `--token` appears in process arguments and shell history. Restrict login and process-viewing permissions on the Connector host, and never paste the real token into logs, tickets, or chats.

### Server Identity Verification

- Production must use `https://` with a Kite Server certificate issued by a CA trusted by the Connector's runtime environment. The Connector validates the certificate domain and trust chain by standard TLS rules, preventing connections to a forged Kite Server.
- With `http://` there is no server identity verification, and neither the token nor the tunnel data is protected by TLS. Use it only for controlled local testing.
- The connection currently uses a Bearer Token; mTLS, client certificate issuance, and certificate rotation are not yet implemented.

### Kubernetes Permissions and Auditing

- The permissions of the Connector's ServiceAccount or kubeconfig determine what Kite can do in the cluster. If you need features like logs or terminals, grant the corresponding Kubernetes RBAC permissions as well.
- The generated YAML binds the Connector ServiceAccount to `cluster-admin`, granting administrative privileges over the entire cluster. Confirm this meets your security requirements before deploying.
- Kite users are still governed by Kite's own RBAC, but the identity kube-apiserver sees is the ServiceAccount or kubeconfig user used by the Connector, not the actual logged-in Kite user.
- The Connector does not accept Kubernetes `Authorization` or `Impersonate-*` headers passed in from Kite.

### Network and Availability

- The Connector only needs outbound access to Kite Server and the target cluster's kube-apiserver; it does not expose any new listening port to the outside.
- Both Kite Server and the Connector process create random ports bound only to `127.0.0.1`, which is normal behavior of the internal forwarding chain.
- The Ingress or reverse proxy in front of Kite must support WebSocket Upgrade and long-lived connections.
- Connector session routing across multiple Kite Server replicas is not yet implemented. When using Connector clusters, run a single Kite Server replica first.
- A tunnel disconnect aborts any running logs, watch, or terminal connections. After the Connector reconnects, clients must re-initiate these streaming requests.
- Terminals and command execution prefer WebSocket and fall back to SPDY on upgrade failure; the API server and intermediate proxies must support the corresponding connection upgrade.
