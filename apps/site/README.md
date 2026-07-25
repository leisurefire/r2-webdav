# R2 WebDAV X Site

项目官网为静态 HTML，文档由 VitePress 构建。官网与文档站共用 `apps/site/assets/theme.css` 和 `apps/site/assets/site-shell.js`，设计令牌与主应用保持一致。

## 目录

- `apps/site`：官网、共享主题、品牌组件与 404 模板
- `apps/docs`：VitePress 文档与 OpenAPI 源文件
- `scripts/assemble.mjs`：将文档构建产物组装到 `apps/site/docs`
- `scripts/build-root.mjs`：生成根路径部署产物
- `scripts/build-gh.mjs`：生成 GitHub Project Pages 产物

## 路由

- `/about/`：产品介绍（与 Web App 同一 Pages 项目）
- `/about/docs/`：文档首页
- `/about/docs/quick-start`：Quick Start
- `/about/docs/deploy`：Deploy
- `/about/docs/clients`：客户端连接
- `/about/docs/development`：本地开发
- `/about/docs/api/server`：JSON API

## 命令

```bash
npm install
npm run dev          # 独立构建后在 http://127.0.0.1:4321 预览
npm run docs:dev     # 在 http://127.0.0.1:5173 单独开发文档
npm run build        # 根路径部署
npm run build:embed  # 构建到 /about 并交给 apps/web 的 public 目录
npm run build:gh     # GitHub Pages，默认 SITE_BASE=/r2-webdav
```

常规部署无需单独发布本目录。`@r2-webdav/web` 的 `build` 会先执行 `build:embed`，最终介绍站、文档与 Web App 一起进入 `apps/web/dist` 并发布到同一个 Pages 项目。
