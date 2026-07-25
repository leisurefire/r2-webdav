# 本地开发

仓库是 npm workspaces 管理的 TypeScript monorepo。

```text
apps/dav-worker/    WebDAV、CalDAV、JSON API Worker
apps/web/           Vite SPA 与 Pages Functions
packages/shared-types/  前后端共享 API 类型
```

## 环境准备

使用仓库固定的 Node.js 22：

```bash
npm install
```

创建 `apps/dav-worker/.dev.vars`：

```dotenv
USERNAME=admin
PASSWORD=change-me
```

如 Worker 不在 Vite 默认预期地址，创建 `apps/web/.env.local`：

```dotenv
VITE_API_BASE=http://localhost:8787
```

## 启动 Worker 与前端

在两个终端中运行：

```bash
npm run dev
```

```bash
npm run dev:web
```

默认地址：

- Worker：`http://localhost:8787`
- Vite：`http://localhost:5173`

Vite 开发服务器不会执行 Pages Functions，因此本地测试 Notes API 时，应先构建前端，再从 `apps/web` 启动 Pages 开发服务器：

```bash
npm run build -w @r2-webdav/web
cd apps/web
npx wrangler pages dev dist
```

## 数据与绑定

Worker 的本地 R2 由 Wrangler 模拟。D1 schema 以 `apps/dav-worker/migrations/` 为准，不要只依赖运行时幂等初始化，因为 Pages Functions 不负责建表。

新增 migration 后同时检查：

- Worker 测试环境能应用 schema
- Pages Functions 类型与查询兼容
- 旧版本代码是否仍能读取迁移后的数据库

## 质量检查

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

Worker 集成测试运行在 Cloudflare Workers Vitest pool，并使用隔离的 R2 binding。WebDAV 协议变更还应覆盖 `basic`、`copymove`、`props` 与 `locks` Litmus 套件。

## 模块边界

- `apps/dav-worker/src/webdav`：WebDAV 方法与 XML 响应
- `apps/dav-worker/src/caldav`：CalDAV 发现、REPORT 与 iCalendar
- `apps/dav-worker/src/api`：浏览器使用的 JSON API
- `apps/dav-worker/src/auth`：Basic、Cookie、Bearer 与会话
- `apps/web/src/pages`：文件、日历、登录、设备、设置页面
- `apps/web/src/notes`：笔记缓存、同步、目录树与编辑器

JSON API 应复用协议层相同的存储与鉴权逻辑，避免形成两套行为不一致的数据实现。
