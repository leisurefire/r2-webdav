<script setup lang="ts">
/**
 * 轻量 OpenAPI 渲染器：
 * 运行时拉取 public/openapi/server.yaml，用 js-yaml 解析后按
 * Claude Platform 文档的风格渲染端点、参数、请求体与响应示例。
 * 不再依赖 Scalar 这类重型嵌入。
 */
import { computed, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import yaml from 'js-yaml'

type Json = Record<string, any>

const doc = ref<Json | null>(null)
const loadError = ref('')

onMounted(async () => {
  try {
    const res = await fetch(withBase('/openapi/server.yaml'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    doc.value = yaml.load(await res.text()) as Json
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})

/* ---------- $ref 解析 ---------- */

function resolveRef(ref: string): Json | null {
  const root = doc.value
  if (!root || !ref.startsWith('#/')) return null
  let node: any = root
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part]
    if (node == null) return null
  }
  return node as Json
}

function deref<T extends Json>(node: T | undefined): T | undefined {
  if (node && typeof node === 'object' && typeof node.$ref === 'string') {
    return (resolveRef(node.$ref) as T) ?? node
  }
  return node
}

function schemaName(node: Json | undefined): string {
  if (!node) return ''
  if (typeof node.$ref === 'string') return node.$ref.split('/').pop() ?? ''
  if (Array.isArray(node.oneOf)) return node.oneOf.map(schemaName).join(' | ')
  if (Array.isArray(node.allOf)) return node.allOf.map(schemaName).join(' & ')
  if (node.type === 'array') return `${schemaName(node.items)}[]`
  return node.type ?? 'object'
}

/* ---------- 从 schema 的 example 字段生成示例 JSON ---------- */

function exampleFromSchema(node: Json | undefined, depth = 0): any {
  node = deref(node)
  if (!node || depth > 6) return null
  if (node.example !== undefined) return node.example
  if (node.default !== undefined) return node.default
  if (Array.isArray(node.oneOf) && node.oneOf.length) return exampleFromSchema(node.oneOf[0], depth + 1)
  if (node.type === 'array') return [exampleFromSchema(node.items, depth + 1)]
  if (node.type === 'object' || node.properties) {
    const out: Json = {}
    for (const [key, prop] of Object.entries<Json>(node.properties ?? {})) {
      out[key] = exampleFromSchema(prop, depth + 1)
    }
    return out
  }
  switch (node.type) {
    case 'string': return 'string'
    case 'integer':
    case 'number': return 0
    case 'boolean': return false
    default: return null
  }
}

function pretty(value: any): string {
  return JSON.stringify(value, null, 2)
}

/* ---------- 端点组装 ---------- */

interface ParamRow {
  name: string
  location: string
  required: boolean
  type: string
  description: string
}

interface ResponseRow {
  status: string
  description: string
  schema: string
  example: string
}

interface Endpoint {
  id: string
  method: string
  path: string
  summary: string
  description: string
  auth: boolean
  params: ParamRow[]
  bodyProperties: ParamRow[] | null
  bodyExample: string
  responses: ResponseRow[]
}

const endpoints = computed<Endpoint[]>(() => {
  const root = doc.value
  if (!root?.paths) return []

  const out: Endpoint[] = []
  for (const [path, pathItem] of Object.entries<Json>(root.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem?.[method]
      if (!op) continue

      const params: ParamRow[] = (op.parameters ?? []).map((p: Json) => {
        p = deref(p) ?? p
        const schema = deref(p.schema)
        return {
          name: p.name ?? '',
          location: p.in ?? 'query',
          required: !!p.required,
          type: schemaName(p.schema) || 'string',
          description: p.description ?? '',
        }
      })

      const bodySchema = deref(
        op.requestBody?.content?.['application/json']?.schema,
      )
      let bodyProperties: ParamRow[] | null = null
      let bodyExample = ''
      if (bodySchema) {
        const required: string[] = bodySchema.required ?? []
        bodyProperties = Object.entries<Json>(bodySchema.properties ?? {}).map(
          ([name, prop]) => ({
            name,
            location: 'body',
            required: required.includes(name),
            type: schemaName(prop),
            description: prop.description ?? '',
          }),
        )
        bodyExample = pretty(exampleFromSchema(bodySchema))
      }

      const responses: ResponseRow[] = Object.entries<Json>(op.responses ?? {}).map(
        ([status, respRaw]) => {
          const resp = deref(respRaw) ?? respRaw
          const content = resp.content?.['application/json']
          const schemaNode = content?.schema
          let example: any = null
          const examples = content?.examples
          if (examples) {
            const first = Object.values<Json>(examples)[0]
            example = first?.value ?? null
          } else if (schemaNode) {
            example = exampleFromSchema(schemaNode)
          }
          return {
            status,
            description: resp.description ?? '',
            schema: schemaName(schemaNode),
            example: example == null ? '' : pretty(example),
          }
        },
      )

      out.push({
        id: `${method}-${path}`.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? '',
        description: op.description ?? '',
        auth: Array.isArray(op.security) && op.security.length > 0,
        params,
        bodyProperties,
        bodyExample,
        responses,
      })
    }
  }
  return out
})

const serverUrl = computed(() => doc.value?.servers?.[0]?.url ?? '')
</script>

<template>
  <div class="api-reference">
    <p v-if="loadError" class="api-error">OpenAPI 文档加载失败：{{ loadError }}</p>
    <p v-else-if="!doc" class="api-loading">正在加载 OpenAPI 文档…</p>

    <template v-else>
      <div class="api-intro">
        <p class="api-line">
          REST API 地址
          <code class="api-server">{{ serverUrl }}</code>
        </p>
        <p class="api-line api-auth">
          除特别说明外，所有接口都需要
          <code>Authorization: Bearer &lt;api-key&gt;</code>
          认证。
        </p>
      </div>

      <section v-for="ep in endpoints" :key="ep.id" class="api-endpoint">
        <h2 :id="ep.id" class="api-endpoint-title">
          <span class="api-anchor" aria-hidden="true">#</span>
          {{ ep.summary }}
        </h2>

        <p class="api-route">
          <span class="api-method" :class="`api-method-${ep.method.toLowerCase()}`">{{ ep.method }}</span>
          <code class="api-path">{{ ep.path }}</code>
          <span v-if="ep.auth" class="api-auth-badge">需要认证</span>
        </p>

        <p v-if="ep.description" class="api-desc">{{ ep.description }}</p>

        <template v-if="ep.params.length">
          <h3 class="api-sub">请求参数</h3>
          <table class="api-table">
            <thead>
              <tr><th>名称</th><th>位置</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in ep.params" :key="p.name">
                <td><code>{{ p.name }}</code></td>
                <td>{{ p.location }}</td>
                <td><code>{{ p.type }}</code></td>
                <td>{{ p.required ? '是' : '否' }}</td>
                <td class="api-td-desc">{{ p.description }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="ep.bodyProperties">
          <h3 class="api-sub">请求体</h3>
          <table class="api-table">
            <thead>
              <tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in ep.bodyProperties" :key="p.name">
                <td><code>{{ p.name }}</code></td>
                <td><code>{{ p.type }}</code></td>
                <td>{{ p.required ? '是' : '否' }}</td>
                <td class="api-td-desc">{{ p.description || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="ep.bodyExample" class="api-example">
            <span class="api-example-tag">示例</span>
            <pre><code>{{ ep.bodyExample }}</code></pre>
          </div>
        </template>

        <h3 class="api-sub">响应</h3>
        <div v-for="r in ep.responses" :key="r.status" class="api-response">
          <p class="api-response-head">
            <span class="api-status" :class="r.status.startsWith('2') ? 'api-status-ok' : 'api-status-err'">
              {{ r.status }}
            </span>
            <span class="api-response-desc">{{ r.description }}</span>
            <code v-if="r.schema" class="api-response-schema">{{ r.schema }}</code>
          </p>
          <div v-if="r.example" class="api-example">
            <pre><code>{{ r.example }}</code></pre>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.api-loading,
.api-error {
  color: var(--on-surface-dim);
  font-size: 0.95rem;
}
.api-error { color: var(--on-error-container); }

.api-intro {
  margin-bottom: 40px;
  padding: 18px 20px;
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-l);
  background: var(--surface-bright);
}
.api-line { margin: 4px 0; color: var(--on-surface-variant); font-size: 0.94rem; }
.api-line code {
  padding: 2px 8px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-s);
  background: var(--code-bg);
  color: var(--on-brand-container);
  font-size: 0.85em;
}

.api-endpoint {
  margin-bottom: 56px;
  padding-top: 8px;
}

.api-endpoint-title {
  position: relative;
  font-size: 1.4rem;
}
.api-anchor {
  position: absolute;
  left: -1.1em;
  color: var(--brand);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.api-endpoint-title:hover .api-anchor { opacity: 1; }

.api-route {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
}

.api-method {
  padding: 3px 10px;
  border-radius: var(--radius-s);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.api-method-get { background: var(--success-container); color: var(--on-success-container); }
.api-method-post { background: var(--brand-container); color: var(--on-brand-container); }
.api-method-delete { background: var(--error-container); color: var(--on-error-container); }
.api-method-put,
.api-method-patch { background: var(--warning-container); color: var(--on-warning-container); }

.api-path {
  padding: 3px 10px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-s);
  background: var(--code-bg);
  color: var(--on-surface);
  font-size: 0.88rem;
}

.api-auth-badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 0.75rem;
  font-weight: 600;
}

.api-desc { color: var(--on-surface-variant); font-size: 0.94rem; }

.api-sub {
  margin: 26px 0 10px;
  font-size: 1rem;
}

.api-table {
  width: 100%;
  margin: 10px 0;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.api-table th,
.api-table td {
  padding: 9px 12px;
  border: 1px solid var(--outline-variant);
  text-align: left;
  vertical-align: top;
}
.api-table th {
  background: var(--surface-container);
  color: var(--on-surface);
  font-weight: 600;
  white-space: nowrap;
}
.api-table td { color: var(--on-surface-variant); }
.api-table td code {
  padding: 1px 6px;
  border-radius: var(--radius-s);
  background: var(--code-bg);
  color: var(--on-brand-container);
  font-size: 0.82rem;
}
.api-td-desc { white-space: pre-line; min-width: 16em; }

.api-example {
  position: relative;
  margin: 10px 0;
}
.api-example pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-m);
  background: var(--code-bg);
  color: var(--code-text);
  font-size: 0.84rem;
  line-height: 1.6;
}
.api-example-tag {
  position: absolute;
  top: -8px;
  left: 12px;
  padding: 0 8px;
  border: 1px solid var(--outline);
  border-radius: 4px;
  background: var(--surface-bright);
  color: var(--on-surface-dim);
  font-size: 0.7rem;
}

.api-response { margin: 14px 0; }
.api-response-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 4px;
}
.api-status {
  padding: 2px 9px;
  border-radius: var(--radius-s);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 700;
}
.api-status-ok { background: var(--success-container); color: var(--on-success-container); }
.api-status-err { background: var(--error-container); color: var(--on-error-container); }
.api-response-desc { color: var(--on-surface-variant); font-size: 0.9rem; }
.api-response-schema {
  padding: 1px 7px;
  border-radius: var(--radius-s);
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 0.78rem;
}
</style>
