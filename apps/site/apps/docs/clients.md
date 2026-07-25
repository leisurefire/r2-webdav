# 客户端连接

WebDAV 与 CalDAV 都由 DAV Worker 提供，并共用 `USERNAME`、`PASSWORD` 两个 Secret。

## 连接地址

假设 Worker 域名是 `https://dav.example.com`：

| 用途 | 地址 |
| --- | --- |
| WebDAV 根目录 | `https://dav.example.com/` |
| CalDAV 自动发现 | `https://dav.example.com/.well-known/caldav` |
| CalDAV 服务根 | `https://dav.example.com/caldav/` |
| 日历主页 | `https://dav.example.com/caldav/default/calendars/` |

如果客户端支持自动发现，优先填写 CalDAV 服务根或 Worker 域名；只有发现失败时再填写完整日历主页。

## rclone

```bash
rclone config
```

新建 remote 时选择 `webdav`：

```text
url: https://dav.example.com/
vendor: other
user: <USERNAME>
pass: <PASSWORD>
```

验证：

```bash
rclone lsd mydav:
rclone copy ./example.txt mydav:/test/
```

## Windows

Windows 资源管理器内置 WebDAV 对认证、路径和文件大小的兼容性较严格。日常使用更推荐 rclone mount、Cyberduck 或 RaiDrive。

使用系统映射时，在“此电脑”中添加网络位置，地址填写 WebDAV 根目录，并输入固定账号密码。

## macOS Finder

1. 打开 Finder，选择“前往 > 连接服务器”。
2. 输入 `https://dav.example.com/`。
3. 选择注册用户并填写账号密码。

## DAVx5 / Android

1. 新建“使用 URL 和用户名登录”的账号。
2. Base URL 填写 `https://dav.example.com/caldav/`。
3. 输入固定账号密码。
4. 发现资源后启用需要同步的日历。

若系统日历中没有出现事件，检查 DAVx5 的账号同步开关和应用后台权限。

## Apple Calendar

在系统设置的“互联网账户”中添加 CalDAV 账户：

```text
账户类型：手动
用户名：<USERNAME>
密码：<PASSWORD>
服务器地址：dav.example.com
```

服务器必须已配置有效 HTTPS 证书。

## 鉴权说明

- WebDAV/CalDAV 使用 Basic Authentication 最兼容。
- 浏览器登录后使用 HttpOnly Cookie 或 Bearer Token，不会把密码保存在前端状态中。
- 会话令牌不能代替密码配置到所有 DAV 客户端；不同客户端对 Bearer 支持不一致。

## 故障排查

### 返回 401

确认使用 Worker Secret 的实际值，而不是变量名 `USERNAME` / `PASSWORD`。重新设置 Secret 后需要重新部署或等待新版本生效。

### 能列目录但无法写入

检查客户端是否将目标地址视为目录，并确认路径没有使用 Bucket 内部的 `fs/default` 前缀。

### 日历发现失败

先访问 `https://dav.example.com/.well-known/caldav`，确认响应会重定向到 `/caldav/`。再检查客户端是否允许跟随 HTTPS 重定向。

### 同一事件重复出现

避免多个客户端用不同 UID 创建同一个事件。刷新客户端账号并确认系统中没有重复订阅同一个日历。
