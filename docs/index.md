---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Kite"
  text: "A modern Kubernetes dashboard"
  tagline: "Unify observability, multi-cluster operations, user governance, and AI agents in one workspace"
  image:
    src: /logo.svg
    alt: Kite Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/kite-org/kite
    - theme: alt
      text: View Demo
      link: https://kite-demo.zzde.me

features:
  - icon: 🖥️
    title: User Interface
    details: Dark/light/color themes, global search, responsive design, and i18n support
  - icon: 🏘
    title: Multi-Cluster Management
    details: Switch clusters quickly with per-cluster Prometheus setup, kubeconfig discovery, and fine-grained access control
  - icon: 🔍
    title: Resource Management
    details: Full resource coverage, live YAML editing, relationship view, CRD support, and kube proxy access
  - icon: 📈
    title: Monitoring & Observability
    details: Real-time metrics, live logs, pod/node web terminal, and built-in kubectl console
  - icon: 🔐
    title: Security
    details: OAuth integration, RBAC, user management, role mapping, and audit logs
  - icon: 🤖
    title: AI Assistant
    details: Built-in AI assistant to speed up cluster operations and troubleshooting
---
