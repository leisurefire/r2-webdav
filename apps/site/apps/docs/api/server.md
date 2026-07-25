---
title: JSON API
pageClass: api-reference-page
---

# JSON API

DAV Worker 提供给浏览器管理端的 JSON API。统一响应格式为 `{ ok, data }` 或 `{ ok, error }`；文件下载接口直接返回二进制内容。

笔记接口由 Pages Functions 在同源 `/api/v1/notes` 下提供，不属于下方 Worker OpenAPI。WebDAV 和 CalDAV 客户端也不应调用 JSON API，而应使用标准 DAV 地址。

<ApiReference />
