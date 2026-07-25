---
title: JSON API
---

# JSON API

DAV Worker 为浏览器管理端提供 JSON API。WebDAV 和 CalDAV 客户端不使用这些接口，应连接[标准 DAV 地址](/clients)。

## 基础约定

假设 Worker 部署在：

```text
https://dav.example.com
```

除健康检查和登录外，所有接口均需要以下任一凭据：

```http
Authorization: Bearer <session-token>
```

或网页登录后由服务器设置的 `r2_session` HttpOnly Cookie。

JSON 成功响应：

```json
{
  "ok": true,
  "data": {}
}
```

JSON 错误响应：

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "File not found"
  }
}
```

错误码包括 `BAD_REQUEST`、`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`LOCKED`、`PRECONDITION_FAILED` 和 `INTERNAL_ERROR`。

## 系统

### `GET /api/v1/health`

公开健康检查，不需要登录。

```bash
curl https://dav.example.com/api/v1/health
```

```json
{"ok":true,"data":{"status":"ok"}}
```

## 登录与设备

### `POST /api/v1/auth/login`

使用 Worker Secret 中配置的固定账号登录，并创建随机会话。

```bash
curl -X POST https://dav.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change-me"}'
```

```json
{
  "ok": true,
  "data": {
    "token": "r2s_example",
    "expiresAt": "2026-08-24T12:00:00.000Z"
  }
}
```

响应同时设置 HttpOnly Cookie。会话默认在 30 天无活动后过期。

### `POST /api/v1/auth/logout`

撤销当前会话并清除 Cookie。

```json
{"ok":true,"data":{"loggedOut":true}}
```

### `GET /api/v1/auth/devices`

返回当前账号的设备会话，字段包括：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 会话 ID |
| `name` | string | 设备名称 |
| `browser` | string | 浏览器 |
| `platform` | string | 操作系统 |
| `type` | string | `desktop`、`mobile`、`tablet` 或 `unknown` |
| `lastSeenAt` | ISO date | 最近活动时间 |
| `expiresAt` | ISO date | 过期时间 |
| `current` | boolean | 是否为当前会话 |

### `DELETE /api/v1/auth/devices/{id}`

撤销指定会话。撤销当前会话时也会清除 Cookie。

```json
{"ok":true,"data":{"deleted":true,"current":false}}
```

## 文件

文件 API 中的 `path` 是用户可见的相对路径，不包含内部 `fs/default/` 前缀。

### `GET /api/v1/fs?path=`

列出目录。根目录的 `path` 为空字符串。

```bash
curl "https://dav.example.com/api/v1/fs?path=documents" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "ok": true,
  "data": {
    "path": "documents",
    "entries": [
      {
        "name": "readme.md",
        "path": "documents/readme.md",
        "type": "file",
        "size": 1536,
        "contentType": "text/markdown",
        "modifiedAt": "2026-07-25T12:00:00.000Z",
        "etag": "\"example\""
      }
    ]
  }
}
```

### `PUT /api/v1/fs/content?path={path}`

上传或覆盖文件。请求体是原始文件内容，建议携带正确的 `Content-Type`。

```bash
curl -X PUT "https://dav.example.com/api/v1/fs/content?path=documents/readme.md" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/markdown" \
  --data-binary @readme.md
```

接口转发 `If-Match`、`If-None-Match`、`If` 与 `Lock-Token` 条件头。

### `GET /api/v1/fs/content?path={path}`

不带 `download=1` 时返回文件元数据：

```json
{
  "ok": true,
  "data": {
    "path": "documents/readme.md",
    "name": "readme.md",
    "size": 1536,
    "contentType": "text/markdown",
    "modifiedAt": "2026-07-25T12:00:00.000Z",
    "etag": "\"example\"",
    "downloadUrl": "/api/v1/fs/content?path=documents%2Freadme.md&download=1"
  }
}
```

添加 `download=1` 时直接返回文件流，并支持 `Range` 条件请求：

```bash
curl -L "https://dav.example.com/api/v1/fs/content?path=documents/readme.md&download=1" \
  -H "Authorization: Bearer $TOKEN" \
  -o readme.md
```

### `POST /api/v1/fs/mkdir`

```json
{"path":"documents/projects"}
```

### `POST /api/v1/fs/move`

用于移动或重命名。`overwrite` 默认为 `true`。

```json
{
  "from": "documents/old.md",
  "to": "archive/new.md",
  "overwrite": false
}
```

### `DELETE /api/v1/fs?path={path}`

删除文件或目录。非空目录的具体行为与 WebDAV DELETE 保持一致。

## 书签

### `GET /api/v1/bookmarks`

读取 WebDAV 根目录中的 `bookmarkhub.json`。文件必须包含字符串 `version` 和数组 `nodes`。

```bash
curl https://dav.example.com/api/v1/bookmarks \
  -H "Authorization: Bearer $TOKEN"
```

## 日历

### `GET /api/v1/calendars`

返回日历集合：

```json
{
  "ok": true,
  "data": [
    {
      "id": "default",
      "displayName": "Default",
      "color": "#2383e2",
      "ctag": "12"
    }
  ]
}
```

### `GET /api/v1/calendars/{calendarId}/events`

可使用 ISO 8601 `from`、`to` 参数筛选与时间范围重叠的事件。

```bash
curl "https://dav.example.com/api/v1/calendars/default/events?from=2026-07-01T00:00:00Z&to=2026-08-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```

### `POST /api/v1/calendars/{calendarId}/events`

创建或更新事件。省略 `uid` 时由服务器生成。

```json
{
  "title": "项目复盘",
  "start": "2026-07-26T09:00:00+08:00",
  "end": "2026-07-26T10:00:00+08:00",
  "allDay": false,
  "description": "整理本周变更",
  "location": "线上"
}
```

生日事件还可使用 `kind: "birthday"`、`calendarSystem`、`recurrence` 和 `lunarDate` 字段。

### `DELETE /api/v1/calendars/{calendarId}/events/{uid}`

删除指定 UID 的事件，并递增日历 ctag。

```json
{"ok":true,"data":{"deleted":true}}
```

## Notes API

笔记接口由 Pages Functions 在 Web App 同源提供，而不是 DAV Worker：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/notes` | 分页查询笔记 |
| `POST` | `/api/v1/notes` | 创建笔记 |
| `GET` | `/api/v1/notes/{id}` | 获取笔记 |
| `PATCH` | `/api/v1/notes/{id}` | 更新笔记 |
| `DELETE` | `/api/v1/notes/{id}` | 删除笔记 |
| `GET` | `/api/v1/notes/folders` | 查询目录 |
| `POST` | `/api/v1/notes/folders` | 创建目录 |
| `PATCH` | `/api/v1/notes/folders/{id}` | 重命名目录 |
| `DELETE` | `/api/v1/notes/folders/{id}` | 删除目录 |

Notes API 通过同源 Cookie 验证会话，Pages 与 Worker 必须绑定同一个 `NOTES_DB`。

## CORS

浏览器跨域调用 Worker 时，Origin 必须出现在 `CORS_ORIGIN` 的精确允许列表中。不要为携带 Cookie 的请求配置 `*`。
