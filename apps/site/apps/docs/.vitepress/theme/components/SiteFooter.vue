<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { frontmatter, page, theme } = useData()
const isHome = computed(() => frontmatter.value.layout === 'home')
const siteBase = (theme.value.mainHome || theme.value.siteBase || '/') as string
const docsBase = (theme.value.docsBase || '/docs/') as string
</script>

<template>
  <site-footer
    v-if="!page.isNotFound"
    docs-mode
    :class="{ 'docs-page-footer': !isHome }"
    :site-base="siteBase"
    :docs-base="docsBase"
  />
</template>
