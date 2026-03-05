---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Kite"
  text: "现代 Kubernetes 仪表盘"
  tagline: "在一个工作空间中统一可观测性、多集群运维、用户治理与 AI Agent"
  image:
    src: /logo.svg
    alt: Kite Logo
  actions:
    - theme: brand
      text: 开始使用
      link: /zh/guide/
    - theme: alt
      text: GitHub 查看
      link: https://github.com/kite-org/kite
    - theme: alt
      text: 查看演示
      link: https://kite-demo.zzde.me

features:
  - icon: 🖥️
    title: 用户界面
    details: 暗色/亮色/彩色主题、全局搜索、响应式设计与国际化支持
  - icon: 🏘
    title: 多集群管理
    details: 快速切换多个集群，支持按集群独立配置 Prometheus、kubeconfig 自动发现与细粒度访问控制
  - icon: 🔍
    title: 资源管理
    details: 全资源覆盖、实时 YAML 编辑、资源关系展示、CRD 支持与 Kube Proxy 直连访问
  - icon: 📈
    title: 监控与可观测性
    details: 实时指标、Pod 日志、Pod/Node Web 终端与内置 kubectl 控制台
  - icon: 🔐
    title: 安全
    details: OAuth 集成、RBAC、用户管理、角色映射与审计日志
  - icon: 🤖
    title: AI 助手
    details: 内置 AI 助手，加速日常集群运维与问题排查
---
