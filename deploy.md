# Cloudflare 部署指南

本指南使用单用户模式，不需要 KV、D1 或 Pages Functions。建议先用 `workers.dev` 和 `pages.dev` 验证，再绑定自己的域名。

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

## 3. 配置登录与 JWT 密钥

进入 Worker 项目目录：

```bash
cd apps/dav-worker
```

依次写入三个 Worker Secret：

```bash
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
npx wrangler secret put JWT_SECRET
```

- `USERNAME`：WebDAV、CalDAV 和网页管理端的固定用户名。
- `PASSWORD`：使用足够长的独立密码，不要复用 Cloudflare 密码。
- `JWT_SECRET`：至少 32 字节的随机字符串，不是登录密码。

可用 OpenSSL 生成 JWT 密钥：

```bash
openssl rand -base64 32
```

密钥只存储在 Worker Secret 中，不要写入 `.env`、`wrangler.toml` 或 Git。

## 4. 首次部署 Worker

先在 `apps/dav-worker/wrangler.toml` 中设置 Pages 的预期生产地址。假设 Pages 项目名为 `my-r2-webdav-ui`：

```toml
[vars]
CORS_ORIGIN = "https://my-r2-webdav-ui.pages.dev"
JWT_TTL_SECONDS = "28800"
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

## 5. 构建并部署 Pages

回到仓库根目录，创建 `apps/web/.env.production.local`：

```dotenv
VITE_API_BASE=https://my-r2-webdav-worker.<subdomain>.workers.dev
```

这里必须是 Worker 地址，末尾不要加 `/`。然后执行：

```bash
npm run build -w @r2-webdav/web
npx wrangler pages deploy apps/web/dist --project-name my-r2-webdav-ui
```

上面的 Pages 命令必须在仓库根目录执行。如果终端当前位于 `apps/web`，应改为：

```bash
npx wrangler pages deploy dist --project-name my-r2-webdav-ui
```

不要在 `apps/web` 目录中再次传入 `apps/web/dist`，否则路径会重复为 `apps/web/apps/web/dist`。

部署完成后打开：

```text
https://my-r2-webdav-ui.pages.dev/login
```

使用第 3 步设置的 `USERNAME` 和 `PASSWORD` 登录。

若浏览器显示 CORS 错误，确认：

- Worker 的 `CORS_ORIGIN` 与浏览器地址完全一致，包括 `https://`。
- 没有尾部 `/`。
- 修改 `wrangler.toml` 后重新执行了 `npx wrangler deploy`。

## 6. 绑定自定义域名

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

## 7. 客户端连接

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

## 8. 上线检查

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

## 9. 旧版本数据

旧版 `r2-webdav` 把文件直接存储在 Bucket 根目录；新版使用 `fs/default/`。现有 Bucket 上线前，必须把旧文件复制到这个前缀并保留 HTTP metadata 与 custom metadata。

不要直接在生产 Bucket 上批量移动后立即切流。先复制到临时 Bucket 或使用预发布 Worker 验证 WebDAV 的 PROPFIND、锁和目录元数据，再切换生产域名。日历数据位于 `caldav/default/`，不要移动到文件前缀。

## 10. 开启 GitHub Actions 自动部署

仓库已包含 `.github/workflows/deploy.yml`。它会在代码推送到 `main` 后依次执行类型检查、测试、前端构建、Worker 部署和 Pages 部署，也可以在 GitHub 的 **Actions > deploy > Run workflow** 中手动触发。

### 10.1 创建 Cloudflare API Token

在 Cloudflare Dashboard 的 **My Profile > API Tokens > Create Token** 中创建自定义 Token，并限制到本项目所在账号。至少授予以下 Account 权限：

- **Workers Scripts: Edit**
- **Cloudflare Pages: Edit**
- **Workers R2 Storage: Edit**

如果后续把自定义域名路由也写入 Wrangler 配置，再为对应 Zone 增加 **Workers Routes: Edit**。不要使用 Global API Key。

账号 ID 可在 Cloudflare Dashboard 任一域名或 Workers 概览右侧找到，也可以执行 `npx wrangler whoami` 查看。

### 10.2 配置 GitHub Environment

打开 GitHub 仓库：

1. 进入 **Settings > Environments**，创建名为 `production` 的 Environment。
2. 在该 Environment 的 **Secrets** 中添加：
   - `CLOUDFLARE_API_TOKEN`：上一步创建的 Token。
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。
3. 在该 Environment 的 **Variables** 中添加：
   - `VITE_API_BASE`：生产 Worker 地址，例如 `https://r2-webdav-x.9694151.workers.dev`，末尾不要加 `/`。

`USERNAME`、`PASSWORD`、`JWT_SECRET` 仍然只保存在 Cloudflare Worker Secrets 中，不需要也不应该复制到 GitHub。重新部署 Worker 不会删除这些 Secret。

### 10.3 首次启用

先确认 `apps/dav-worker/wrangler.toml` 中的 Worker 名称、R2 Bucket 和 `CORS_ORIGIN`，以及 `apps/web/package.json` 中 Pages 项目名都指向生产资源。然后提交并推送：

```bash
git add .
git commit -m "Modernize workspace UI and enable automatic deploys"
git push origin main
```

在 GitHub 的 **Actions** 页面观察 `deploy` 工作流。首次成功后，每次推送到 `main` 都会自动发布；Pull Request 只运行现有 `ci` 工作流，不会发布生产环境。

如果希望部署前人工确认，可以在 `production` Environment 中启用 **Required reviewers**。这样构建和测试仍会自动运行，但发布步骤会等待审核。
