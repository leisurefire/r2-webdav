# Quick Start

本页给出从源码到可登录网页的最短路径。生产环境的域名、迁移和上线检查见 [Deploy](/deploy)。

## 前置条件

- Cloudflare 账号
- Node.js 22 或更高版本
- 一个 R2 Bucket
- 一个 D1 数据库
- 本仓库源码

::: warning 当前是单用户模式
所有数据都属于固定的 `default` 用户。不要把同一部署开放给互不信任的多人使用。
:::

## 1. 安装依赖

```bash
git clone https://github.com/leisurefire/r2-webdav.git
cd r2-webdav
npm install
npx wrangler login
```

## 2. 创建云端资源

```bash
npx wrangler r2 bucket create my-r2-webdav
npx wrangler d1 create notes
```

将命令返回的 Bucket 名称和 D1 `database_id` 分别写入：

- `apps/dav-worker/wrangler.toml`
- `apps/web/wrangler.toml`

两个项目中的 D1 binding 都必须叫 `NOTES_DB`，并指向同一个数据库。

## 3. 设置登录凭据

```bash
cd apps/dav-worker
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
cd ../..
```

使用独立的长密码。WebDAV 与 CalDAV 客户端会使用这组 Basic 凭据；网页登录会将其交换为随机会话令牌。

## 4. 迁移 D1

```bash
npm run db:migrate -w @r2-webdav/dav-worker
```

迁移会创建会话、笔记、嵌套目录和笔记 AI 对话相关表。生产部署不要跳过这一步。

## 5. 部署 Worker

在 `apps/dav-worker/wrangler.toml` 中配置 R2、D1 和前端源：

```toml
[[r2_buckets]]
binding = "bucket"
bucket_name = "my-r2-webdav"

[[d1_databases]]
binding = "NOTES_DB"
database_name = "notes"
database_id = "<your-database-id>"

[vars]
CORS_ORIGIN = "https://my-r2-webdav-ui.pages.dev"
JWT_TTL_SECONDS = "2592000"
```

```bash
npm run deploy:worker
```

记录 Worker 地址，例如 `https://my-r2-webdav.<subdomain>.workers.dev`。

## 6. 部署 Pages

创建 `apps/web/.env.production.local`：

```dotenv
VITE_API_BASE=https://my-r2-webdav.<subdomain>.workers.dev
```

然后构建并部署：

```bash
npm run build -w @r2-webdav/web
npm run deploy:web -- --project-name my-r2-webdav-ui
```

打开 `https://my-r2-webdav-ui.pages.dev/login`，使用刚才设置的用户名和密码登录。

## 7. 验证

```bash
curl https://my-r2-webdav.<subdomain>.workers.dev/api/v1/health
```

应返回：

```json
{"ok":true,"data":{"status":"ok"}}
```

登录后依次验证新建目录、上传文件、新建笔记和日历事件。之后按[客户端连接](/clients)配置 WebDAV 或 CalDAV。

## 常见问题

### 网页提示 CORS 错误

`CORS_ORIGIN` 必须与浏览器中的 Pages Origin 完全一致，包括 `https://`，且不要带尾部 `/`。修改后要重新部署 Worker。

### 笔记返回 500

先确认 Pages 和 Worker 绑定了同一个 `NOTES_DB`，再确认远端 migrations 已全部应用。

### 能登录但看不到旧文件

当前文件前缀是 `fs/default/`。旧版直接保存在 Bucket 根目录的数据需要按[旧 Bucket 迁移](/deploy#旧-bucket-迁移)处理。
