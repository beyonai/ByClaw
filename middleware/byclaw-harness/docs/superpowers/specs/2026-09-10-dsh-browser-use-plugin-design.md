# DSH Browser Use 插件设计（最终实现）

日期：2026-09-10

目标分支：`2026.9.8`

范围：仅修改 `byclaw-dsh` 插件与镜像工程，DSH 源码严格只读

## 1. 问题与目标

DSH 原有 Playwright 能力允许不同 Agent 自行启动和操作浏览器。在 AgentTeams、普通 Agent、子 Agent 及混合并发场景中，这会同时带来进程开销和上下文污染：多个 Agent 可能操作同一页面，也可能各自启动完整 Chromium。

最终方案将进程复用与会话隔离拆开：一个 Sandbox 由私有 `browserd` 托管最多一个 Chromium；每个 Agent open turn 拥有独立 Browser Context。最后一个 Context 关闭后保留 30 秒空闲窗口，降低连续任务冷启动。

必须满足：

- DSH 当前 Agent 是唯一规划者，不增加第二个模型或内部规划循环。
- 模型只看到一个有状态工具 `browser`，不看到 Playwright、CDP、进程、租约或 capability。
- 同一 owner 串行，不同 owner 可并发且状态隔离。
- 正常下载不设插件级大小、数量或完成时间上限。
- ByClaw Bash provider 拒绝已知直接浏览器命令，收敛 Agent 行为入口。
- 可选 noVNC 观察同一个共享 Chromium，不为观察再启动浏览器。
- 所有兼容逻辑位于插件与 Docker 工程，绝不修改 DSH 源码。

## 2. 运行架构

```text
User natural language
  -> current DSH Agent (only planner)
    -> stateful DSH tool: browser
      -> server-derived owner + private lease manager
        -> authenticated Unix-socket RPC
          -> browserd (dedicated low-privilege user)
            -> one shared Chromium per Sandbox
              -> one isolated Browser Context per owner/open turn
```

`browserd` 是 Playwright 的唯一使用者。插件通过 Unix socket 调用它；随机 broker secret 由 PID 1 supervisor 在内存中生成，经两个独立继承 FD 分别一次性交付给 broker 和 DSH。secret 不进入参数、普通环境值、文件、日志或模型上下文。

模型调用方不传 owner。插件从 DSH live Agent 和 durable turn-boundary projection 推导：

```text
owner = agentId + sessionId + turn + openTurnStartSeq
```

该身份既能区分同一 session 的不同 turn，也能区分 AgentTeams 团员、根 Agent、子 Agent 和混合执行中的并发成员。

## 3. 模型工具契约

唯一工具名：`browser`。每次调用是一个 object-rooted、closed operation schema：

| 操作 | 参数 | 结果 |
| --- | --- | --- |
| `open` | `startUrl?`, `allowedDomains?`, `allowSubmit?` | `status: opened` + DOM observation |
| `inspect` | 无 | `status: ok` + DOM observation |
| `navigate` | `url` | action result |
| `click` | `element` | action result，可包含 downloads |
| `fill` | `element`, `value` | action result |
| `select` | `element`, `value` | action result |
| `press` | `key` | action result |
| `wait` | `milliseconds` | action result |
| `screenshot` | 无 | PNG 类型、尺寸、大小、SHA-256 元数据 |
| `close` | 无 | `status: closed` |

`open`/`inspect` 提供有界正文和最多 200 个交互元素，索引由 browserd 维护。页面导航后旧索引失效。`wait` 最大 10 秒，按键只允许固定安全集合，拒绝 modifier chord。

当前 `screenshot` 不生成 DSH 图片附件，只返回完整性与尺寸元数据。因此 DOM `inspect` 是模型的主要观察入口，模型是否支持 image 不影响 DOM 工作流。

## 4. 域名与提交策略

只允许无内嵌凭据的 HTTP(S) URL。`allowedDomains` 未提供时默认取 `startUrl` hostname；DNS 条目允许自身及子域名，IP 只精确匹配。若没有 `startUrl` 与 allowlist，Context 只能停在 `about:blank`。

独立的 Context 级 loopback proxy 校验主导航、重定向、子资源、下载连接和 HTTPS CONNECT。跨域跳转、popup 和策略违规会失败关闭，避免污染后续操作。

`allowSubmit` 默认 `false`。未授权时拒绝：

- submit button/image click；
- Enter；
- 焦点位于 submit/keyboard-submit 控件时的 Space。

只有用户明确要求产生外部副作用时，Agent 才能在 `open` 中设置 `allowSubmit: true`。

## 5. 并发、资源与清理

Profile 默认：

| 配置 | 默认值 | 语义 |
| --- | ---: | --- |
| `maxContexts` | 4 | 活跃 owner/Context 上限 |
| `maxQueue` | 32 | FIFO 等待队列上限 |
| `leaseTimeoutMs` | 180000 | open-turn 租约空闲超时；活跃 operation 暂停计时，结束后续期 |
| `idleBrowserMs` | 30000 | profile 兼容声明；分进程 broker 实际读取 `BYCLAW_BROWSER_IDLE_MS` |

同一 owner 的所有 operation 通过私有 lease lane FIFO 串行；同一 socket 上的不同 owner 使用独立 lane，在上限内并发。取消、close、断连和 shutdown 走认证控制面，绕过卡住的业务 lane 并中止其 Context。租约与 capability 只存在于插件/Broker RPC。

以下事件会关闭 Context：显式 `close`、turn stopping/end、Agent/session dispose、调用取消、lease timeout、broker disconnect、插件 shutdown、browser process disconnect。最后一个 Context 关闭后，Chromium 由 broker 继续存活 `BYCLAW_BROWSER_IDLE_MS=30000`；期间新 Context 复用相同进程，超时则退出。

## 6. 下载交付

正常下载不设置文件大小、数量、MIME、文件名或完成时间限制。协议帧与 DOM/screenshot 仍保持有界，这不限制文件内容本身。

Docker 中：

- 父目录 `/run/byclaw-browser/downloads`：`browserd:byclaw-browser`, mode `2770`；
- 每页随机目录：mode `2750`；
- 文件：随机路径、mode `0640`，展示名移除分隔符与控制字符；
- `byclaw` 和 `browserd` 都在 `byclaw-browser` 组。

返回 `{ name, path, size }` 后，Agent 必须在 lease 内读取或复制。页面/Context/连接/进程关闭时清理文件；取消会同时断开进行中的下载和上游连接。

## 7. 防绕过与安全边界

`@byclaw/dsh-bash-provider` 在 Shell executor 边界识别并拒绝已知直接浏览器入口，包括 Playwright/browser-use 命令、Chrome/Chromium、CDP/remote-debugging、package runner、Node/Python import/loader 及已知 shell wrapper 变体，错误为 `DIRECT_BROWSER_ACCESS_DENIED`。

该策略是纵深防御，不是任意代码在同一容器内运行时的硬安全边界。未知 loader、重命名二进制或新的解释器路径可能逃过命令形态识别。对不可信任意代码的强隔离部署必须将 `browserd` 移至 sidecar，隔离文件系统和进程命名空间，只暴露认证私有 API，并让 DSH 容器看不到浏览器二进制与 CDP endpoint。

## 8. Docker 与 noVNC

`Dockerfile.base` 安装 `xvfb`、`xauth`、`x11vnc`、`novnc`、`websockify`，并继续一次性安装固定版本 Playwright Chromium。因为新增系统包，发布时必须重建基础镜像；业务 Dockerfile 只定位并复用已有 Chromium，不允许第二次 browser install/download。

默认 `BYCLAW_BROWSER_VIEWER=none`：Chromium headless，不启动 X/VNC。`novnc` 模式遵循 OpenClaw：

- `DISPLAY=:99`
- `1365x768x24`
- x11vnc `127.0.0.1:5901`，shared/passwordless
- websockify/noVNC `0.0.0.0:8081`

desktop launcher 只启动 Xvfb/x11vnc/websockify，不启动 Chromium。broker 将同一个共享 Chromium 以 headed 模式连接 `:99`。noVNC 的定制 HTML 保留 Sandbox proxy path/token、`hideHeader`、重连、缩放、输入和可选 view-only 控件。无密码原始 VNC 不得发布，外部访问只允许经过带 token 的 Sandbox proxy。

PID 1 supervisor 负责 profile 准备、用户降权、socket/readiness、FD secret、信号转发、子进程退出码与 Linux subreaper 清理。DSH 永久以 `byclaw` 运行，broker/desktop 永久以 `browserd` 运行。

## 9. 安装与组合

包通过 `cordis.patch.yml` 注册 `byclaw-browser-use`。源码测试必须针对与启动相同的 DSH checkout 构建，随后把插件路径加入目标 `web` 或 `headless` profile。Docker 构建会发现、构建、pack 并注册所有 bundle，并在 dump config 中检查该 row。

Browser Use 与 AgentTeams、ByClaw Integration、Devflow 可同时加载。AgentTeams 决定任务与成员调度，Devflow 决定研发卡片和 gate，Browser Use 只负责每个实际执行 Agent 的浏览器 Context 与动作，不争夺业务编排控制权。

## 10. 验证结论与限制

已通过：

- package unit/integration/typecheck/build；
- 真实 Chromium DOM、表单、域名、提交、下载、并发 Context、清理与 30 秒 TTL E2E；
- Bash policy 单测和真实 DSH Agent 拒绝直接 Playwright；
- 最新 master DSH 源码 web/profile/真实模型工具调用 E2E；
- 两个并发 DSH session 共享一个 Chromium PID 且 Cookie/localStorage 隔离；
- Docker/entrypoint/supervisor/noVNC 静态与进程级校验。

验证过程中用户原始 DSH checkout 与最新-master 只读 worktree 的 HEAD/status 前后一致，没有修改任何 DSH 源码。使用的 `.env` 只 source 到启动进程，未打印或提交。

开发主机没有可用 Docker-compatible daemon，因此未在本机执行完整镜像 build、容器端口和 live VNC 检查。不同 UID 下载读取与 Linux nested subreaper 路径作为 Docker build gate 保留，必须在具备 daemon 的 Linux 构建机执行。
