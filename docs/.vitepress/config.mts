import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Kite",
  description: "A modern Kubernetes dashboard",

  sitemap: {
    hostname: "https://kitehq.dev",
    lastmodDateOnly: false,
  },

  markdown: {
    image: {
      lazyLoading: true,
    },
  },

  lastUpdated: true,
  locales: {
    root: {
      label: "English",
      lang: "en",
    },
    zh: {
      label: "中文",
      lang: "zh-CN",
      link: "/zh/",
      title: "Kite",
      description: "一个现代 Kubernetes 仪表盘",
      themeConfig: {
        nav: [
          { text: "首页", link: "/zh/" },
          { text: "指南", link: "/zh/guide/" },
          { text: "配置", link: "/zh/config/" },
          { text: "插件", link: "/zh/plugins/" },
          { text: "API", link: "/zh/api/authentication" },
          { text: "常见问题", link: "/zh/faq" },
        ],
        editLink: {
          pattern: "https://github.com/kite-org/kite/tree/main/docs/:path",
          text: "在 GitHub 上编辑此页面",
        },
      },
    },
  },

  head: [
    ["link", { rel: "icon", href: "/logo.svg" }],
    [
      "script",
      {
        src: "https://cloud.umami.is/script.js",
        "data-website-id": "764af8e4-8fa4-4fc5-83e2-304718cc15fe",
        defer: "true",
      },
    ],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: "/logo.svg",
    search: {
      provider: "local",
    },
    langMenuLabel: "Language",
    editLink: {
      pattern: "https://github.com/kite-org/kite/tree/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/" },
      { text: "Configuration", link: "/config/" },
      { text: "Plugins", link: "/plugins/" },
      { text: "API", link: "/api/authentication" },
      { text: "FAQ", link: "/faq" },
    ],

    sidebar: {
      "/": [
        {
          text: "Introduction",
          items: [
            { text: "What is Kite?", link: "/guide/" },
            { text: "Getting Started", link: "/guide/installation" },
          ],
        },
        {
          text: "Configuration",
          items: [
            { text: "User Management", link: "/config/user-management" },
            { text: "OAuth Setup", link: "/config/oauth-setup" },
            { text: "RBAC Configuration", link: "/config/rbac-config" },
            { text: "Prometheus Setup", link: "/config/prometheus-setup" },
            { text: "Managed K8s Auth", link: "/config/managed-k8s-auth" },
            { text: "Environment Variables", link: "/config/env" },
            { text: "Configuration File", link: "/config/config-file" },
            { text: "Chart Values", link: "/config/chart-values" },
          ],
        },
        {
          text: "Usage",
          items: [
            { text: "Global Search", link: "/guide/global-search" },
            { text: "Related Resources", link: "/guide/related-resources" },
            { text: "Logs", link: "/guide/logs" },
            { text: "Monitor", link: "/guide/monitoring" },
            { text: "Helm Management", link: "/guide/helm-management" },
            { text: "AI Assistant", link: "/guide/ai-assistant" },
            { text: "Web Terminal", link: "/guide/web-terminal" },
            { text: "Kite Cluster Agent", link: "/guide/kite-cluster-agent" },
            { text: "Resource History", link: "/guide/resource-history" },
            { text: "Custom Sidebar", link: "/guide/custom-sidebar" },
            { text: "Kube Proxy", link: "/guide/kube-proxy" },
          ],
        },
        {
          text: "FAQ",
          link: "/faq",
        },
      ],
      "/api/": [
        {
          text: "Authentication",
          link: "/api/authentication",
        },
        {
          text: "Resources",
          link: "/api/resources",
        },
        {
          text: "Cluster Management",
          link: "/api/cluster-management",
        },
        {
          text: "RBAC Management",
          link: "/api/rbac-management",
        },
        {
          text: "User Management",
          link: "/api/user-management",
        },
      ],
      "/zh/": [
        {
          text: "介绍",
          items: [
            { text: "什么是 Kite?", link: "/zh/guide/" },
            { text: "开始", link: "/zh/guide/installation" },
          ],
        },
        {
          text: "配置",
          items: [
            { text: "用户管理", link: "/zh/config/user-management" },
            { text: "OAuth 设置", link: "/zh/config/oauth-setup" },
            { text: "RBAC 配置", link: "/zh/config/rbac-config" },
            { text: "Prometheus 设置", link: "/zh/config/prometheus-setup" },
            { text: "托管 K8s 认证", link: "/zh/config/managed-k8s-auth" },
            { text: "环境变量", link: "/zh/config/env" },
            { text: "配置文件", link: "/zh/config/config-file" },
            { text: "Chart Values", link: "/zh/config/chart-values" },
          ],
        },
        {
          text: "使用指南",
          items: [
            { text: "全局搜索", link: "/zh/guide/global-search" },
            { text: "相关资源", link: "/zh/guide/related-resources" },
            { text: "日志", link: "/zh/guide/logs" },
            { text: "监控", link: "/zh/guide/monitoring" },
            { text: "Helm 管理", link: "/zh/guide/helm-management" },
            { text: "AI 助手", link: "/zh/guide/ai-assistant" },
            { text: "Web 终端", link: "/zh/guide/web-terminal" },
            {
              text: "Kite Cluster Agent",
              link: "/zh/guide/kite-cluster-agent",
            },
            { text: "资源历史", link: "/zh/guide/resource-history" },
            { text: "自定义侧边栏", link: "/zh/guide/custom-sidebar" },
            { text: "Kube Proxy", link: "/zh/guide/kube-proxy" },
          ],
        },
        {
          text: "常见问题",
          link: "/zh/faq",
        },
      ],
      "/zh/api/": [
        {
          text: "认证",
          link: "/zh/api/authentication",
        },
        {
          text: "资源操作",
          link: "/zh/api/resources",
        },
        {
          text: "集群管理",
          link: "/zh/api/cluster-management",
        },
        {
          text: "RBAC 管理",
          link: "/zh/api/rbac-management",
        },
        {
          text: "用户管理",
          link: "/zh/api/user-management",
        },
      ],
      "/plugins/": [
        {
          text: "Plugins",
          items: [
            { text: "Introduction to Plugins", link: "/plugins/" },
            { text: "Quick Start", link: "/plugins/quick-start" },
            { text: "API Reference", link: "/plugins/api" },
            { text: "Internationalization", link: "/plugins/i18n" },
            { text: "Debugging", link: "/plugins/debugging" },
            { text: "Publishing Plugins", link: "/plugins/publishing" },
          ],
        },
      ],
      "/zh/plugins/": [
        {
          text: "开始使用",
          items: [
            { text: "插件简介", link: "/zh/plugins/" },
            { text: "快速开始", link: "/zh/plugins/quick-start" },
          ],
        },
        {
          text: "API 参考",
          items: [
            { text: "入口点", link: "/zh/plugins/api/" },
            { text: "插件配置", link: "/zh/plugins/api/plugin-config" },
            { text: "资源扩展", link: "/zh/plugins/api/resource-extensions" },
            { text: "导航", link: "/zh/plugins/api/navigation" },
            { text: "资源", link: "/zh/plugins/api/resources" },
            { text: "UI 组件", link: "/zh/plugins/api/ui" },
            { text: "Hooks", link: "/zh/plugins/api/hooks" },
            { text: "可观测性", link: "/zh/plugins/api/observability" },
            { text: "API 客户端", link: "/zh/plugins/api/api-client" },
            { text: "构建与校验", link: "/zh/plugins/api/build" },
          ],
        },
        {
          text: "指南",
          items: [
            { text: "国际化", link: "/zh/plugins/i18n" },
            { text: "调试", link: "/zh/plugins/debugging" },
            { text: "发布插件", link: "/zh/plugins/publishing" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/kite-org/kite" }],

    footer: {
      message: "Released under the Apache License.",
      copyright: "Copyright © 2025-present Kite Contributors",
    },
  },
});
