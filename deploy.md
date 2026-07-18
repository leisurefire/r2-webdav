# Cloudflare 部署指南

本指南使用单用户模式，不需要 KV。WebDAV、CalDAV、文件和日历 API 由 Worker 提供，便签 CRUD 由 Pages Functions 提供；两者共享名为 `notes` 的 D1 数据库和会话表。建议先用 `workers.dev` 和 `pages.dev` 验证，再绑定自己的域名。

当前项目已固定使用：

- 前端：`https://webdav-ui.127631.xyz`
- Worker/API：`https://r2-webdav-x.9694151.workers.dev`
- Pages 项目：`webdav-ui`

## 1. 准备

需要：

- Cloudflare 账号
- Node.js 20 或更高版本
- 已克隆的本仓库
- 可选：托管在 Cloudflare 的域名

在仓库根目录执行：

```bash
npm install
npx wrangler login
```

浏览器会打开 Cloudflare 授权页。授权完成后可用以下命令确认账号：

```bash
npx wrangler whoami
```

## 2. 创建 R2 Bucket

选择一个全局唯一且便于识别的名称，例如 `my-r2-webdav`：

```bash
npx wrangler r2 bucket create my-r2-webdav
```

打开 `apps/dav-worker/wrangler.toml`，修改 Bucket 名称和 Worker 名称：

```toml
name = "my-r2-webdav-worker"

[[r2_buckets]]
binding = "bucket"
bucket_name = "my-r2-webdav"
```

`binding = "bucket"` 不要修改，代码依赖这个绑定名。

## 3. 配置登录

进入 Worker 项目目录：

```bash
cd apps/dav-worker
```

依次写入两个 Worker Secret：

```bash
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
```

- `USERNAME`：WebDAV、CalDAV 和网页管理端的固定用户名。
- `PASSWORD`：使用足够长的独立密码，不要复用 Cloudflare 密码。
  登录后会生成随机会话令牌，其哈希保存在 D1。旧部署中的 `JWT_SECRET` 可以保留，但新会话不再依赖它。

## 4. 配置 D1 数据库

项目通过 `NOTES_DB` binding 访问名为 `notes` 的 D1 数据库。确认 `apps/dav-worker/wrangler.toml` 和 `apps/web/wrangler.toml` 中的 `database_id` 都指向同一个数据库：

```toml
[[d1_databases]]
binding = "NOTES_DB"
database_name = "notes"
database_id = "0dcb94cd-c8b4-4dfa-8a32-4328ddae0aa3"
```

首次部署或新增 migration 后，在仓库根目录执行：

```bash
npm run db:migrate -w @r2-webdav/dav-worker
```

该命令会按顺序应用 `0001_sessions_and_notes.sql` 与 `0002_note_folders.sql`，建立会话、便签和便签目录表，并为既有便签补充 `folder_id`。Worker 运行时也会执行幂等初始化，但 Pages Functions 不负责建表，因此正式部署必须先应用 migration。

升级已有部署时，先迁移数据库，再部署 Worker 和 Pages。`0002` 只新增目录表、字段和索引，不会删除或改写既有便签；旧便签迁移后会显示在“未分类”中。可先查看待应用迁移：

```bash
npx wrangler d1 migrations list notes --remote --config apps/dav-worker/wrangler.toml
```

## 5. 首次部署 Worker

先在 `apps/dav-worker/wrangler.toml` 中设置 Pages 的预期生产地址。假设 Pages 项目名为 `my-r2-webdav-ui`：

```toml
[vars]
CORS_ORIGIN = "https://my-r2-webdav-ui.pages.dev"
```

部署：

```bash
npx wrangler deploy
```

记下输出中的 Worker 地址，例如：

```text
https://my-r2-webdav-worker.<subdomain>.workers.dev
```

验证公开健康检查：

```bash
curl https://my-r2-webdav-worker.<subdomain>.workers.dev/api/v1/health
```

应返回包含 `"ok":true` 和 `"status":"ok"` 的 JSON。

## 6. 构建并部署 Pages

回到仓库根目录，创建 `apps/web/.env.production.local`：

```dotenv
VITE_API_BASE=https://my-r2-webdav-worker.<subdomain>.workers.dev
```

这里必须是 Worker 地址，末尾不要加 `/`。便签请求不使用这个地址，而是自动调用 Pages 同源的 `/api/v1/notes`。然后执行：

```bash
npm run build -w @r2-webdav/web
npm run deploy -w @r2-webdav/web -- --project-name my-r2-webdav-ui
```

Pages Functions 位于 `apps/web/functions`，因此不要在仓库根目录直接执行 `wrangler pages deploy apps/web/dist`。workspace 脚本会自动以 `apps/web` 为工作目录，让 Wrangler 同时发现 `dist` 和 `functions`。如果终端已经位于 `apps/web`，也可以执行：

```bash
npx wrangler pages deploy dist --project-name my-r2-webdav-ui
```

部署日志中应同时出现 Functions bundle；若只显示静态资源，请先检查当前目录。

部署完成后打开：

```text
https://my-r2-webdav-ui.pages.dev/login
```

使用第 3 步设置的 `USERNAME` 和 `PASSWORD` 登录。

若浏览器显示 CORS 错误，确认：

- Worker 的 `CORS_ORIGIN` 与浏览器地址完全一致，包括 `https://`。
- 没有尾部 `/`。
- 修改 `wrangler.toml` 后重新执行了 `npx wrangler deploy`。

## 7. 绑定自定义域名

推荐：

- `dav.example.com` 绑定 Worker
- `app.example.com` 绑定 Pages

在 Cloudflare Dashboard 中：

1. 打开 **Workers & Pages**，选择 Worker。
2. 在 **Settings > Domains & Routes** 添加 `dav.example.com`。
3. 选择 Pages 项目，在 **Custom domains** 添加 `app.example.com`。
4. 等待证书状态变为 Active。

域名生效后做两处修改：

`apps/dav-worker/wrangler.toml`：

```toml
CORS_ORIGIN = "https://app.example.com"
```

`apps/web/.env.production.local`：

```dotenv
VITE_API_BASE=https://dav.example.com
```

重新部署 Worker，并重新构建、部署 Pages：

```bash
npm run deploy:worker
npm run build -w @r2-webdav/web
npm run deploy:web
```

## 8. 客户端连接

WebDAV：

```text
服务器：https://dav.example.com/
用户名：USERNAME Secret 的值
密码：PASSWORD Secret 的值
```

CalDAV：

```text
服务器：https://dav.example.com/caldav/
用户名：USERNAME Secret 的值
密码：PASSWORD Secret 的值
```

支持的 CalDAV 日历主页为：

```text
https://dav.example.com/caldav/default/calendars/
```

优先用 DAVx5 或 Apple Calendar 验证，再连接华为日历。客户端必须使用 HTTPS。

## 9. 上线检查

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

然后手工验证：

1. 网页登录。
2. 新建目录、上传、重命名、下载和删除文件。
3. 新建日历事件并刷新页面。
4. WebDAV 客户端上传文件后，在网页文件页确认可见。
5. CalDAV 客户端新建事件后，在网页日历确认可见。

## 10. 旧版本数据

旧版 `r2-webdav` 把文件直接存储在 Bucket 根目录；新版使用 `fs/default/`。现有 Bucket 上线前，必须把旧文件复制到这个前缀并保留 HTTP metadata 与 custom metadata。

不要直接在生产 Bucket 上批量移动后立即切流。先复制到临时 Bucket 或使用预发布 Worker 验证 WebDAV 的 PROPFIND、锁和目录元数据，再切换生产域名。日历数据位于 `caldav/default/`，不要移动到文件前缀。

## 11. 使用 Cloudflare 原生 Git 自动部署

仓库不使用 GitHub Actions 发布。`.github/workflows/ci.yml` 只负责代码检查，不接触 Cloudflare；Worker 与 Pages 分别通过 Cloudflare Dashboard 连接同一个 GitHub 仓库。

### 11.1 连接 Worker

1. 打开 Cloudflare Dashboard 的 **Workers & Pages**。
2. 进入现有 Worker `r2-webdav-x`。
3. 打开 **Settings > Builds**（部分界面显示为 **Builds & deployments**）。
4. 选择 **Connect to Git**，授权 Cloudflare 访问 GitHub 仓库。
5. 选择本仓库，并填写以下配置：

| 配置                          | 值                                           |
| ----------------------------- | -------------------------------------------- |
| Production branch             | `main`                                       |
| Root directory                | `/` 或留空（仓库根目录）                     |
| Build command                 | `npm run typecheck -w @r2-webdav/dav-worker` |
| Deploy command                | `npm run deploy:worker`                      |
| Build variable                | `NODE_VERSION=22`                            |
| Non-production branch deploys | 按需开启；生产环境建议先关闭                 |

不要把 Root directory 设置为 `apps/dav-worker`。本项目使用 npm workspaces，并依赖仓库中的 `packages/shared-types`，构建必须从仓库根目录执行。

Worker 的 D1、R2 和普通变量由 `apps/dav-worker/wrangler.toml` 提供。登录密钥继续保存在 Worker 的 **Settings > Variables and Secrets**：

- `USERNAME`
- `PASSWORD`
- `JWT_SECRET`（为兼容旧部署可以保留）

Cloudflare 原生 Builds 不需要在 GitHub 中保存 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID`。Build command 只做无副作用的类型检查，Deploy command 交给 Wrangler 完成打包和发布。不要在自动 Build command 中执行 D1 migration：远程迁移可能等待确认或 Cloudflare API 响应，使构建长时间停住。首次部署以及新增 migration 后，按第 4 节从本地显式执行一次 migration，再触发自动部署。

当前锁定的 Wrangler 要求 Node.js 22 或更高版本，因此 Worker 项目的 **Settings > Builds > Variables and secrets** 中必须设置 `NODE_VERSION=22`。仓库根目录的 `.node-version` 和 `package.json#engines` 也会让本地及其他 CI 环境尽早发现版本不匹配。

### 11.2 连接 Pages

Pages 也需要单独连接 GitHub：

1. 返回 **Workers & Pages**，选择 **Create application > Pages > Connect to Git**。
2. 选择同一个 GitHub 仓库。
3. 使用以下构建配置：

| 配置                   | 值                                                           |
| ---------------------- | ------------------------------------------------------------ |
| Project name           | `webdav-ui`，若名称已被 Direct Upload 项目占用则先使用新名称 |
| Production branch      | `main`                                                       |
| Framework preset       | `None` 或 `Vite`                                             |
| Root directory         | `apps/web`                                                   |
| Build command          | `npm run build`                                              |
| Build output directory | `dist`                                                       |

在 Pages 的 **Settings > Environment variables** 中为 Production 和 Preview 分别设置：

```text
VITE_API_BASE=https://r2-webdav-x.9694151.workers.dev
NODE_VERSION=22
```

`VITE_API_BASE` 末尾不要加 `/`。如果使用自定义 Worker 域名，应改成该域名。

在 Pages 的 **Settings > Bindings** 中确认存在 D1 binding `NOTES_DB`，且数据库与 Worker 的 `NOTES_DB` 相同。`apps/web/wrangler.toml` 已包含该配置；Dashboard 中绑定不一致时，便签接口会返回数据库不可用。

> 通过 `wrangler pages deploy` 创建的 Direct Upload Pages 项目通常不能直接转换为 Git 集成。如果现有 `webdav-ui` 页面没有 **Connect to Git**，请新建 Git 集成项目。确认新项目可登录后，再迁移自定义域名；不要在验证前删除当前生产项目。

### 11.3 CORS 与自定义域名

新 Pages 项目的默认域名可能发生变化。把它加入 `apps/dav-worker/wrangler.toml`：

```toml
[vars]
CORS_ORIGIN = "https://webdav-ui.pages.dev,https://webdav-ui.127631.xyz"
```

提交后 Worker 会由 Cloudflare 自动重新部署。确认新 Pages 域名登录正常后，再移除旧域名。

### 11.4 启用后的发布流程

以后只需推送 `main`：

```bash
git push origin main
```

Cloudflare 会分别触发 Worker 与 Pages 构建。可在各自项目的 **Deployments** 页面查看日志或回滚。由于两个项目独立构建，首次配置时建议先成功部署 Worker，再启用 Pages 的生产构建。

若不希望 GitHub 继续运行代码检查，可以另外禁用或删除 `.github/workflows/ci.yml`；它不会执行部署，因此默认保留。
