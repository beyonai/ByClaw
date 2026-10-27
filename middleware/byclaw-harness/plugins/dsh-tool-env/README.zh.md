# @byclaw/dsh-tool-env

[English](README.md) | 中文

DSH 运行时（A）保留 Web 界面、Agent、模型、会话和配置；工具执行（文件、Bash 等进程、终端、PTC、沙箱策略）放到单独的工具沙箱（B）里。

**默认关闭。** 只有 `BYCLAW_DSH_TOOL_ENV` 为 `static`、`opensandbox` 或 `byclaw-be` 时才生效。未设置时 profile 仍用原来的本地 provider，行为不变。

## 工作方式

- **Provider 替换：** profile 补丁把基础行 `fs-sandbox`、`subprocess`、`sandbox`、`ptc-runtime` 换成 DSH 自带的 SSH provider。
- **`ctx.ssh` 就是本插件：** 一个稳定、可重连的连接租约。B 被暂停、删除或重建后，下一次操作会自动重连。
  - 不重放：B 消失瞬间正在执行的那一步会失败一次。
- **租约：** 第一次远程操作时创建 B，B 已暂停时则恢复它。
- **空闲：** 超过 `BYCLAW_TOOL_ENV_IDLE_MS`（默认 10 分钟）没有操作、也没有打开的流，就暂停 B。正在跑的命令和后台任务会占着流，所以不会被中途暂停。
- **消失：** B 已删除或过期时，下次自动重建。
  - `/by` 是与 A 共用的宿主机卷，暂停、重建都不丢用户文件。
- **身份：** A 在自己的私有 DSH 目录里生成客户端密钥和 B 的主机密钥，所以 A 能锁定 B 的主机密钥。`opensandbox` 模式随创建请求交给 B；`byclaw-be` 模式把 A 的这个目录只读挂进 B（`BYCLAW_TOOL_ENV_SEED_DIR`，默认 `/etc/byclaw-tool-env`）。
  - B 的 sshd 只接受这把钥匙登录 `byclaw` 用户。
- **密钥隔离：** 所有远程进程的环境变量都会去掉 `BYCLAW_TOOL_ENV_*`。A 的会话、凭据、profile 不会挂进 B。
- **启动环境：** B 上的每个进程（Bash、终端、LSP、PTC）都会在自身环境之下叠加用户的启动环境，与拆分前从运行时继承的一致。来源是配置项 `launchEnv`：共享 DSH 宿主用 BE 为该用户渲染的环境填充，每次 PUT 更新，`USER_CODE` 始终是该上下文的用户；调用方自己的值优先，B 自己的路径、解释器与加载器设置、显示和浏览器（`PATH`、`HOME`、`NODE_*`、`LD_*`、`XDG_*`、`DISPLAY`、`PLAYWRIGHT_BROWSERS_PATH`、`BYCLAW_BROWSER_*` 等）保持不变。
- **沙箱：** 拆分模式下默认 `DSH_PERMISSION_MODE=danger-full-access`。
  - B 本身就是隔离边界。
  - 宿主机禁止用户命名空间时，容器里用不了 bwrap/Landlock，`workspace-write` 会拒绝所有命令。

## B 什么时候启动

每一轮对话都会启动 B，纯模型回答也一样：模型运行前，一轮对话要读会话的指令文件（从项目根即最近的 `.git` 到会话目录各级的 `AGENTS.md`、`CLAUDE.md` 及 `.local` 变体）、会话 Skills 和铁律，它们都在用户目录里，只有 B 能给出当下的内容（平台也会往里写，比如上传）。所以每轮看到的都和用户自己的沙箱一致，不会是旧副本。上下文启动（资源投影、Skill 视图、媒体投影）不会启动 B：连接门面 `ctx.ssh` 提供 `connected` 和 `whenConnected(key, op)`，integration 插件把要写到 B 的内容和建目录交给它，等 B 连上后、其他操作之前再落下。B 没起时门面只回答不需要用户目录的请求：路径解析只做规范化；排队待建和本机已在 B 上建过的目录视为目录（里面有什么由 B 回答）；DSH 自己的家目录（`DSH_HOME`、`DSH_AGENTS_HOME`）视为空；已断开连接上的进程或流的清理视为已完成；`executable` 查找在本机解析（同一次镜像构建）。B 在 `BYCLAW_TOOL_ENV_IDLE_MS` 内没有操作才释放，所以用户活跃期间它一直在。
`byclaw-be` 后端启动失败后会退避（1 秒起，翻倍到 30 秒），并说明原因，不再每次操作都去调 BE。

## 三种后端

- `static`：连固定的 sshd，用于开发和测试。
- `opensandbox`：A 直接调 OpenSandbox 创建、暂停、恢复 B，OpenSandbox 的 key 在 A 手里。
- `byclaw-be`：A 以用户身份调 ByClaw BE 的 `POST /sandbox/launchByUserCode`，让 BE 按 `sandbox_service_spec` 里 `serviceKey`（默认 `byclaw-dsh-tools`）的规格创建或复用 B，再从返回的 `instanceEndpoints.ssh` 取 B 的 sshd 地址（规格里把 22 端口声明为 `tcp`）。每次启动请求都带 `autoRelease: 1`，新建工具沙箱开启自动空闲释放；复用已有沙箱时保留原策略。插件自身的空闲和销毁释放行为保持不变。A 只用 BE 注入给它的 `USER_CODE` 和 `BEYOND_TOKEN`，不再持有 OpenSandbox 的 key。返回地址连不上时，A 会 `removeSandbox` 一次再重新 launch。
  - B 只能经 HTTP 入口访问时（如 ACS 前面的 ALB，地址形如 `http://alb-…/kruise/<沙箱>/<端口>/…?token=`），SSH 走 WebSocket 隧道：B 设置 `BYCLAW_TOOL_ENV_WS_PORT` 后同时起 sshd 和 `ws-bridge.py`，规格里把该端口声明为 http 的 `ssh` 实例；A 把返回的 `http(s)://` 地址原样当桥地址，用 `ws-proxy.mjs` 作 ProxyCommand，host key 照样固定。`static` 后端用 `BYCLAW_TOOL_ENV_WS_URL` 指定桥地址。
  - A 挂不到 B 的卷时（共享 DSH 宿主在沙箱集群外），设 `BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS=1`：A 每次 launch 前把自己的公钥和 B 的主机密钥（base64）存成用户的个人参数 `BYCLAW_TOOL_ENV_AUTHORIZED_KEY`、`BYCLAW_TOOL_ENV_HOST_KEY`（已有且未变则跳过），B 的规格 env 用 `${envVars.BYCLAW_TOOL_ENV_AUTHORIZED_KEY}`、`${envVars.BYCLAW_TOOL_ENV_HOST_KEY}` 引用，不再需要密钥卷。
  - 共享宿主（`scripts/byclaw-multi-host.mjs`）设 `BYCLAW_DSH_TOOL_ENV=byclaw-be` 后，每个用户上下文用 BE PUT 时带来的 `BEYOND_TOKEN` 走这个后端。这个 token 是用户 JWT，会过期，而上下文常驻数天：宿主把之后每次 PUT 的 token 交给上下文（`ToolEnv.renewBeToken`，BE 每次 PUT 都新签一个）；BE 回 401 的启动记为 `launch rejected: … Beyond-Token expired`（不是 `launch failed`），窗口内不重试，下一次 PUT 带来不同 token 时立即解除退避。
  - 暂不做：空闲暂停/恢复（BE 没有 pause 接口），以及 A 释放时回收 B。两项都另行处理。
  - 已接受的现状：`launchByUserCode` 会把 `serviceKey` 记为用户首选规格；它按 body 里的 `userCode` 切换用户上下文。

A 和 B 必须用**同一次构建**的镜像，否则 helper 摘要校验会拒绝连接。B 镜像由 `middleware/byclaw-harness/Dockerfile.tools` 从 A 镜像构建（`--build-arg HARNESS_IMAGE=<A 镜像>`）：保留 A 的全部工具链（系统包、Python/Node CLI、内置 skills），只去掉 A 运行时专用的部分（DSH 自身安装、Playwright 浏览器、构建缓存），压成一层；A 的镜像环境变量记录在 `/etc/byclaw-tool-env.session-env`，B 的 sshd 把它交给每个会话。A 镜像本身也能当 B 用（`tools` 模式）。

配置项、限制说明见 [README.md](README.md)。
