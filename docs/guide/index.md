# What is Kite?

Kite is a lightweight, modern Kubernetes dashboard that unifies real-time observability, multi-cluster and resource management, enterprise-grade user governance (OAuth, RBAC, and audit logs), and AI agents in one workspace. Not just a tool, but more like a platform.

![Dashboard Overview](/screenshots/overview.png)

## ✨ Features

### User Interface

- Dark/light/color themes with system preference detection
- Global search across all resources
- Responsive design for desktop, tablet, and mobile
- i18n support (English and Chinese)

### Multi-Cluster Management

- Switch between multiple Kubernetes clusters
- Independent Prometheus configuration per cluster
- Automatic discovery from kubeconfig
- Fine-grained cluster access permissions

### Resource Management

- Full coverage: Pods, Deployments, Services, ConfigMaps, Secrets, PVs, PVCs, Nodes, and more
- Live YAML editing with Monaco editor (syntax highlighting and validation)
- Detailed views with containers, volumes, events, and conditions
- Resource relationships (e.g., Deployment -> Pods)
- Create, update, delete, scale, and restart operations
- Custom Resource Definitions (CRDs) support
- Quick image tag selector using Docker and container registry APIs
- Customizable sidebar with CRD shortcuts
- Kube proxy for direct pod/service access (no more `kubectl port-forward`)

### Monitoring & Observability

- Real-time CPU, memory, and network charts (Prometheus)
- Live pod logs with filtering and search
- Web terminal for pods and nodes
- Built-in kubectl console
- AI assistant

### Security

- OAuth integration
- Role-based access control
- User management and role allocation

## Kite vs Headlamp / Kubernetes Dashboard

Headlamp and Kubernetes Dashboard are strong cluster operation tools focused on resource inspection and control. Kite includes those dashboard capabilities, but is designed as a team platform:

- Unified workspace for observability, multi-cluster operations, governance, and AI assistance
- Built-in team governance with OAuth, RBAC, user-role mapping, and audit logs
- Operational workflows beyond resource views: web terminal, built-in kubectl console, and kube proxy
- One system for operators, developers, and admins, instead of stitching separate tools

In short: those products are dashboard tools; Kite is a platform for daily Kubernetes operations and collaboration.

## Getting Started

Ready to explore Kite? Check out the [installation guide](./installation).
