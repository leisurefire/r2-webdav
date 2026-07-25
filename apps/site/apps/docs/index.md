---
layout: home

hero:
  name: R2 WebDAV X
  text: 文档中心
  tagline: 从 Cloudflare 资源准备到 DAV 客户端连接，完成个人云端工作区的部署与维护。
  actions:
    - theme: brand
      text: Quick Start
      link: /quick-start
    - theme: alt
      text: Deploy
      link: /deploy

features:
  - title: Quick Start
    details: 了解系统边界、准备 Cloudflare 资源并完成第一次部署。
    link: /quick-start
    linkText: 开始阅读
  - title: 客户端连接
    details: 配置 WebDAV、CalDAV、rclone、DAVx5 与 Apple Calendar。
    link: /clients
    linkText: 查看地址
  - title: 开发参考
    details: 本地运行 Worker、Vite 与 Pages Functions，执行测试和数据库迁移。
    link: /development
    linkText: 进入开发
---

# 项目概览

R2 WebDAV X 是一个面向个人使用的单用户、自托管云端工作区。它不是网盘 SaaS，也没有多租户、计费或 ACL。部署者在自己的 Cloudflare 账户中运行服务，并自行掌握数据与登录凭据。

## 组成

| 组件 | 职责 | 数据 |
| --- | --- | --- |
| DAV Worker | WebDAV、CalDAV、文件/日历/会话 JSON API、鉴权 | 读写 R2 与 D1 |
| Pages SPA | 文件、日历、笔记、书签、设备与设置界面 | 通过 API 访问 |
| Pages Functions | 同源 Notes API | D1 中的笔记和目录 |
| R2 Bucket | 文件对象、目录元数据与 `.ics` 日历对象 | `fs/default/`、`caldav/default/` |
| D1 | 会话、笔记、笔记目录与 AI 对话 | `NOTES_DB` |

## 功能边界

- WebDAV 客户端看到的根路径始终是 `/`，内部 `fs/default/` 前缀不会暴露。
- CalDAV 支持发现、日历集合、事件读写和查询；客户端使用 HTTPS 直连 Worker。
- 浏览器会话默认在 30 天无活动后过期，可在设备页面撤销其他会话。
- 笔记由 Pages Functions 处理，因此 Worker 与 Pages 必须绑定同一个 D1 数据库。
- 当前上传流程不是分片上传，超大文件应优先使用 WebDAV/rclone，并留意 Cloudflare 请求限制。

## 下一步

第一次部署从 [Quick Start](/quick-start) 进入。需要完整的绑定、域名、CORS 和迁移说明时，直接阅读 [Deploy](/deploy)。
