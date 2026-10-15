# @byclaw/dsh-lan-web

[English](README.md) | 中文

这个可选 DSH profile bundle 用于启用现有命令 `dsh web --host 0.0.0.0`。它只替换发行版 Web 命令行 provider；除非启用 ByClaw 显式免鉴权开关，否则 HTTP server、LAN 地址发现、可信 Host 校验、浏览器会话、API transport 和 WebSocket 鉴权仍由 DSH 原实现负责。

## 安装

先在 DSH 工作区构建，再把插件加入 `web` profile：

```sh
pnpm --filter @byclaw/dsh-lan-web run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-lan-web
```

在所有 IPv4 网卡上启动 GUI：

```sh
dsh web --host 0.0.0.0 --no-open
```

DSH 会打印 loopback 启动 URL 和一个 LAN URL；在其他设备上打开 LAN URL 即可。除非设置 `BYCLAW_DSH_WEB_AUTH_ENABLED=false`，该 URL 会包含当前启动 token。`--port` 和可重复的 `--trusted-host` 保持发行版原有语义。

## 鉴权

默认情况下，LAN bundle 不会关闭 DSH 鉴权。启动 URL 用一次性的进程 token 换取签名浏览器会话 cookie；Host/Origin 校验以及 API/WebSocket 鉴权继续生效。

安装 `@byclaw/dsh-integration` 后，可以用 `BYCLAW_DSH_WEB_AUTH_TOKEN` 提供固定公开启动 token。若要关闭 Web UI、HTTP API 和 WebSocket 的 token 与签名 cookie 鉴权，请设置：

```sh
BYCLAW_DSH_WEB_AUTH_ENABLED=false
```

该开关默认启用，接受 `true/false`、`1/0`、`on/off` 或 `yes/no`。设为 `false` 后，启动过程会打印不含 token 的 URL，可信 LAN 客户端可直接连接；Host/Origin 拒绝仍然生效。

## 安全限制

服务器使用明文 HTTP，不提供 TLS。启用鉴权时，任何获得启动 token 并取得会话 cookie 的 LAN 用户，都可以调用 dsh API，并执行该 profile 授予的工具。设置 `BYCLAW_DSH_WEB_AUTH_ENABLED=false` 后，任何通过 Host/Origin 校验的客户端无需 token 即可执行这些操作。只应在可信、隔离的网络中监听所有网卡；不可信网络应使用带身份认证的 TLS 反向代理、VPN 或 SSH 转发。启动过程会分别为监听所有网卡和免鉴权模式打印警告。

## 开发验证

```sh
pnpm --filter @byclaw/dsh-lan-web run test
pnpm --filter @byclaw/dsh-lan-web run typecheck
pnpm --filter @byclaw/dsh-lan-web run build
```
