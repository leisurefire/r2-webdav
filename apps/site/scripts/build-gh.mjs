/**
 * GitHub Pages（项目站）构建入口。
 * 默认 SITE_BASE=/r2-webdav
 * 覆盖：SITE_BASE=/other-repo node scripts/build-gh.mjs
 *
 * 与 npm run build（根路径）分离，避免相对路径 / 前缀混用。
 */
import { spawnSync } from 'node:child_process'
import { getSiteBase, getDocsBase } from './site-base.mjs'

if (!process.env.SITE_BASE) {
  process.env.SITE_BASE = '/r2-webdav'
}

const siteBase = getSiteBase()
const docsBase = getDocsBase()
console.log(`[build-gh] SITE_BASE=${siteBase || '(root)'}  docs base=${docsBase}`)

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
console.log('[build-gh] 完成。部署目录：apps/site（Project Pages 子路径）')
