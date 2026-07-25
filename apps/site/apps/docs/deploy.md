# Deploy

R2 WebDAV X 由两个独立部署组成：DAV Worker 和 Pages Web App。推荐分别使用 `dav.example.com` 与 `app.example.com`，职责和故障边界最清晰。

## 资源清单

| 资源 | Binding / 变量 | 使用方 |
| --- | --- | --- |
| R2 Bucket | `bucket` | DAV Worker |
| D1 Database | `NOTES_DB` | DAV Worker、Pages Functions |
| Worker Secret | `USERNAME`、`PASSWORD` | DAV Worker |
| Worker Variable | `CORS_ORIGIN` | DAV Worker |
| Build Variable | `VITE_API_BASE` | Pages 前端 |

`binding` 名称是代码契约，不要随意更改。

## Worker 配置

`apps/dav-worker/wrangler.toml` 的最小生产配置：

```toml
name = "my-r2-webdav"
main = "src/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[r2_buckets]]
binding = "bucket"
bucket_name = "my-r2-webdav"

[[d1_databases]]
binding = "NOTES_DB"
database_name = "notes"
database_id = "<database-id>"

[vars]
CORS_ORIGIN = "https://app.example.com"
JWT_TTL_SECONDS = "2592000"
```

写入 Secret：

```bash
cd apps/dav-worker
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
```

`CORS_ORIGIN` 支持逗号分隔的多个精确 Origin。使用 Cookie 的跨域请求不能配置为 `*`。

## D1 迁移

首次部署和每次新增 migration 后执行：

```bash
npm run db:migrate -w @r2-webdav/dav-worker
```

检查远端状态：

```bash
npx wrangler d1 migrations list notes --remote --config apps/dav-worker/wrangler.toml
```

升级顺序应为：先迁移 D1，再部署 Worker，最后部署 Pages。

## Pages 配置

`apps/web/wrangler.toml` 需要绑定同一 D1：

```toml
name = "my-r2-webdav-ui"
pages_build_output_dir = "dist"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "NOTES_DB"
database_name = "notes"
database_id = "<same-database-id>"
```

构建时通过环境变量告诉前端 Worker 地址：

```dotenv
VITE_API_BASE=https://dav.example.com
```

部署必须从 `apps/web` workspace 执行，使 Wrangler 同时发现 `dist` 与 `functions`：

```bash
npm run build -w @r2-webdav/web
npm run deploy:web -- --project-name my-r2-webdav-ui
```

::: danger 不要只上传静态目录
在仓库根目录直接运行 `wrangler pages deploy apps/web/dist` 可能遗漏 Pages Functions，导致笔记 API 不存在。
:::

## 自定义域名

推荐域名分配：

```text
https://dav.example.com  -> DAV Worker
https://app.example.com  -> Pages
```

域名绑定后同时更新：

1. Worker 的 `CORS_ORIGIN=https://app.example.com`
2. Pages 构建变量 `VITE_API_BASE=https://dav.example.com`
3. 重新部署 Worker 和 Pages

所有 DAV 客户端都应使用 HTTPS。Basic 凭据会被每个请求携带，不要通过明文 HTTP 连接。

## 存储布局

```text
R2 Bucket
├── fs/default/                              # WebDAV 文件
└── caldav/default/calendars/{calendarId}/   # 元数据与 .ics

D1
├── sessions
├── notes
├── note_folders
└── note_ai_chats
```

Worker 会在第一次认证请求时懒创建文件根集合与默认日历。

## 旧 Bucket 迁移

早期版本把 WebDAV 对象放在 Bucket 根目录。升级前需要将这些对象复制到 `fs/default/`，并保留 HTTP metadata 与 custom metadata。

不要移动以下内容：

- `caldav/default/` 下的日历对象
- 任何系统前缀或 D1 数据

建议先复制到临时 Bucket 或预发布前缀，验证 PROPFIND、目录、锁与下载，再切换正式 Worker。项目不会自动移动旧数据，因为批量移动难以安全回滚。

## 上线检查

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

手工检查：

1. 网页登录与退出
2. 文件上传、下载、目录、移动和删除
3. 笔记创建、编辑、刷新与目录移动
4. 网页日历与 CalDAV 客户端双向同步
5. WebDAV 客户端的上传、重命名和锁
6. 设备页面撤销其他会话

## 回滚原则

- Worker 与 Pages 可以分别回滚到上一部署。
- D1 migration 默认只做向前变更；上线前应确认变更兼容旧代码。
- R2 数据迁移优先复制验证，不要直接批量移动或删除生产对象。
