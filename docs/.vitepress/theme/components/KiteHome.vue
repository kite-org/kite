<script setup>
import {
  IconArrowUpRight,
  IconBrandApple,
  IconBrandWindows,
  IconChartLine,
  IconCode,
  IconGitBranch,
  IconHistory,
  IconPackage,
  IconShieldCheck,
  IconShieldLock,
  IconSparkles,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-vue";
import { useData } from "vitepress";
import { computed, onMounted, ref } from "vue";
import auditScreenshot from "../../../screenshots/audit.webp";
import detailScreenshot from "../../../screenshots/detail.webp";
import helmScreenshot from "../../../screenshots/helm.webp";
import GitHubStarCount from "./GitHubStarCount.vue";

const content = {
  en: {
    homeHref: "/",
    docsHref: "/guide/",
    pluginsHref: "/plugins/",
    installHref: "/guide/installation",
    desktopHref: "/guide/desktop",
    homeLabel: "Kite home",
    navigationLabel: "Primary navigation",
    skipLabel: "Skip to content",
    starLabel: "View Kite stars on GitHub",
    nav: {
      desktop: "Desktop",
      docs: "Docs",
      plugins: "Plugins",
      community: "Community",
      github: "GitHub",
    },
    hero: {
      firstLine: "All your clusters.",
      secondLine: "One workspace.",
      description:
        "Kite is the lightweight, open-source Kubernetes workspace for clusters, observability, access control, and AI operations.",
      secondaryAction: "Self-host Kite",
    },
    desktop: {
      eyebrow: "Kite Desktop · Beta",
      title: "Your clusters. Right on your desktop.",
      description:
        "Open your kubeconfig and get to work. Kite runs locally on your computer, using your existing cluster credentials. No server deployment or Kite account required.",
      features: [
        "Keep clusters and credentials in sync with your kubeconfig files.",
        "Open logs, terminals, and AI chat in their own windows.",
        "Forward local ports and manage connections from the menu bar or system tray.",
      ],
      mac: "Apple Silicon · macOS 13+ · DMG",
      windows: "x64 · Installer or portable ZIP",
      download: "Download Desktop",
      downloadMac: "Download for Mac",
      downloadWindows: "Download for Windows",
      otherPlatforms: "Other platforms",
      guide: "Setup & desktop guide",
    },
    strengths: [
      { icon: IconCode, label: "Single binary" },
      { icon: IconWorld, label: "Multi-cluster" },
      { icon: IconSparkles, label: "AI-native" },
      { icon: IconPackage, label: "Helm" },
      { icon: IconHistory, label: "Audit logs" },
      { icon: IconShieldCheck, label: "RBAC" },
      { icon: IconGitBranch, label: "GitOps friendly" },
    ],
    strengthsLabel: "Kite strengths",
    platform: {
      title:
        "The control plane for platform teams—observe, operate, and govern any Kubernetes environment from a single workspace.",
      description:
        "Kite brings clusters, workloads, access, and AI together in one fast, extensible interface. Ship with confidence and sleep better at night.",
    },
    features: [
      {
        icon: IconChartLine,
        title: "Observe",
        description:
          "Real-time visibility into clusters, workloads, and performance. Dashboards and events help you act, not just react.",
        link: "Explore observability",
        href: "/guide/monitoring",
      },
      {
        icon: IconTerminal2,
        title: "Operate",
        description:
          "Deploy, troubleshoot, and scale with confidence. Everything you need to run Kubernetes day to day, without context switching.",
        link: "Explore operations",
        href: "/guide/installation",
      },
      {
        icon: IconShieldLock,
        title: "Govern",
        description:
          "Access control, policies, and audit-ready workflows that keep your platform secure and your teams productive.",
        link: "Explore governance",
        href: "/config/rbac-config",
      },
    ],
    proof: {
      eyebrow: "Built for Kubernetes",
      titleFirstLine: "One workspace.",
      titleSecondLine: "All your clusters.",
      description:
        "From cluster health to workloads and events, Kite gives you the real-time context to move fast and stay safe.",
      link: "Explore the guide",
      imageAlt:
        "Kite dashboard showing Kubernetes cluster resources and live health signals",
    },
    productDetails: [
      {
        id: "resource-details",
        eyebrow: "Resource details",
        title: "The full story behind every resource.",
        description:
          "Inspect status, configuration, events, conditions, and related workloads in one place. Move from a symptom to the context you need without jumping between tools.",
        image: detailScreenshot,
        imageAlt:
          "Kite Kubernetes resource detail page showing workload status, pods, events, related resources, labels, and configuration",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: true,
      },
      {
        id: "helm-management",
        eyebrow: "Helm management",
        title: "Manage Helm without leaving the workspace.",
        description:
          "Browse charts, manage repositories, and install, upgrade, or review releases alongside the Kubernetes resources they create.",
        image: helmScreenshot,
        imageAlt:
          "Kite Helm release page showing deployment status, related resources, release history, and configuration",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: false,
      },
      {
        id: "security-audit",
        eyebrow: "Security & audit",
        title: "Every sensitive action, accounted for.",
        description:
          "Keep access governed with role-based permissions and a clear audit trail of user activity and resource changes across your clusters.",
        image: auditScreenshot,
        imageAlt:
          "Kite audit log showing operators, Kubernetes resource changes, clusters, status, and reviewable diffs",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: true,
      },
    ],
  },
  zh: {
    homeHref: "/zh/",
    docsHref: "/zh/guide/",
    pluginsHref: "/zh/plugins/",
    installHref: "/zh/guide/installation",
    desktopHref: "/zh/guide/desktop",
    homeLabel: "Kite 首页",
    navigationLabel: "主导航",
    skipLabel: "跳至主要内容",
    starLabel: "在 GitHub 上查看 Kite 星标数",
    nav: {
      desktop: "桌面版",
      docs: "文档",
      plugins: "插件",
      community: "社区",
      github: "GitHub",
    },
    hero: {
      firstLine: "所有集群。",
      secondLine: "一个工作空间。",
      description:
        "Kite 是轻量、开源的 Kubernetes 工作空间，将集群管理、可观测性、访问控制和 AI 运维整合在一起。",
      secondaryAction: "自行部署",
    },
    desktop: {
      eyebrow: "Kite Desktop · Beta",
      title: "在桌面上，连接你的集群。",
      description:
        "打开 kubeconfig，即可开始。Kite 在你的电脑上运行，使用已有的集群凭据，无需部署服务，也无需创建 Kite 账号。",
      features: [
        "跟随 kubeconfig 文件变化，自动同步集群与认证配置。",
        "在独立窗口中查看日志、使用终端和 AI 对话。",
        "将集群端口转发到本机，通过菜单栏或系统托盘管理连接。",
      ],
      mac: "Apple Silicon · macOS 13+ · DMG",
      windows: "x64 · 安装程序或便携 ZIP",
      download: "下载桌面版",
      downloadMac: "下载 Mac 版",
      downloadWindows: "下载 Windows 版",
      otherPlatforms: "其他平台",
      guide: "安装与桌面版指南",
    },
    strengths: [
      { icon: IconCode, label: "单一二进制" },
      { icon: IconWorld, label: "多集群" },
      { icon: IconSparkles, label: "AI 原生" },
      { icon: IconPackage, label: "Helm" },
      { icon: IconHistory, label: "审计日志" },
      { icon: IconShieldCheck, label: "RBAC" },
      { icon: IconGitBranch, label: "GitOps 友好" },
    ],
    strengthsLabel: "Kite 核心能力",
    platform: {
      title:
        "面向平台团队的控制面——在一个工作空间中观察、运维并治理任意 Kubernetes 环境。",
      description:
        "Kite 将集群、工作负载、权限和 AI 汇聚到快速、可扩展的界面中，让交付更可靠，让日常运维更从容。",
    },
    features: [
      {
        icon: IconChartLine,
        title: "观察",
        description:
          "实时了解集群、工作负载和性能。通过仪表盘、指标与事件快速定位真正需要处理的问题。",
        link: "了解可观测性",
        href: "/zh/guide/monitoring",
      },
      {
        icon: IconTerminal2,
        title: "运维",
        description:
          "在一个界面中完成部署、排障与扩缩容，覆盖 Kubernetes 日常运维所需的核心工作流。",
        link: "了解运维能力",
        href: "/zh/guide/installation",
      },
      {
        icon: IconShieldLock,
        title: "治理",
        description:
          "通过访问控制、权限策略和完整审计记录保障平台安全，同时保持团队协作效率。",
        link: "了解权限治理",
        href: "/zh/config/rbac-config",
      },
    ],
    proof: {
      eyebrow: "为 Kubernetes 而生",
      titleFirstLine: "一个工作空间。",
      titleSecondLine: "管理所有集群。",
      description:
        "从集群健康状态到工作负载与事件，Kite 提供实时上下文，帮助团队快速且安全地采取行动。",
      link: "浏览使用指南",
      imageAlt: "Kite 仪表盘展示 Kubernetes 集群资源和实时健康状态",
    },
    productDetails: [
      {
        id: "resource-details",
        eyebrow: "资源详情",
        title: "看清每一个资源的完整上下文。",
        description:
          "在同一处查看状态、配置、事件、条件和相关工作负载，从异常现象直接抵达排障所需的信息。",
        image: detailScreenshot,
        imageAlt:
          "Kite Kubernetes 资源详情页展示状态、Pod、事件、关联资源、标签和配置",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: true,
      },
      {
        id: "helm-management",
        eyebrow: "Helm 管理",
        title: "无需离开工作空间即可管理 Helm。",
        description:
          "浏览 Chart、管理仓库，并在其创建的 Kubernetes 资源旁完成 Release 的安装、升级与检查。",
        image: helmScreenshot,
        imageAlt:
          "Kite Helm Release 页面展示部署状态、关联资源、发布历史和配置",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: false,
      },
      {
        id: "security-audit",
        eyebrow: "安全与审计",
        title: "每一次敏感操作都有据可查。",
        description:
          "通过基于角色的权限和清晰的审计记录，管理用户访问与跨集群资源变更。",
        image: auditScreenshot,
        imageAlt:
          "Kite 审计日志展示操作用户、Kubernetes 资源变更、集群、状态和差异",
        imageWidth: 3118,
        imageHeight: 2250,
        mediaLeft: true,
      },
    ],
  },
};

const { lang } = useData();
const copy = computed(() =>
  lang.value.startsWith("zh") ? content.zh : content.en,
);
const platform = ref("");
const desktopDownloads = {
  mac: "https://github.com/kite-org/kite/releases/latest/download/kite-darwin-arm64.dmg",
  windows:
    "https://github.com/kite-org/kite/releases/latest/download/kite-windows-amd64.exe",
};
const download = computed(() => {
  if (platform.value === "mac") {
    return {
      label: copy.value.desktop.downloadMac,
      icon: IconBrandApple,
      href: desktopDownloads.mac,
    };
  }
  if (platform.value === "windows") {
    return {
      label: copy.value.desktop.downloadWindows,
      icon: IconBrandWindows,
      href: desktopDownloads.windows,
    };
  }
  return {
    label: copy.value.desktop.download,
    icon: null,
    href: "#desktop",
  };
});

onMounted(() => {
  if (/Windows NT/.test(navigator.userAgent)) {
    platform.value = "windows";
  } else if (
    /Macintosh/.test(navigator.userAgent) &&
    navigator.maxTouchPoints <= 1
  ) {
    platform.value = "mac";
  }
});
</script>

<template>
  <div id="top" class="kite-home">
    <a class="skip-link" href="#main-content">{{ copy.skipLabel }}</a>

    <header class="site-header">
      <div class="site-shell site-header__inner">
        <a class="brand" :href="copy.homeHref" :aria-label="copy.homeLabel">
          <img src="/logo.svg" alt="" width="35" height="35" />
          <span>Kite</span>
        </a>

        <nav class="site-nav" :aria-label="copy.navigationLabel">
          <a href="#desktop">{{ copy.nav.desktop }}</a>
          <a :href="copy.docsHref">{{ copy.nav.docs }}</a>
          <a :href="copy.pluginsHref">{{ copy.nav.plugins }}</a>
          <a
            class="nav__optional"
            href="https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg"
            target="_blank"
            rel="noreferrer"
          >
            {{ copy.nav.community }}
          </a>
          <a
            class="nav__optional"
            href="https://github.com/kite-org/kite"
            target="_blank"
            rel="noreferrer"
          >
            {{ copy.nav.github }}
          </a>
          <GitHubStarCount :aria-label="copy.starLabel" />
        </nav>
      </div>
    </header>

    <main id="main-content">
      <section class="site-shell hero" aria-labelledby="hero-heading">
        <div class="hero__copy">
          <h1 id="hero-heading">
            {{ copy.hero.firstLine }}
            <span>{{ copy.hero.secondLine }}</span>
          </h1>
          <p>{{ copy.hero.description }}</p>
          <div class="hero__actions">
            <a class="button button--primary" :href="download.href">
              <component
                :is="download.icon"
                v-if="download.icon"
                aria-hidden="true"
                :size="22"
                :stroke-width="1.5"
              />
              {{ download.label }}
            </a>
            <a class="button button--secondary" :href="copy.installHref">
              {{ copy.hero.secondaryAction }}
            </a>
          </div>
          <div class="hero__download-details">
            <a href="#desktop">{{ copy.desktop.otherPlatforms }}</a>
          </div>
        </div>

        <div class="hero__visual" aria-hidden="true">
          <img
            src="/assets/cluster-atlas-transparent.png"
            alt=""
            width="1254"
            height="1254"
            draggable="false"
          />
        </div>
      </section>

      <section class="site-shell strengths" :aria-label="copy.strengthsLabel">
        <div v-for="item in copy.strengths" :key="item.label" class="strength">
          <component
            :is="item.icon"
            aria-hidden="true"
            :size="21"
            :stroke-width="1.5"
          />
          <span>{{ item.label }}</span>
        </div>
      </section>

      <section
        id="desktop"
        class="site-shell desktop"
        aria-labelledby="desktop-heading"
      >
        <div class="desktop__copy">
          <span class="eyebrow">{{ copy.desktop.eyebrow }}</span>
          <h2 id="desktop-heading">{{ copy.desktop.title }}</h2>
          <p>{{ copy.desktop.description }}</p>
          <ul>
            <li v-for="feature in copy.desktop.features" :key="feature">
              {{ feature }}
            </li>
          </ul>
          <a class="arrow-link" :href="copy.desktopHref">
            {{ copy.desktop.guide }}
            <IconArrowUpRight
              aria-hidden="true"
              :size="16"
              :stroke-width="1.6"
            />
          </a>
        </div>
        <div class="desktop__downloads">
          <div class="desktop__platform">
            <IconBrandApple aria-hidden="true" :size="30" :stroke-width="1.5" />
            <div>
              <h3>macOS</h3>
              <p>{{ copy.desktop.mac }}</p>
              <a
                class="arrow-link desktop__download-link"
                :href="desktopDownloads.mac"
              >
                {{ copy.desktop.downloadMac }}
                <IconArrowUpRight
                  aria-hidden="true"
                  :size="16"
                  :stroke-width="1.6"
                />
              </a>
            </div>
          </div>
          <div class="desktop__platform">
            <IconBrandWindows
              aria-hidden="true"
              :size="30"
              :stroke-width="1.5"
            />
            <div>
              <h3>Windows</h3>
              <p>{{ copy.desktop.windows }}</p>
              <a
                class="arrow-link desktop__download-link"
                :href="desktopDownloads.windows"
              >
                {{ copy.desktop.downloadWindows }}
                <IconArrowUpRight
                  aria-hidden="true"
                  :size="16"
                  :stroke-width="1.6"
                />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section class="site-shell platform" aria-labelledby="platform-heading">
        <div class="platform__intro">
          <h2 id="platform-heading">{{ copy.platform.title }}</h2>
          <p>{{ copy.platform.description }}</p>
        </div>

        <div class="feature-grid">
          <article
            v-for="feature in copy.features"
            :key="feature.title"
            class="feature"
          >
            <component
              :is="feature.icon"
              class="feature__icon"
              aria-hidden="true"
              :size="44"
              :stroke-width="1.3"
            />
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.description }}</p>
            <a class="arrow-link" :href="feature.href">
              {{ feature.link }}
              <IconArrowUpRight
                aria-hidden="true"
                :size="16"
                :stroke-width="1.6"
              />
            </a>
          </article>
        </div>
      </section>

      <section class="site-shell product-proof" aria-labelledby="proof-heading">
        <div class="product-proof__copy">
          <span class="eyebrow">{{ copy.proof.eyebrow }}</span>
          <h2 id="proof-heading">
            {{ copy.proof.titleFirstLine }}
            <span>{{ copy.proof.titleSecondLine }}</span>
          </h2>
          <p>{{ copy.proof.description }}</p>
          <a class="arrow-link" :href="copy.docsHref">
            {{ copy.proof.link }}
            <IconArrowUpRight
              aria-hidden="true"
              :size="16"
              :stroke-width="1.6"
            />
          </a>
        </div>

        <div class="product-media">
          <img
            src="/screenshots/overview2.webp"
            :alt="copy.proof.imageAlt"
            width="3172"
            height="2334"
          />
        </div>
      </section>

      <section
        v-for="detail in copy.productDetails"
        :key="detail.id"
        class="site-shell product-detail"
        :class="{ 'product-detail--media-left': detail.mediaLeft }"
        :aria-labelledby="`${detail.id}-heading`"
      >
        <div class="product-detail__copy">
          <span class="eyebrow">{{ detail.eyebrow }}</span>
          <h2 :id="`${detail.id}-heading`">{{ detail.title }}</h2>
          <p>{{ detail.description }}</p>
        </div>

        <div class="product-detail__media">
          <img
            :src="detail.image"
            :alt="detail.imageAlt"
            :width="detail.imageWidth"
            :height="detail.imageHeight"
          />
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="site-shell site-footer__inner">
        <div>
          <img src="/logo.svg" alt="" width="35" height="35" />
          <strong>Kite</strong>
        </div>
        <a
          class="arrow-link"
          href="https://github.com/kite-org/kite"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <IconArrowUpRight aria-hidden="true" :size="16" :stroke-width="1.6" />
        </a>
      </div>
    </footer>
  </div>
</template>

<style scoped src="./kite-home.css"></style>
