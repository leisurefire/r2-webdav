<script setup lang="ts">
import { useData } from 'vitepress'

const { theme } = useData()
</script>

<template>
  <div class="not-found">
    <a class="not-found-brand" :href="(theme.mainHome || theme.siteBase || '/')">
      <svg class="brand-mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 1c.9 3.2 2 4.6 3.3 5.9C16.6 8.2 18 9.3 21.2 10.2c.4.1.4.7 0 .8-3.2.9-4.6 2-5.9 3.3C14 15.6 12.9 17 12 20.2c-.1.4-.7.4-.8 0-.9-3.2-2-4.6-3.3-5.9C6.6 13 5.2 11.9 2 11c-.4-.1-.4-.7 0-.8C5.2 9.3 6.6 8.2 7.9 6.9 9.2 5.6 10.3 4.2 11.2 1c.1-.4.7-.4.8 0Z"/>
        <circle cx="19" cy="18.5" r="2.2"/>
        <circle cx="5" cy="18.5" r="2.2"/>
      </svg>
      <span>Archive at Home</span>
    </a>
    <h1>页面不存在</h1>
    <p>Archive at Home 能解析很多归档，但找不到这个页面。</p>
    <a class="nf-btn" :href="(theme.mainHome || theme.siteBase || '/')">回到首页</a>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100svh;
  padding: 40px 24px;
  text-align: center;
  background: var(--surface);
}

.not-found-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 48px;
  color: var(--on-surface);
  font-family: var(--font-serif);
  font-size: 1.25rem;
  font-weight: 600;
  text-decoration: none;
}

.not-found-brand:hover {
  color: var(--brand-strong);
  text-decoration: none;
}

.brand-mark {
  width: 30px;
  height: 30px;
  color: var(--brand);
}

h1 {
  margin: 0 0 14px;
  font-family: var(--font-serif);
  font-size: 1.65rem;
  font-weight: 600;
  color: var(--on-surface);
}

p {
  margin: 0 0 32px;
  max-width: 32em;
  color: var(--on-surface-variant);
  font-size: 0.98rem;
}

.nf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 22px;
  border-radius: var(--radius-m);
  background: var(--on-surface);
  color: var(--surface);
  font-size: 0.94rem;
  font-weight: 600;
  text-decoration: none;
}
.nf-btn:hover {
  background: #000000;
  color: #ffffff;
  text-decoration: none;
}
</style>
