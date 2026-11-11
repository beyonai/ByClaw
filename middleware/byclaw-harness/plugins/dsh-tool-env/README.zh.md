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
- **沙箱：** 拆分模式下默认 `DSH_PERMISSION_MODE=danger-full-access`。
  - B 本身就是隔离边界。
  - 宿主机禁止用户命名空间时，容器里用不了 bwrap/Landlock，`workspace-write` 会拒绝所有命令。

## B 什么时候启动

只有工具调用才会启动 B。上下文启动（资源投影、Skill 视图、媒体投影）和一轮对话开始（会话目录）都不会：连接门面 `ctx.ssh` 提供 `connected` 和 `whenConnected(key, op)`，integration 插件把要写到 B 的内容和建目录交给它，等 B 为某次工具调用连上后、工具执行前再落下。B 没起时读用户目录，返回本机上次读到或写过的内容，没有就是 `ENOENT`，所以纯模型回答永远不等沙箱。模型运行前一轮对话还会解析会话目录、探测文件（git 根、会话 Skills）；B 没起时由门面自己回答：路径解析只做规范化，排队待建的目录视为空目录且里面什么都没有，`.git` 和指令文件探测（会话目录各级祖先下的 `AGENTS.md`、`CLAUDE.md` 及 `.local` 变体）视为不存在，DSH 自己的家目录（`DSH_HOME`、`DSH_AGENTS_HOME`）视为空，Skill 根目录列为空，`executable` 查找在本机解析（同一次镜像构建）。工具做的事（真实路径的 stat、列目录、读写、起进程）仍然去 B 并把它拉起来。代价是：会话第一次工具调用之前，提示词里看不到会话内的 Skills 和用户目录里的指令文件。`byclaw-be` 后端启动失败后会退避（1 秒起，翻倍到 30 秒），并说明原因，不再每次操作都去调 BE。

## 三种后端

- `static`：连固定的 sshd，用于开发和测试。
- `opensandbox`：A 直接调 OpenSandbox 创建、暂停、恢复 B，OpenSandbox 的 key 在 A 手里。
- `byclaw-be`：A 以用户身份调 ByClaw BE 的 `POST /sandbox/launchByUserCode`，让 BE 按 `sandbox_service_spec` 里 `serviceKey`（默认 `byclaw-dsh-tools`）的规格创建或复用 B，再从返回的 `instanceEndpoints.ssh` 取 B 的 sshd 地址（规格里把 22 端口声明为 `tcp`）。每次启动请求都带 `autoRelease: 0`。空闲、任务结束、上下文关闭和模板切换只归还执行租约并断开 SSH，保留健康物理 B。仅用户明确要求时调用 `sandbox_release`，最后引用精确销毁；准入/manifest 失败仍按精确 ID 清理并校验远端消失。BE/Platform 必须同时让复用的旧工具实例转为手动策略，并让过期续约/回收遵守该策略；单改启动标记不足以保证旧实例生效。A 只用 BE 注入给它的 `USER_CODE` 和 `BEYOND_TOKEN`，不再持有 OpenSandbox 的 key。返回地址连不上时，A 会 `removeSandbox` 一次再重新 launch。
  - B 只能经 HTTP 入口访问时（如 ACS 前面的 ALB，地址形如 `http://alb-…/kruise/<沙箱>/<端口>/…?token=`），SSH 走 WebSocket 隧道：B 设置 `BYCLAW_TOOL_ENV_WS_PORT` 后同时起 sshd 和 `ws-bridge.py`，规格里把该端口声明为 http 的 `ssh` 实例；A 把返回的 `http(s)://` 地址原样当桥地址，用 `ws-proxy.mjs` 作 ProxyCommand，host key 照样固定。`static` 后端用 `BYCLAW_TOOL_ENV_WS_URL` 指定桥地址。
  - A 挂不到 B 的卷时（共享 DSH 宿主在沙箱集群外），设 `BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS=1`：A 每次 launch 前把自己的公钥和 B 的主机密钥（base64）存成用户的个人参数 `BYCLAW_TOOL_ENV_AUTHORIZED_KEY`、`BYCLAW_TOOL_ENV_HOST_KEY`（已有且未变则跳过），B 的规格 env 用 `${envVars.BYCLAW_TOOL_ENV_AUTHORIZED_KEY}`、`${envVars.BYCLAW_TOOL_ENV_HOST_KEY}` 引用，不再需要密钥卷。
  - 共享宿主（`scripts/byclaw-multi-host.mjs`）设 `BYCLAW_DSH_TOOL_ENV=byclaw-be` 后，每个用户上下文用 BE PUT 时带来的 `BEYOND_TOKEN` 走这个后端。
  - 空闲断连：超过 `BYCLAW_TOOL_ENV_IDLE_MS` 只关闭 SSH 客户端；任务结束自动归还租约，不再要求模型调用销毁工具。用户独立的 `stateDir/catalog/<templateKey>` 保存 SSH 密钥，新 handle 复用同一对；必须持久保存该目录，不能跨用户共用。状态目录丢失/迁移后须安全重建，禁止跳过 host-key 校验。
  - 已接受的现状：`launchByUserCode` 会把 `serviceKey` 记为用户首选规格；它按 body 里的 `userCode` 切换用户上下文。

A 和 B 必须用**同一次构建**的镜像，否则 helper 摘要校验会拒绝连接。B 镜像由 `middleware/byclaw-harness/Dockerfile.tools` 从 A 镜像构建（`--build-arg HARNESS_IMAGE=<A 镜像>`）：保留 A 的全部工具链（系统包、Python/Node CLI、内置 skills），只去掉 A 运行时专用的部分（DSH 自身安装、Playwright 浏览器、构建缓存），压成一层；A 的镜像环境变量记录在 `/etc/byclaw-tool-env.session-env`，B 的 sshd 把它交给每个会话。A 镜像本身也能当 B 用（`tools` 模式）。

配置项、限制说明见 [README.md](README.md)。

### 工具沙箱 B 的环境转发

工具进程默认显式转发 B 的 SSH helper 自身全部环境变量，以保留规格 `env` 中的
`REDIS_PASSWORD`、业务 API Token 等变量，避免 DSH 对隐式继承的敏感变量清理。
这不是转发 Harness A 的环境：A 侧 `REDIS_*` 和其他宿主凭据过滤保持不变。

通过 **B 的规格 `env`** 配置 `BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT`：

- 不配置或设置为 `all`：默认转发全部 B 环境。
- 设置为 JSON 字符串 `{"allow":["REDIS_PASSWORD","BUSINESS_API_TOKEN"]}`：
  仅显式转发名单中的 B 环境变量；`{"allow":[]}` 关闭 B 环境的显式补入。
- 非法 JSON、非法变量名、额外字段或错误类型会中止启动；错误不输出配置值。

顺序为 **B 环境 → 请求 env 覆盖 → 内部启动变量排除**。请求可以提供名单以外的
业务变量；空字符串保留，`null` 沿用上游 unset 标记，在本层组装时不回填 B 的同名值。经过 A 的请求仍先
接受原有宿主凭据过滤，因此从 A 发送的 `REDIS_PASSWORD` 不会覆盖 B 的密码。
白名单约束的是新增的显式转发层，与 `dsh-bash-provider` 相同；它不清空 DSH/系统
原本继承的普通环境，不是进程环境隔离或权限控制。

无论 all、白名单或请求覆盖，均不显式传递 `BYCLAW_TOOL_ENV*`、
`BYCLAW_DSH_TOOL_ENV*`、`BYCLAW_BROWSER_SECRET*`、`BYCLAW_BROWSER_LISTEN_FD`、
`BYCLAW_MICROVM_PAYLOAD`、`BYCLAW_COMMAND_PAYLOAD`。这些排除覆盖 SSH bootstrap
密钥、broker secret/文件描述符和内部启动载荷；白名单不能放开这些变量。
转发策略和启用标记由 B 的 sshd 启动配置生成，单次工具请求不能修改策略。

`prepare-tool-helper-env.mjs` 在普通进程与终端共用的 helper 环境组装位置应用补丁；
Full、extensions 和 slim Harness 镜像在 profile 安装后同步处理两份 helper。工具镜像
须从匹配的新 Harness 镜像派生，继续使用原 helper 摘要校验。旧镜像不会自动获得修复。
本地回归：`node --test middleware/byclaw-harness/scripts/tool-helper-env.test.mjs`。
测试覆盖环境组装、真实 Node 子进程和 sshd 配置生成；不代替真实镜像/SSH 验证。
