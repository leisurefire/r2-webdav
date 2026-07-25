<script setup lang="ts">
import { useData } from 'vitepress'

const { page, theme } = useData()

// 主站根路径：优先 mainHome（始终以 / 结尾），避免 siteBase 空字符串被误判
const siteBase = (theme.value.mainHome || theme.value.siteBase || '/') as string
const docsBase = (theme.value.docsBase || '/docs/') as string
</script>

<template>
  <site-navbar
    v-if="!page.isNotFound"
    :key="page.relativePath"
    docs-mode
    :site-base="siteBase"
    :docs-base="docsBase"
  />
</template>
