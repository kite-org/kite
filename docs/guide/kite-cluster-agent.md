---
outline: deep
---

# Kite Cluster Agent

Kite Cluster Agent is used to onboard Kubernetes clusters that Kite Server cannot reach directly. The Cluster Agent runs inside the target cluster, initiates the connection to Kite, and forwards Kubernetes API requests issued by Kite over that connection.

## Background

In private networks, edge environments, or firewall-restricted scenarios, the target cluster may be able to reach Kite while Kite Server cannot connect to the cluster's kube-apiserver. The traditional kubeconfig onboarding method requires Kite Server to connect to kube-apiserver, so it cannot cover this one-way network topology.

Kite Cluster Agent reverses the connection direction:

- The Cluster Agent dials Kite Server from the cluster side; Kite does not need to enter the cluster network.
- Kubernetes credentials are encrypted with the cluster's registration public key before they are uploaded to Kite Server.

## How It Works

The connection chain looks like this:

```text
Kite Kubernetes Client
        │
        ▼
Kite Server Kubernetes authentication transport
        │
        ▼
remotedialer server
        │
        ▼
WebSocket tunnel (established by the Cluster Agent)
        │
        ▼
Cluster Agent TCP dial
        │
        ▼
Target cluster kube-apiserver
```

The detailed process:

1. When you create a Cluster Agent cluster in the Kite UI, Kite generates a random connection token and an X25519 registration key pair. It stores only the token's SHA-256 hash, encrypts the registration private key in the database, and shows the raw token and public key once after creation.
2. The Cluster Agent loads its in-cluster ServiceAccount or kubeconfig, encrypts it, and sends it to `/api/v1/cluster-agent/register`. The Cluster Agent refreshes this registration every 10 minutes.
3. Kite Server decrypts the registration with the cluster private key and keeps the decrypted configuration and credentials in process memory.
4. After registering successfully, the Cluster Agent connects to `/api/v1/cluster-agent/connect` using the connection token. Kite validates the token and binds the session to the corresponding cluster.
5. Kite Server can then access the cluster's kube-apiserver directly through this WebSocket tunnel, forwarding Kubernetes API requests and streaming requests.

## Usage

### 1. Create a Cluster Agent Cluster

Go to **Settings → Cluster Management** in Kite, select **Add Cluster**, and then:

1. Fill in the cluster name and description.
2. Set the cluster type to **Kite Cluster Agent**.
3. Create the cluster.

After creation, Kite shows the connection info only once, and you can choose the command-line or Kubernetes YAML option.

Command-line option:

```bash
kite cluster-agent --server='https://kite.example.com' --token='<cluster-agent-token>' --public-key='<registration-public-key>'
```

`--server` may include Kite's Base Path. For example:

```bash
kite cluster-agent --server='https://kite.example.com/kite' --token='<cluster-agent-token>' --public-key='<registration-public-key>'
```

The Cluster Agent automatically appends the `/api/v1/cluster-agent/register` and `/api/v1/cluster-agent/connect` paths as needed; pass only the Kite Server base address to `--server`.

The Kubernetes YAML option creates the following resources:

- A `kite-cluster-agent-token` Secret in the `kube-system` namespace to hold the Cluster Agent Token.
- A `kite-cluster-agent` ServiceAccount in the `kube-system` namespace.
- A ClusterRoleBinding that binds this ServiceAccount to `cluster-admin`.
- A single-replica `kite-cluster-agent` Deployment in the `kube-system` namespace.

You can deploy in either of the following ways:

**Option 1: Deploy directly via URL**

After creation, Kite generates a manifest download URL that you can apply directly with `kubectl apply`:

```bash
kubectl apply -f 'https://kite.example.com/api/v1/cluster-agent/manifest?grant=<manifest-grant>'
```

The URL contains an encrypted manifest grant that is separate from the Cluster Agent Token. The grant expires after 10 minutes and remains valid across Kite restarts while the JWT secret is unchanged. It can be reused until it expires, so apply it promptly or use the YAML shown in the dialog. The returned YAML contains the Cluster Agent Token and must still be handled as a secret.

**Option 2: Copy the YAML and deploy manually**

Copy the YAML from the connection info dialog, save it to a file, and then deploy:

```bash
kubectl apply -f kite-cluster-agent.yaml
```

The image used by the Deployment is configured via **Cluster Agent Image** in the platform settings, defaulting to `ghcr.io/kite-org/kite:latest`. The token is injected into the Cluster Agent process via a Secret.

### 2. Start It in the Target Cluster

When starting manually via the command line, run the generated command inside a Pod that can reach kube-apiserver. When `--kubeconfig` is not specified, the Cluster Agent uses `rest.InClusterConfig()` to read the Pod's ServiceAccount credentials.

Once the Cluster Agent connects successfully, the cluster management page shows it as "Connected". If the connection drops, the Cluster Agent retries every 5 seconds.

### 3. Test with a Local kubeconfig

For local development and testing, you can specify a kubeconfig explicitly:

```bash
kite cluster-agent \
  --server='http://localhost:8080' \
  --token='<cluster-agent-token>' \
  --public-key='<registration-public-key>' \
  --kubeconfig='/path/to/kubeconfig'
```

The Cluster Agent then uses the API server and credentials from the kubeconfig's current context. `http://` is recommended only for local testing; production should use `https://`.

## Things to Note

### Token Security

- The Cluster Agent Token currently has no expiry. As long as the corresponding cluster exists and is enabled, it can be used to reconnect. Disabling a cluster stops Kite from using it and rejects subsequent new or reconnecting Cluster Agent handshakes, but does not actively close already-established Cluster Agent sessions; re-enabling the cluster keeps the original token valid.
- The Kite database stores only the token hash. The raw token is shown only once after cluster creation, so save it somewhere safe immediately.
- The X25519 private key is encrypted at rest with `KITE_ENCRYPT_KEY`. The public key is pinned in the generated Cluster Agent command and Deployment manifest.
- There is no dedicated token rotation endpoint yet. If a token leaks, delete and recreate the Cluster Agent cluster to generate a new token.
- `--token` appears in process arguments and shell history. Restrict login and process-viewing permissions on the Cluster Agent host, and never paste the real token into logs, tickets, or chats.

### Server Identity Verification

- Production must use `https://` with a Kite Server certificate issued by a CA trusted by the Cluster Agent's runtime environment. The Cluster Agent validates the certificate domain and trust chain by standard TLS rules, preventing connections to a forged Kite Server.
- With `http://` there is no server identity verification, and neither the token nor the tunnel data is protected by TLS. Use it only for controlled local testing.
- The connection currently uses a Bearer Token; mTLS, client certificate issuance, and certificate rotation are not yet implemented.

### Kubernetes Permissions and Auditing

- The permissions of the Cluster Agent's ServiceAccount or kubeconfig determine what Kite can do in the cluster. If you need features like logs or terminals, grant the corresponding Kubernetes RBAC permissions as well.
- The generated YAML binds the Cluster Agent ServiceAccount to `cluster-admin`, granting administrative privileges over the entire cluster. Confirm this meets your security requirements before deploying.
- Kite users are still governed by Kite's own RBAC, but the identity kube-apiserver sees is the ServiceAccount or kubeconfig user used by the Cluster Agent, not the actual logged-in Kite user.
- Cluster Agent clusters do not forward per-user Kubernetes impersonation. Kite Server removes `Impersonate-*` headers and accesses Kubernetes with the credentials registered by the Cluster Agent.

### Network and Availability

- The Cluster Agent only needs outbound access to Kite Server and the target cluster's kube-apiserver; it does not expose any new listening port to the outside.
- Kite Server calls the remotedialer session directly from its Kubernetes transport; it does not create a loopback HTTPS proxy. The Cluster Agent acts as the TCP dialing endpoint and does not open a local HTTP listener.
- The Ingress or reverse proxy in front of Kite must support WebSocket Upgrade and long-lived connections.
- Cluster Agent session routing across multiple Kite Server replicas is not yet implemented. When using Cluster Agent clusters, run a single Kite Server replica first.
- A tunnel disconnect aborts any running logs, watch, or terminal connections. After the Cluster Agent reconnects, clients must re-initiate these streaming requests.
- Terminals and command execution prefer WebSocket and fall back to SPDY on upgrade failure; the API server and intermediate proxies must support the corresponding connection upgrade.
