/**
 * 站点公共路径前缀。
 *
 * 本地开发 / 自定义域名根路径：
 *   SITE_BASE 未设置或为空 → docs base = /docs/
 *
 * GitHub Project Pages：
 *   SITE_BASE=/r2-webdav → docs base = /r2-webdav/docs/
 *
 * 使用：
 *   npm run build      → 根路径（SITE_BASE 强制清空）
 *   npm run build:gh   → Project Pages 前缀
 *   npm run docs:dev   → 本地 /docs/（不设 SITE_BASE）
 */
export function normalizeSiteBase(raw) {
  if (raw == null || raw === '' || raw === '/') return ''
  let s = String(raw).trim().replace(/\\/g, '/')
  if (!s.startsWith('/')) s = `/${s}`
  s = s.replace(/\/+$/, '')
  return s
}

export function getSiteBase() {
  return normalizeSiteBase(process.env.SITE_BASE)
}

/** 始终以 / 结尾，如 /docs/ 或 /r2-webdav/docs/ */
export function getDocsBase() {
  return `${getSiteBase()}/docs/`
}

/** 主站首页路径，如 / 或 /r2-webdav/ */
export function getMainHome() {
  const b = getSiteBase()
  return b ? `${b}/` : '/'
}
