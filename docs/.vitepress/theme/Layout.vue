<script setup>
import { IconChevronRight } from "@tabler/icons-vue";
import { useData } from "vitepress";
import DefaultTheme, { useSidebar } from "vitepress/theme";
import { computed } from "vue";

const { page, theme } = useData();
const { sidebar } = useSidebar();
const home = computed(() => theme.value.nav[0]);
const section = computed(() => {
  const path = `/${page.value.relativePath.replace(/\.md$/, "")}`;
  return sidebar.value.find((group) =>
    group.items?.some((item) => item.link?.replace(/\/$/, "/index") === path),
  );
});
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-before>
      <div class="kite-breadcrumb">
        <a :href="home.link">{{ home.text }}</a>
        <IconChevronRight :size="14" aria-hidden="true" />
        <template v-if="section">
          <span>{{ section.text }}</span>
          <IconChevronRight :size="14" aria-hidden="true" />
        </template>
        <span aria-current="page">{{ page.title }}</span>
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
