<script setup lang="ts">
/**
 * 文档侧栏 / 顶部目录：
 * - 「当前页面」收集 .vp-doc 渲染出的 h2 锚点（含 API 参考页动态渲染的标题，
 *   通过 MutationObserver 在异步渲染完成后重新收集）
 * - 「文档跳转」来自 config 中的 nav + sidebar
 */
import { onContentUpdated, useRoute, withBase } from 'vitepress'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

type NavLink = {
  text: string
  link: string
}

const { frontmatter, theme } = useData()
const route = useRoute()

const open = ref(false)
const query = ref('')
const pageLinks = ref<NavLink[]>([])
const root = ref<HTMLElement>()
let observer: MutationObserver | undefined

const isHome = computed(() => frontmatter.value.layout === 'home')

const siteLinks = computed(() => {
  const links: NavLink[] = [
    { text: '首页', link: '/' },
    { text: '返回主站', link: '__main__' },
  ]
  const seen = new Set<string>(['/', '__main__'])

  function add(text: unknown, link: unknown) {
    if (typeof text !== 'string' || typeof link !== 'string' || seen.has(link)) return
    if (link.startsWith('http')) return // 外部链接不进目录
    seen.add(link)
    links.push({ text, link })
  }

  function walk(items: any[]) {
    for (const item of items) {
      add(item.text, item.link)
      if (Array.isArray(item.items)) walk(item.items)
    }
  }

  if (Array.isArray(theme.value.nav)) walk(theme.value.nav)
  if (Array.isArray(theme.value.sidebar)) walk(theme.value.sidebar)

  return links
})

const filteredPageLinks = computed(() => filterLinks(pageLinks.value))
const filteredSiteLinks = computed(() => filterLinks(siteLinks.value))
const hasPageLinks = computed(() => filteredPageLinks.value.length > 0)

function filterLinks(links: NavLink[]) {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return links

  return links.filter((item) => item.text.toLowerCase().includes(keyword))
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function collectPageLinks() {
  if (typeof document === 'undefined') return

  const links: NavLink[] = []
  const seen = new Set<string>()

  document.querySelectorAll<HTMLElement>('.vp-doc h2[id]').forEach((heading) => {
    const text = normalizeText(heading.textContent || '')
    const link = `#${heading.id}`
    if (!text || text.length > 80 || seen.has(link)) return
    seen.add(link)
    links.push({ text, link })
  })

  pageLinks.value = links
}

function activatePageLink(item: NavLink) {
  close()

  const targetId = decodeURIComponent(item.link.slice(1))
  const target = document.getElementById(targetId)
  if (target) {
    const navHeight =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vp-nav-height')) || 0
    const localNavHeight = window.innerWidth < 960 ? root.value?.getBoundingClientRect().height || 0 : 0
    const offset = (window.innerWidth >= 960 ? navHeight : localNavHeight) + 16
    const top = target.getBoundingClientRect().top + window.scrollY - offset
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'auto' })
    history.replaceState(null, '', item.link)
  } else {
    window.location.hash = item.link
  }
}

function siteHref(link: string) {
  if (link === '__main__') {
    const mainHome = (theme.value as { mainHome?: string; siteBase?: string }).mainHome
      || (theme.value as { siteBase?: string }).siteBase
    if (typeof mainHome === 'string' && mainHome.length > 0) {
      return mainHome.endsWith('/') ? mainHome : `${mainHome}/`
    }
    // BASE_URL = /docs/ 或 /archive-at-home-site/docs/ → 主站根
    const base = import.meta.env.BASE_URL || '/docs/'
    const stripped = base.replace(/\/docs\/?$/, '/')
    return stripped || '/'
  }
  if (link.startsWith('http')) return link
  return withBase(link)
}

function scrollToTop() {
  close()
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
}

function toggle() {
  open.value = !open.value
  if (open.value) void nextTick(collectPageLinks)
}

function close() {
  open.value = false
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

function closeOnClickOutside(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}

onMounted(() => {
  collectPageLinks()
  document.addEventListener('keydown', closeOnEscape)
  document.addEventListener('click', closeOnClickOutside)

  // API 参考页等异步渲染的内容出现后，重新收集标题
  const content = document.querySelector('#VPContent')
  if (content) {
    observer = new MutationObserver(collectPageLinks)
    observer.observe(content, { childList: true, subtree: true })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', closeOnEscape)
  document.removeEventListener('click', closeOnClickOutside)
  observer?.disconnect()
})

onContentUpdated(collectPageLinks)

watch(
  () => route.path,
  () => {
    close()
    query.value = ''
    void nextTick(collectPageLinks)
  },
)
</script>

<template>
  <div v-if="!isHome" ref="root" class="UnifiedLocalNav">
    <div class="container">
      <button type="button" class="trigger" :aria-expanded="open" @click="toggle">
        <span class="vpi-align-left icon" />
        <span>目录 / 搜索</span>
      </button>
    </div>

    <div class="panel" :class="{ open }">
      <label class="search-box">
        <span class="vpi-search" />
        <input v-model="query" type="search" placeholder="搜索当前页面或文档" />
      </label>

      <div class="groups">
        <section v-if="hasPageLinks" class="group">
          <div class="group-header">
            <p class="group-title">当前页面</p>
          </div>
          <a v-for="item in filteredPageLinks" :key="item.link" :href="item.link" @click.prevent="activatePageLink(item)">
            {{ item.text }}
          </a>
        </section>

        <section v-if="filteredSiteLinks.length" class="group">
          <p class="group-title">文档跳转</p>
          <a
            v-for="item in filteredSiteLinks"
            :key="item.link"
            :href="siteHref(item.link)"
            :target="item.link === '__main__' ? '_self' : undefined"
            @click="close"
          >
            {{ item.text }}
          </a>
        </section>
      </div>
    </div>

  </div>

  <Teleport to="body">
    <button v-if="!isHome" type="button" class="floating-top-button" aria-label="返回顶部" @click="scrollToTop">
      <span class="vpi-arrow-up" />
      <span>顶部</span>
    </button>
  </Teleport>
</template>

<style scoped>
.UnifiedLocalNav {
  position: sticky;
  top: 0;
  left: 0;
  z-index: var(--vp-z-index-local-nav);
  width: 100vw;
  margin: 0 calc(50% - 50vw) 24px;
  border-bottom: 1px solid var(--outline-variant);
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  backdrop-filter: saturate(140%) blur(16px);
  -webkit-backdrop-filter: saturate(140%) blur(16px);
}

:global(.VPDoc) > .UnifiedLocalNav { margin-top: 0; }

.container {
  display: flex;
  justify-content: stretch;
  align-items: center;
  height: 48px;
  min-height: 48px;
}

.trigger {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  flex: 1;
  gap: 8px;
  height: 48px;
  min-height: 0;
  padding: 0 24px;
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.trigger:hover,
.trigger[aria-expanded="true"] {
  color: var(--on-surface);
}

.icon {
  font-size: 14px;
}

.panel {
  position: absolute;
  top: 56px;
  right: 16px;
  left: 16px;
  display: none;
  max-height: min(72vh, 560px);
  overflow: hidden;
  border: 1px solid var(--outline);
  border-radius: var(--radius-l);
  background: color-mix(in srgb, var(--surface-bright) 88%, transparent);
  box-shadow: var(--shadow-pop);
  backdrop-filter: saturate(140%) blur(18px);
  -webkit-backdrop-filter: saturate(140%) blur(18px);
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.panel.open {
  display: block;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--outline-variant);
  color: var(--on-surface-dim);
}

.search-box input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--on-surface);
  font-size: 14px;
}

.search-box input::placeholder {
  color: var(--on-surface-dim);
}

.groups {
  max-height: calc(min(72vh, 560px) - 49px);
  overflow: auto;
  padding: 8px;
  overscroll-behavior: contain;
}

.group + .group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--outline-variant);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px 6px 8px;
}

.group-title {
  margin: 0;
  color: var(--on-surface-dim);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.group a {
  display: block;
  overflow: hidden;
  padding: 9px 10px;
  border-radius: var(--radius-m);
  color: var(--on-surface-variant);
  font-size: 14px;
  line-height: 1.35;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group a:hover {
  background: var(--brand-soft);
  color: var(--on-brand-container);
  text-decoration: none;
}

.floating-top-button {
  position: fixed;
  right: 18px;
  bottom: max(10px, env(safe-area-inset-bottom));
  z-index: calc(var(--vp-z-index-local-nav) + 1);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--outline);
  border-radius: var(--radius-m);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--shadow-card);
}

.floating-top-button:hover {
  border-color: color-mix(in srgb, var(--brand) 45%, var(--outline));
  color: var(--on-brand-container);
}

@media (min-width: 768px) {
  :global(.VPDoc) > .UnifiedLocalNav { margin-top: 0; }

  .trigger {
    padding: 0 32px;
  }
}

@media (min-width: 960px) {
  .UnifiedLocalNav {
    position: fixed;
    top: var(--vp-nav-height);
    bottom: 0;
    width: 288px;
    margin: 0;
    border-right: 1px solid var(--outline-variant);
    border-bottom: 0;
    background: color-mix(in srgb, var(--surface) 84%, transparent);
    backdrop-filter: saturate(140%) blur(16px);
    -webkit-backdrop-filter: saturate(140%) blur(16px);
  }

  .container {
    display: none;
  }

  .panel {
    position: static;
    display: block;
    width: auto;
    max-height: none;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .groups {
    max-height: calc(100vh - var(--vp-nav-height) - 49px);
  }

  .floating-top-button {
    right: 24px;
    bottom: 24px;
  }
}

@media (min-width: 1280px) {
  .UnifiedLocalNav {
    display: block;
  }
}
</style>





