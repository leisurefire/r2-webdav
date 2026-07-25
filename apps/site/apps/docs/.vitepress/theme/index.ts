import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import ApiReference from './components/ApiReference.vue'
import NotFound from './components/NotFound.vue'
import SiteFooter from './components/SiteFooter.vue'
import SiteNavbar from './components/SiteNavbar.vue'
import UnifiedLocalNav from './components/UnifiedLocalNav.vue'
import './style.css'

// Custom elements (site-navbar / site-footer) only load in the browser.
// Top-level import would evaluate HTMLElement during VitePress SSR and break the build.
if (!import.meta.env.SSR) {
  void import('../../../site/assets/site-shell.js')
}

const theme: Theme = {
  ...DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => h(SiteNavbar),
      'doc-top': () => h(UnifiedLocalNav),
      'page-top': () => h(UnifiedLocalNav),
      'layout-bottom': () => h(SiteFooter),
      'not-found': () => h(NotFound),
    })
  },
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx)
    ctx.app.component('ApiReference', ApiReference)
  },
}

export default theme
