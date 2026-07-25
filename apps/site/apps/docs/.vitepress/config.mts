import { defineConfig } from 'vitepress'
import { getDocsBase, getMainHome, getSiteBase } from '../../../scripts/site-base.mjs'

const siteBase = getSiteBase()
const docsBase = getDocsBase()
const mainHome = getMainHome()

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'R2 WebDAV X 文档',
  description: 'R2 WebDAV X 部署、客户端连接、开发与 API 文档',
  // 独立构建默认 /docs/；Web App 内嵌构建为 /about/docs/
  base: docsBase,
  cleanUrls: true,
  appearance: false,
  transformPageData(pageData) {
    pageData.frontmatter.navbar = false
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === 'site-navbar' || tag === 'site-footer',
      },
    },
  },
  // 保留 unprefixed backdrop-filter（避免 lightningcss 只剩 -webkit-）
  vite: {
    build: {
      cssTarget: ['chrome99', 'firefox88', 'safari15', 'edge99'],
    },
  },
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  head: [
    ['link', { rel: 'icon', href: `${siteBase || ''}/assets/images/logo.svg` }],
    [
      'script',
      {},
      "try{var d=matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);d?document.documentElement.setAttribute('data-theme','dark'):document.documentElement.removeAttribute('data-theme')}catch(e){}",
    ],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        href:
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap',
        rel: 'stylesheet',
      },
    ],
  ],
  themeConfig: {
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    // 供主题读取主站根路径（返回主站按钮）
    mainHome,
    siteBase,
    docsBase,

    nav: [
      { text: 'Quick Start', link: '/quick-start' },
      { text: 'Deploy', link: '/deploy' },
      { text: '客户端', link: '/clients' },
      { text: 'API', link: '/api/server' },
    ],

    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '项目概览', link: '/' },
          { text: 'Quick Start', link: '/quick-start' },
          { text: 'Deploy', link: '/deploy' },
          { text: '客户端连接', link: '/clients' },
        ],
      },
      {
        text: '开发参考',
        items: [
          { text: '本地开发', link: '/development' },
          { text: 'JSON API', link: '/api/server' },
        ],
      },
    ],
  },
})
