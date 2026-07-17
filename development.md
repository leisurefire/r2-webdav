┌──────────────────────────────────────┐
浏览器 │ app.example.com (Pages) │
│ SPA：文件管理 / 日历 / 设置 │
└──────────────────┬───────────────────┘
│ HTTPS + JWT/Cookie
│ fetch /api/_
▼
┌──────────────────────────────────────┐
DAV 客户端 │ dav.example.com (Worker) │
华为日历/Apple/ │ ┌─────────────┐ ┌───────────────┐ │
Rclone/DAVx⁵ ───►│ │ WebDAV │ │ CalDAV │ │
│ │ PROPFIND… │ │ REPORT… │ │
│ └──────┬──────┘ └───────┬───────┘ │
│ │ /api/v1/_ JSON │ │
│ └────────┬─────────┘ │
│ ▼ │
│ R2 Bucket (+ 可选 KV) │
└──────────────────────────────────────┘
组件 职责 不负责
Worker WebDAV + CalDAV + /api/v1 JSON、鉴权、R2 拼 HTML 管理页
Pages SPA 静态资源、预览环境 不实现 PROPFIND/REPORT
R2 文件与 .ics 唯一数据源 —
KV（可选） 用户表、会话、分享 token 大文件内容
原则：协议与管理 API 合在一个 Worker；UI 只走 JSON；日历/文件客户端直连 Worker 域名 。

仓库结构（Monorepo）
text
r2-webdav-x/
├── apps/
│ ├── dav-worker/ # 协议 + JSON API
│ │ ├── src/
│ │ │ ├── index.ts # fetch 入口：路由分发
│ │ │ ├── webdav/ # 从原 index.ts 拆分
│ │ │ ├── caldav/ # 新增
│ │ │ ├── api/ # JSON 管理面
│ │ │ ├── auth/
│ │ │ └── shared/ # R2 helpers, xml, ical
│ │ ├── wrangler.toml
│ │ └── package.json
│ └── web/ # Pages SPA
│ ├── src/
│ │ ├── pages/ # 文件 / 日历 / 登录 / 设置
│ │ ├── api/client.ts # 调 Worker /api/v1
│ │ └── components/
│ ├── public/
│ ├── wrangler.toml # pages 或 pages 项目配置
│ └── package.json
├── packages/
│ └── shared-types/ # API 类型、错误码（前后端共用）
├── package.json # pnpm workspace
└── README.md
Fork 起点：把现有 src/index.ts 整文件迁入 apps/dav-worker/src/webdav/，再抽公共层 。

域名与路由
域名 / 路径 目标 说明
dav.example.com/_ Worker 全部 DAV 方法 + CalDAV
dav.example.com/api/v1/_ Worker 管理 JSON API
app.example.com/\* Pages SPA
可选：app → dav 反代 /api Pages \_redirects 或 Worker 路由 同源免 CORS（见下）
推荐双域名（职责最清晰）：

客户端：https://dav.example.com/

人：https://app.example.com/

CORS：Worker 对 Origin: https://app.example.com 放行 Authorization、Content-Type；生产写死 Origin，不要 \* + Credentials 混用。现有 CORS 逻辑可在此基础上收紧 。

同源简化（可选）：Pages 配置
/api/\* → https://dav.example.com/api/:splat（或 Cloudflare 同账号 Worker 路由），前端只请求相对路径 /api/v1/...。

Worker 内部路由
ts
// apps/dav-worker/src/index.ts（示意）
export default {
async fetch(req: Request, env: Env, ctx: ExecutionContext) {
const url = new URL(req.url);

    // 1. 管理 API
    if (url.pathname.startsWith('/api/v1/')) {
      return handleApi(req, env, ctx);
    }

    // 2. CalDAV 发现与集合（可按路径或 resourcetype）
    if (url.pathname.startsWith('/caldav/') || isCalDavMethod(req)) {
      return handleCalDav(req, env);
    }

    // 3. 默认 WebDAV（保留兼容）
    return handleWebDav(req, env);

},
};
方法 路径示例 处理
OPTIONS / PROPFIND / PUT… /files/... 或 / WebDAV
MKCALENDAR / REPORT /caldav/{user}/{cal}/ CalDAV
GET/POST/… /api/v1/\* JSON
OPTIONS 的 DAV 头在 CalDAV 路径上改为：1, 2, calendar-access 。

R2 存储约定
text
{bucket}/
├── fs/
│ └── {user}/
│ └── ... # 普通 WebDAV 文件
├── caldav/
│ └── {user}/
│ └── {calendarId}/
│ ├── .meta.json # displayname, color, ctag（或 customMetadata）
│ └── {eventUid}.ics
└── system/ # 可选：配额、全局配置
集合目录：沿用现有 customMetadata.resourcetype = '<collection />'

日历集合：resourcetype 含 <calendar xmlns="urn:ietf:params:xml:ns:caldav"/>，并维护 getctag

事件：标准 iCalendar 文本对象，key 建议用 UID

单用户阶段可固定 user = default，多用户再开 KV 用户表。

鉴权模型
入口 机制 说明
WebDAV / CalDAV Basic 或 Bearer Token 兼容 Rclone / 系统日历
/api/v1（浏览器） POST /api/v1/auth/login → JWT（HttpOnly Cookie 或 Bearer） 避免 Basic 弹窗
Pages 无密钥；只持 token 密钥只在 Worker env
Env 扩展示例：

text

# apps/dav-worker/wrangler.toml

name = "r2-webdav-x"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[[r2_buckets]]
binding = "bucket"
bucket_name = "your-bucket"

# 可选

# [[kv_namespaces]]

# binding = "USERS"

# id = "..."

[vars]

# 非密钥配置

# secrets: USERNAME, PASSWORD, JWT_SECRET, CORS_ORIGIN

沿用并改进现有 timingSafeEqual Basic 校验 ；API 登录用 Web Crypto HMAC-JWT。

JSON API（Pages 唯一数据面）
最小可用集（Phase 1–2）：

方法 路径 作用
POST /api/v1/auth/login 登录
POST /api/v1/auth/logout 登出
GET /api/v1/fs?path= 列目录
GET /api/v1/fs/content?path= 下载/预览元数据 + 直链
PUT /api/v1/fs/content?path= 上传
DELETE /api/v1/fs?path= 删除
POST /api/v1/fs/mkdir 建目录
POST /api/v1/fs/move 移动/重命名
GET /api/v1/calendars 日历列表
GET /api/v1/calendars/:id/events?from=&to= 事件（已解析 JSON）
POST /api/v1/calendars/:id/events 创建/更新事件
DELETE /api/v1/calendars/:id/events/:uid 删除事件
响应统一：

json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "LOCKED", "message": "..." } }
实现要点：JSON 层 调用与 WebDAV 相同的 R2 读写/锁函数，不要复制两套业务逻辑。

CalDAV 最小实现（华为/Apple 可连）
分阶段（与前序讨论一致）：

P0 连通

OPTIONS：DAV: 1, 2, calendar-access

固定集合：/caldav/{user}/calendars/default/

PROPFIND：resourcetype + getctag + displayname

PUT/GET/DELETE \*.ics

用 DAVx⁵ 验证，再测华为（HTTPS）

P1 兼容

REPORT calendar-query / calendar-multiget

current-user-principal + calendar-home-set

MKCALENDAR、多日历

ical.js 校验 VEVENT

P2 生产

多用户路径隔离

ctag 增量

可选 VTODO

依赖：ical.js（Workers 可用）+ 现有 @xmldom/xmldom 。

Pages 前端方案
项 建议
Pages 的界面模仿OpenAI/ChatGPT风格
路由 /login、/files、/calendar、/settings
状态 轻量（Pinia / Zustand）
上传 fetch PUT + 进度条；大文件后续再上 multipart
日历 UI 月/周视图 + 调 /api/v1/calendars/...；不在浏览器拼 CalDAV XML
配置 VITE_API_BASE=https://dav.example.com 或同源 /api
Pages 项目 不要 放 functions/ 实现 DAV；若需要 BFF，最多做登录代理，协议仍在 Worker。

wrangler / 部署
Worker

bash
cd apps/dav-worker
pnpm wrangler secret put JWT_SECRET
pnpm wrangler secret put PASSWORD
pnpm wrangler deploy

# 绑定自定义域 dav.example.com

Pages

bash
cd apps/web
pnpm build
pnpm wrangler pages deploy dist --project-name r2-webdav-ui

# 自定义域 app.example.com

CI 建议：

apps/dav-worker/\*\* 变更 → 只 deploy Worker

apps/web/\*\* 变更 → 只 deploy Pages

packages/shared-types/\*\* → 两者都测

从原项目迁移步骤
Fork / 复制 仓库，建立 monorepo 骨架

原样迁入 src/index.ts → webdav/，保证现有 WebDAV 回归（Rclone / 浏览器 Basic）

抽出 auth、r2-list、xml、locks 到 shared/

加 /api/v1 健康检查 + 登录 + 列目录（Pages 先做只读文件页）

去掉 GET 目录返回 HTML 作为主入口（可 302 到 app.example.com，或保留兼容开关）

加 CalDAV P0 路径与华为/DAVx⁵ 联调

Pages 补上传、移动、日历 UI

加固：CORS 白名单、JWT 过期、配额、审计日志（D1 可选）

分阶段交付（建议 4 周节奏）
阶段 周期 交付物
M1 骨架 3–5 天 Monorepo、Worker 部署、Pages 空壳、登录 + 列目录 API
M2 文件 1 周 上传/删/移/预览；Pages 文件管理器；WebDAV 回归测试
M3 CalDAV 1–1.5 周 P0+P1；DAVx⁵ + 华为日历联调
M4 打磨 1 周 日历 UI、分享链接、错误码、文档、备份说明
测试清单
类型 工具 / 场景
类型 工具 / 场景
WebDAV Rclone、Cyberduck、macOS 连接服务器
CalDAV DAVx⁵、Apple 日历、华为日历（HTTPS）
API 对 /api/v1 的集成测试（vitest + miniflare）
UI Playwright 关键路径：登录 → 上传 → 建事件
回归 锁（423）、父目录不存在（409）、Overwrite
明确不做 / 延后
Pages Functions 实现 PROPFIND/REPORT

UI 直接发 WebDAV XML

第一期多租户计费、完整 ACL

第一期 Worker 内 SSR 管理后台
