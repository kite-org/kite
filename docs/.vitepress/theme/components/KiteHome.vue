<script setup>
import {
  IconArrowUpRight,
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
import auditScreenshot from "../../../screenshots/audit.webp";
import detailScreenshot from "../../../screenshots/detail.webp";
import helmScreenshot from "../../../screenshots/helm.webp";
import GitHubStarCount from "./GitHubStarCount.vue";

const strengths = [
  { icon: IconCode, label: "Single binary" },
  { icon: IconWorld, label: "Multi-cluster" },
  { icon: IconSparkles, label: "AI-native" },
  { icon: IconPackage, label: "Helm" },
  { icon: IconHistory, label: "Audit logs" },
  { icon: IconShieldCheck, label: "RBAC" },
  { icon: IconGitBranch, label: "GitOps friendly" },
];

const features = [
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
];

const productDetails = [
  {
    id: "resource-details",
    eyebrow: "Resource details",
    title: "The full story behind every resource.",
    description:
      "Inspect status, configuration, events, conditions, and related workloads in one place. Move from a symptom to the context you need without jumping between tools.",
    placeholder: "Resource details",
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
    placeholder: "Helm management",
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
    placeholder: "Security audit",
    image: auditScreenshot,
    imageAlt:
      "Kite audit log showing operators, Kubernetes resource changes, clusters, status, and reviewable diffs",
    imageWidth: 3118,
    imageHeight: 2250,
    mediaLeft: true,
  },
];
</script>

<template>
  <div id="top" class="kite-home">
    <header class="site-header">
      <div class="site-shell site-header__inner">
        <a class="brand" href="/" aria-label="Kite home">
          <img src="/logo.svg" alt="" width="35" height="35" />
          <span>Kite</span>
        </a>

        <nav class="site-nav" aria-label="Primary navigation">
          <a href="/guide/">Docs</a>
          <a
            class="nav__optional"
            href="https://kite-demo.zzde.me"
            target="_blank"
            rel="noreferrer"
          >
            Demo
          </a>
          <a
            class="nav__optional"
            href="https://join.slack.com/t/kite-dashboard/shared_invite/zt-3cl9mccs7-eQZ1_t6IoTPHZkxXED1ceg"
            target="_blank"
            rel="noreferrer"
          >
            Slack
          </a>
          <a
            href="https://github.com/kite-org/kite"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <GitHubStarCount />
        </nav>
      </div>
    </header>

    <main>
      <section class="site-shell hero" aria-labelledby="hero-heading">
        <div class="hero__copy">
          <h1 id="hero-heading">
            All your clusters.
            <span>One workspace.</span>
          </h1>
          <p>
            Kite is the lightweight, open-source Kubernetes workspace for
            clusters, observability, access control, and AI operations.
          </p>
          <div class="hero__actions">
            <a class="button button--primary" href="/guide/">Read the docs</a>
            <a
              class="button button--secondary"
              href="https://github.com/kite-org/kite"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
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

      <section class="site-shell strengths" aria-label="Kite strengths">
        <div v-for="item in strengths" :key="item.label" class="strength">
          <component
            :is="item.icon"
            aria-hidden="true"
            :size="21"
            :stroke-width="1.5"
          />
          <span>{{ item.label }}</span>
        </div>
      </section>

      <section class="site-shell platform" aria-labelledby="platform-heading">
        <div class="platform__intro">
          <h2 id="platform-heading">
            The control plane for platform teams—observe, operate, and govern
            any Kubernetes environment from a single workspace.
          </h2>
          <p>
            Kite brings clusters, workloads, access, and AI together in one
            fast, extensible interface. Ship with confidence and sleep better at
            night.
          </p>
        </div>

        <div class="feature-grid">
          <article
            v-for="feature in features"
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
          <span class="eyebrow">Built for Kubernetes</span>
          <h2 id="proof-heading">
            One workspace.
            <span>All your clusters.</span>
          </h2>
          <p>
            From cluster health to workloads and events, Kite gives you the
            real-time context to move fast and stay safe.
          </p>
          <a
            class="arrow-link"
            href="https://kite-demo.zzde.me"
            target="_blank"
            rel="noreferrer"
          >
            See it in action
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
            alt="Kite dashboard showing Kubernetes cluster resources and live health signals"
            width="3172"
            height="2334"
          />
        </div>
      </section>

      <section
        v-for="detail in productDetails"
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
            v-if="detail.image"
            :src="detail.image"
            :alt="detail.imageAlt"
            :width="detail.imageWidth"
            :height="detail.imageHeight"
          />
          <div
            v-else
            class="product-placeholder"
            role="img"
            :aria-label="`${detail.placeholder} screenshot placeholder`"
          >
            <div>
              <span>Screenshot placeholder</span>
              <strong>{{ detail.placeholder }}</strong>
            </div>
          </div>
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
