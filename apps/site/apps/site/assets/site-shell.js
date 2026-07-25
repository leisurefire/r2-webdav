const GITHUB_REPO = 'https://github.com/leisurefire/r2-webdav'

const brandMark = `
  <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7.4 18.5h9.5a4.1 4.1 0 0 0 .6-8.16A5.8 5.8 0 0 0 6.36 8.9 4.8 4.8 0 0 0 7.4 18.5Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8.4 13.2h7.2M12 9.8v6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`

const githubIcon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.77.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.13v3.28c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>`
const appIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`
const menuIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`

function normalizeBase(value, fallback) {
  const base = value || fallback
  let next = String(base).trim().replace(/\\/g, '/')
  if (!next.startsWith('/')) next = `/${next}`
  if (next !== '/') next = next.replace(/\/+$/, '')
  return next === '/' ? '/' : `${next}/`
}

function detectSiteBase() {
  try {
    const path = new URL(import.meta.url).pathname
    let match = path.match(/^(.*)\/assets\/site-shell(?:\.[^/]+)?\.js$/i)
    if (match) return match[1]
    match = path.match(/^(.*)\/docs\/assets\/(?:chunks\/)?site-shell[^/]*\.js$/i)
    if (match) return match[1]
  } catch { /* use root */ }
  return ''
}

function resolveSiteBase(value) {
  return normalizeBase(value || detectSiteBase() || '/', '/')
}

function resolveDocsBase(value, siteBase) {
  return normalizeBase(value || `${siteBase}docs/`, '/docs/')
}

function syncDeviceTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    document.documentElement.classList.toggle('dark', media.matches)
    if (media.matches) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
  }
  apply()
  media.addEventListener('change', apply)
}

const HTMLElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {}

class SiteNavbar extends HTMLElementBase {
  connectedCallback() {
    if (typeof window === 'undefined') return
    const docsMode = this.hasAttribute('docs-mode')
    const siteBase = resolveSiteBase(this.getAttribute('site-base'))
    const docsBase = resolveDocsBase(this.getAttribute('docs-base'), siteBase)
    const appBase = siteBase.endsWith('/about/') ? siteBase.slice(0, -'about/'.length) : '/'
    const path = window.location.pathname.replace(/\/+$/, '/') || '/'
    const items = [
      ['产品', siteBase],
      ['Quick Start', `${docsBase}quick-start`],
      ['Deploy', `${docsBase}deploy`],
      ['客户端', `${docsBase}clients`],
      ['API', `${docsBase}api/server`],
    ]
    const links = items.map(([label, href], index) => {
      const active = index === 0 ? path === href : path === href || path === `${href}/` || path === `${href}.html`
      return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}>${label}</a>`
    }).join('')
    this.innerHTML = `
      <header class="site-header">
        <div class="site-header-inner">
          <a class="site-logo" href="${siteBase}">${brandMark}<span>R2 WebDAV X</span>${docsMode ? '<span class="site-logo-section">文档</span>' : ''}</a>
          <div class="site-header-end">
            <button class="nav-toggle" type="button" aria-label="打开导航" aria-expanded="false">${menuIcon}</button>
            <nav class="site-nav" aria-label="主导航">
              ${links}
              <div class="nav-social">
                <a class="nav-icon-link" href="${GITHUB_REPO}" title="GitHub" aria-label="GitHub" target="_blank" rel="noopener">${githubIcon}</a>
                <a class="nav-icon-link" href="${appBase}files" title="打开应用" aria-label="打开应用">${appIcon}</a>
              </div>
            </nav>
          </div>
        </div>
      </header>`
    const toggle = this.querySelector('.nav-toggle')
    const nav = this.querySelector('.site-nav')
    toggle?.addEventListener('click', () => {
      const open = nav.classList.toggle('open')
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航')
    })
  }
}

class SiteFooter extends HTMLElementBase {
  connectedCallback() {
    if (typeof window === 'undefined') return
    const siteBase = resolveSiteBase(this.getAttribute('site-base'))
    const docsBase = resolveDocsBase(this.getAttribute('docs-base'), siteBase)
    this.innerHTML = `
      <footer class="site-footer">
        <div class="container">
          <div class="footer-note">
            <p><strong>R2 WebDAV X</strong> · 把 Cloudflare R2 变成个人文件、日历与知识工作区。</p>
            <p>单用户、自托管；WebDAV/CalDAV 数据保存在 R2，笔记与会话保存在 D1。</p>
          </div>
          <nav class="footer-links" aria-label="页脚导航">
            <a href="${docsBase}quick-start">Quick Start</a>
            <a href="${docsBase}deploy">Deploy</a>
            <a href="${docsBase}clients">客户端连接</a>
            <a href="${GITHUB_REPO}" target="_blank" rel="noopener">GitHub</a>
          </nav>
        </div>
      </footer>`
  }
}

if (typeof window !== 'undefined') {
  syncDeviceTheme()
  if (!customElements.get('site-navbar')) customElements.define('site-navbar', SiteNavbar)
  if (!customElements.get('site-footer')) customElements.define('site-footer', SiteFooter)
}
