/**
 * 组装可部署的静态站点：
 * 把 VitePress 构建产物复制到 apps/site/docs/，
 * 使 apps/site 成为一个完整的静态部署根目录。
 * 文档内 404 统一替换为主站 404.html，全站共用同一页面。
 * 为 GitHub Pages 生成 clean URL 目录（foo.html -> foo/index.html）。
 * 修正 VitePress alpha 的 preload stylesheet，确保 CSS 一定被应用。
 *
 * SITE_BASE 控制路径前缀：
 *   空 / 未设置 → 根路径部署（npm run build）
 *   /r2-webdav → Project Pages（npm run build:gh）
 *
 * 主站 index.html 不改写：site-shell.js 通过 import.meta.url 自动推断 base。
 * VitePress 文档 base 在构建期由 SITE_BASE 决定。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMainHome, getSiteBase } from './site-base.mjs'

const siteRoot = fileURLToPath(new URL('../apps/site', import.meta.url))
const docsDist = fileURLToPath(new URL('../apps/docs/.vitepress/dist', import.meta.url))
const target = join(siteRoot, 'docs')
const site404 = join(siteRoot, '404.html')
const site404Template = join(siteRoot, '404.template.html')
const docs404 = join(target, '404.html')
const siteBase = getSiteBase()

function renderNotFound(html) {
  return html
    .replaceAll('__SITE_HOME__', getMainHome())
    .replaceAll('__SITE_ASSETS__', `${siteBase}/assets`)
}

function read404Template() {
  if (existsSync(site404Template)) {
    return readFileSync(site404Template, 'utf8')
  }
  // Backward compat: 404.html may still hold placeholders
  if (existsSync(site404)) {
    const raw = readFileSync(site404, 'utf8')
    if (raw.includes('__SITE_HOME__')) return raw
  }
  console.error('未找到 404 模板（apps/site/404.template.html）')
  process.exit(1)
}

if (!existsSync(docsDist)) {
  console.error('未找到 docs 构建产物，请先运行 npm run docs:build')
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(docsDist, target, { recursive: true })

// 从模板生成 404（不永久改坏源模板）
{
  const html = renderNotFound(read404Template())
  writeFileSync(site404, html)
  writeFileSync(docs404, html)
}

/**
 * VitePress 2 alpha 生成 rel="preload stylesheet" ... as="style"
 * 部分浏览器/预览环境只 preload 不应用样式。改为标准 stylesheet。
 */
/**
 * lightningcss 有时只保留 -webkit-backdrop-filter。
 * 补回标准属性，保证 Chromium / Firefox / Safari 都能毛玻璃。
 */
function ensureBackdropFilter(css) {
  // 仅在 -webkit- 后缺少标准属性时补全
  return css.replace(
    /-webkit-backdrop-filter:([^;{}]+);(?!backdrop-filter:)/g,
    '-webkit-backdrop-filter:$1;backdrop-filter:$1;',
  )
}

function fixStylesheetLinks(html) {
  return html.replace(
    /<link\s+rel="preload stylesheet"\s+href="([^"]+)"\s+as="style"\s*\/?>/g,
    '<link rel="stylesheet" href="$1">',
  )
}

/**
 * GitHub Pages 不会把 /docs/deploy 映射到 deploy.html。
 * 将除 index/404 外的 *.html 复制为 name/index.html。
 */
function promoteCleanUrlDirs(dir) {
  const entries = readdirSync(dir)
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      promoteCleanUrlDirs(full)
      continue
    }
    if (extname(name) !== '.html') continue
    if (name === 'index.html' || name === '404.html') continue

    const page = basename(name, '.html')
    const destDir = join(dir, page)
    mkdirSync(destDir, { recursive: true })
    let html = readFileSync(full, 'utf8')
    html = fixStylesheetLinks(html)
    writeFileSync(join(destDir, 'index.html'), html)
    // 同步修正原 html，避免 /docs/deploy.html 也无样式
    writeFileSync(full, html)
  }
}

// 先修正根下所有 html 的 stylesheet
function fixAllHtml(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      fixAllHtml(full)
      continue
    }
    if (extname(name) !== '.html') continue
    if (name === '404.html') continue
    let html = readFileSync(full, 'utf8')
    const next = fixStylesheetLinks(html)
    if (next !== html) writeFileSync(full, next)
  }
}

fixAllHtml(target)
promoteCleanUrlDirs(target)

// 修正 docs 构建 CSS 中可能丢失的 unprefixed backdrop-filter
{
  const assetsDir = join(target, 'assets')
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (!name.endsWith('.css')) continue
      const full = join(assetsDir, name)
      const raw = readFileSync(full, 'utf8')
      const next = ensureBackdropFilter(raw)
      if (next !== raw) {
        writeFileSync(full, next)
        console.log('已补全 backdrop-filter: ' + name)
      }
    }
  }
}

writeFileSync(join(siteRoot, '.nojekyll'), '')

console.log('已组装: ' + target)
console.log(`SITE_BASE=${siteBase || '(root)'}  mainHome=${getMainHome()}`)
console.log('已统一 404: ' + docs404)
console.log('已修正 stylesheet 引用 / 生成 clean URL 目录')
console.log('已写入 apps/site/.nojekyll')
