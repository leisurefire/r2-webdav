/** Build the product site at /about and stage it in the web app's public tree. */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

process.env.SITE_BASE = '/about'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'docs:build'])
run('node', ['scripts/assemble.mjs'])

const source = fileURLToPath(new URL('../apps/site', import.meta.url))
const target = fileURLToPath(new URL('../../web/public/about', import.meta.url))

if (!existsSync(source)) {
  console.error(`Site output is missing: ${source}`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
console.log(`[build-embed] Staged ${source} -> ${target}`)
