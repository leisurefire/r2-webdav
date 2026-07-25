/**
 * 根路径部署构建（自定义域名 / 站点根 URL）。
 * SITE_BASE 强制为空 → VitePress base=/docs/，主站路由为 /、/docs/...
 *
 * 与 build:gh（Project Pages 子路径）分离，避免本地/根部署混入 /r2-webdav 前缀。
 */
import { spawnSync } from 'node:child_process'
import { getSiteBase, getDocsBase } from './site-base.mjs'

// 强制根路径，忽略外部环境里残留的 SITE_BASE
process.env.SITE_BASE = ''

const siteBase = getSiteBase()
const docsBase = getDocsBase()
console.log(`[build] SITE_BASE=${siteBase || '(root)'}  docs base=${docsBase}`)

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npm', ['run', 'docs:build'])
run('node', ['scripts/assemble.mjs'])
console.log('[build] 完成。部署目录：apps/site（根路径）')
