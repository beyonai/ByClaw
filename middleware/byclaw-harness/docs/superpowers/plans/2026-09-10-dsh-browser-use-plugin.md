# DSH Browser Use 插件实施计划（As-Built）

日期：2026-09-10

分支：`2026.9.8`

状态：实现与源码 E2E 已完成；等待最终总体验证和推送

## 约束

1. 不修改 DSH 源码；原始 checkout 和最新 master 验证 worktree 都按只读处理。
2. 当前 DSH Agent 是唯一 planner；插件不调用模型，也不持有模型配置或凭据。
3. 模型只调用一个有状态工具 `browser`；Playwright、browserd、租约与 capability 私有。
4. 一个 Sandbox 最多一个 Chromium；每个 Agent open turn 独立 Browser Context。
5. 正常下载不设置大小、数量或完成时间上限。
6. Docker 观察能力复用同一 Chromium，且新增桌面包后必须重建 `Dockerfile.base`。

## 已执行任务

### 1. 包骨架与 profile 注册

- 建立 `plugins/dsh-browser-use` 的 package、TypeScript、Vitest、build/link 脚本。
- `cordis.patch.yml` 注册 `byclaw-browser-use`，默认 `maxContexts=4`、`maxQueue=32`、`leaseTimeoutMs=180000`。
- Docker 的插件发现/pack/profile 机制自动包含该 bundle，并检查 dump config。

验收：composition、typecheck、build 通过；profile 中 row 唯一且启用。

### 2. 私有租约调度

- owner 使用 Agent/session/turn/open-turn sequence 服务端推导。
- capability 使用 32-byte randomness，仅存在于插件与 RPC。
- 同 owner 串行，不同 owner 在 `maxContexts` 内并发；FIFO 队列由 `maxQueue` 限制。
- abort、timeout、turn/session/agent 生命周期与 dispose 均释放租约。

验收：FIFO、队满、取消、超时、owner/capability mismatch 和 cleanup 竞态测试通过。

### 3. 认证 Broker 协议

- 使用 mode-controlled Unix socket 和 1 MiB 有界 newline JSON frame。
- 每次请求携带 request ID、进程 secret；lease 请求额外携带私有 capability。
- 客户端支持 abort、disconnect fail-closed、响应关联和 dispose。
- broker 对连接请求/字节数做背压并在连接结束时关闭其全部 lease。

验收：协议畸形、超大帧、未授权、断连、overload、shutdown 测试通过。

### 4. 单 Chromium 与独立 Context

- `browserd` 独占 `playwright-core`，lazy launch 一个 Chromium。
- 每个 lease 创建独立 Context/page/domain proxy，不使用共享默认 Context。
- 最后 Context 关闭后按 `BYCLAW_BROWSER_IDLE_MS=30000` 保温，新租约取消 idle shutdown。
- Chromium 异常断开时清空 lease，下一次 open 重启。

验收：真实 Chromium 证明相同 PID、独立 Cookie/localStorage/page/download 和 30 秒关闭语义。

### 5. DSH 原生有状态工具

- 当前 DSH Agent 直接执行 `open/inspect/navigate/click/fill/select/press/wait/screenshot/close`。
- 工具 schema object-rooted 且每个 operation closed；服务端再次严格校验参数。
- DOM 文本/元素、URL、按键、wait 和 screenshot 响应有界。
- 未 open、重复 open、失效索引、disabled、popup、domain 和 submit 策略返回稳定错误码。
- 插件不调用任何模型接口，也不存在二次规划循环。

验收：工具只注册为 `browser`，生产源不存在模型/planner 依赖，最新 DSH provider 接受函数 schema。

### 6. 域名、提交和下载

- HTTP(S) allowlist 在主导航、重定向、子资源、HTTPS CONNECT 和下载连接上执行。
- `allowSubmit=false` 默认阻止 submit click、Enter 和提交型 Space。
- 下载无大小、数量、MIME、文件名或完成时间上限；action 等待关联下载完成。
- Docker delivery root 采用 setgid/shared-group 权限，文件仅在 lease 生命周期内保留。
- 关闭/cancel 会清理文件、临时目录、下载任务和上游连接。

验收：大文件、同 URL、并发、多下载、延迟、stalled/cancel 和跨域 HTTPS 测试通过。

### 7. Bash 直接访问收敛

- `@byclaw/dsh-bash-provider` 在 executor 边界拒绝已知 Playwright/browser-use/Chromium/CDP/remote-debugging 命令及 wrapper/loader 变体。
- 普通 build/test、文档读取和仅含浏览器测试文件名的命令保持可用。
- 文档明确同容器 parser 不是硬安全边界，严格部署使用 sidecar。

验收：115 个 provider 测试通过；真实 DSH Agent 调用 `playwright test` 被拒绝，`pnpm --version` 成功。

### 8. Docker supervisor 与 noVNC

- `Dockerfile.base` 新增 Xvfb/xauth/x11vnc/noVNC/websockify，保留单份固定 Playwright Chromium。
- 业务镜像创建 `browserd` 和 `byclaw-browser` 组，复用已有浏览器，不执行第二次 install/download。
- PID 1 supervisor 先准备 profile，再分用户启动 desktop、browserd 和 DSH；secret 通过两个独立 FD 交付。
- 默认 viewer `none`；`novnc` 使用 `:99`、`1365x768x24`、loopback 5901 和 web 8081。
- 同步 OpenClaw 定制 HTML、Sandbox proxy token/path、`hideHeader` 和操作控件。
- Linux subreaper 回收普通与嵌套逃逸子孙进程。

验收：entrypoint、FD、supervisor、desktop、noVNC、Docker layout 静态测试通过；基础镜像必须重建。

### 9. 最新 DSH 源码 E2E

- Fetch 最新 master 到独立 clean detached worktree，不改用户 dirty checkout。
- 使用 `/Users/chenxiaofeng/code/open/deepseek-harness/.env` 仅启动进程，不输出内容。
- 组合 Browser、Bash、ByClaw Integration、AgentTeams、Devflow profile。
- 修复插件侧最新 DSH AgentTeams setup 参数转发与 browser schema root 兼容。
- 启动真实 source web，确认 Worker 上线；资源同步仅受外部 Beyond Token 缺失限制。
- 真实模型工具调用完成表单流程和两个并发 Agent 隔离流程。

验收证据：两个 session 同期显示一个 Chromium PID、两个 Context；各自 Cookie/localStorage 只有自身值；close 后 Context 为 0，idle window 后 browserRunning 为 false。

### 10. 文档与发布准备

- 插件中英文 README：工具契约、示例、结构化结果/错误、allowlist/submit、下载、配置、源码启动、Docker/VNC、安全边界、排障和验证状态。
- 根中英文 README：插件索引、架构、copy/build/profile 注册、环境变量、验证和发布约束。
- 设计说明与实施计划以最终实现为准，并已清除中间方案中的过时工具、规划、下载、VNC 与镜像构建描述。

## 发布前命令

```sh
pnpm --dir plugins/dsh-browser-use verify
pnpm --dir plugins/dsh-bash-provider verify
python3 scripts/browser-supervisor-verify.py
bash scripts/browser-desktop-verify.sh
node browser/novnc-index.test.mjs
bash scripts/docker-entrypoint-verify.sh
bash scripts/docker-browser-layout-verify.sh
cmp Dockerfile Dockerfile.extensions
git diff --check
```

在带 Docker daemon 的 Linux CI/构建机额外执行：

```sh
docker build -f Dockerfile.base --build-arg DSH_REF=master \
  -t 10.10.168.203:9080/byclaw/dsh-base:2026.9.8 .
docker build -f Dockerfile \
  --build-arg BASE_IMAGE=10.10.168.203:9080/byclaw/dsh-base:2026.9.8 \
  -t byclaw/dsh:2026.9.8 .
```

镜像验证必须覆盖：profile 存在 `byclaw-browser-use`；DSH 以 `byclaw`、broker/desktop 以 `browserd` 运行；socket/download 权限正确；默认无 X/VNC；novnc 模式只有一个共享 Chromium；5901 仅 loopback；8081 通过 Sandbox proxy 可用；无第二份浏览器下载；不同 UID 文件读取和 nested subreaper gate 通过。

## 已知验证限制

开发主机没有可用 Docker-compatible daemon，故本地没有声称完整镜像 build、容器端口或 live VNC 通过。所有可在主机执行的 package、真实 Chromium、最新 DSH source、静态 Docker/noVNC/supervisor 验证已通过。Linux-only gate 由 Dockerfile 在正式构建时强制执行。
