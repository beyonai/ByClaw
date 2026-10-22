# DSH Browser Use

[English](README.md) | 中文

`@byclaw/dsh-browser-use` 为当前 DSH Agent 提供唯一的、有状态的 `browser` 工具。当前 Agent 是唯一规划者；插件不会再调用模型，也不会把 Playwright、Chromium、CDP、进程句柄、租约或 capability 暴露给模型。

一个 Sandbox 最多运行一个私有 `browserd` 和一个 Chromium。每个 DSH session 最多持有一个租约页面，并由一个 Agent 独占；同 session 的其他 Agent 不能再打开或操作竞争窗口。Docker 默认使用 `${DSH_HOME}/browser/user-data` 启动持久化 Chromium，因此不同 session 共享 Cookie、localStorage 与扩展状态，但页面、访问策略、下载和元素索引仍按租约隔离。`browserd`、Chromium、byCLI daemon 与 DSH 均以运行用户 `byclaw` 启动。

## 自然语言与工具操作

用户可以直接说：“打开版本发布页面，查看最新版本，不要提交任何内容。”DSH Agent 会把任务转换成 `browser` 调用，例如：

```json
{"operation":"open","startUrl":"https://example.test/form","allowedDomains":["example.test"],"allowSubmit":true}
{"operation":"inspect"}
{"operation":"fill","element":3,"value":"Ada"}
{"operation":"click","element":7}
{"operation":"inspect"}
{"operation":"close"}
```

数字元素索引来自最近一次 `open`/`inspect`，页面变化后失效。模型不会提供租约 ID 或 capability。

需要动作后的页面状态时，优先用只有一个动作的 `act`，它会在一次工具调用内返回动作结果和最新观察，省去单独调用 `inspect`。动态页面每步根据新观察选择下一个目标，例如 `{"operation":"act","actions":[{"kind":"fill","element":3,"value":"Ada","observationId":"最近一次观察的版本"}]}`。

Playwright 驱动使用原子 DOM 快照：一次浏览器内执行同步读取有界正文、控件、阻挡层和状态指纹。稳定节点身份由私有 JSHandle 中的 WeakMap 管理，不写入页面全局变量或 DOM 属性；仅执行动作时获取目标 ElementHandle。重排保留节点索引，节点替换和导航不会复用旧索引。开放 Shadow DOM 的控件仍可发现；旧自定义驱动继续兼容原有观察接口。该私有引用并不是独立 JavaScript 安全沙箱。

| 操作 | 字段 | 行为 |
| --- | --- | --- |
| `open` | `startUrl?`、`allowedDomains?`、`allowSubmit?` | 为当前 Agent session 申请 Context，短暂等待 SPA 就绪并返回带版本的 DOM 观察。 |
| `status` | 无 | 返回会话是否打开、上次 URL/标题/观测版本、当前策略、空闲剩余时间或失效原因。 |
| `focus` | 无 | 兼容操作；确认调用方 session 的独立桌面仍可用。noVNC 不再依赖该操作切换窗口。 |
| `inspect` | `detail?`：`compact` / `full` | 默认返回视口元素/正文；`full` 展开有界诊断信息，包括隐藏和屏外元素。 |
| `scroll` | `deltaY`、`deltaX?`、`element?`、`observationId?` | 滚动文档或已观察元素最近的滚动容器，返回实测位移；每轴须为 ±10,000 内的有限 CSS 像素值。 |
| `navigate` | `url` | 在白名单内跳转。 |
| `click` | `element` | 点击索引元素；提交控件要求 `allowSubmit: true`。 |
| `fill` | `element`、`value` | 填写索引控件。 |
| `select` | `element`、`value` | 选择索引 select 的值。 |
| `press` | `key` | 发送安全单键；拒绝组合键，Enter 和提交型 Space 受 `allowSubmit` 控制。 |
| `wait` | `milliseconds` | 等待 0–10,000 毫秒。 |
| `waitFor` | `selector/role/text/url/networkIdle` 五选一、`timeout?` | 声明式等待条件。 |
| `act` | `actions` | 顺序执行最多 32 个经过同等策略校验的动作，返回逐步结果与最终观察；每项使用 `kind`（如 `{"kind":"click","element":7}`），不能写 `operation` 或 `type`。 |
| `screenshot` | `type?`、`fullPage?`、`element?`、`clip?`、`quality?` | 将 PNG/JPEG 落盘，返回真实像素尺寸、大小、SHA-256 和绝对路径。 |
| `close` | 无 | 立即关闭 Context 和租约；未打开时也安全。 |

`allowedDomains` 默认取 `startUrl` hostname；DNS 域名同时允许子域名，IP 只精确匹配。两者都省略时页面停在 `about:blank`；调用 `navigate` 会返回 `browser-navigation-denied`，并明确提示先关闭再带 `startUrl` 或 `allowedDomains` 重开。只允许 HTTP(S)，拒绝 URL 内嵌凭据；主动跳转、弹窗和代理流量都会校验白名单。页面被动重定向到白名单外时返回可恢复策略错误并保留会话，调用方仍可跳回允许域名。`allowSubmit` 默认 `false`，提交按钮、Enter 和提交型 Space 会返回 `browser-submit-denied`；只有用户明确要求产生外部副作用时才开启。

观察结果增加 `ready`、`elementCount`、`observationId` 和 `blockingLayers`；元素暴露 `visible`、`inViewport`、`covered`，表单元素再按需暴露 checked/selected/readonly/required/multiple/accept/expanded 状态。观察版本只对 URL、标题、交互结构/状态、可见性和阻挡层做指纹，不再因正文自由变化而永久失效。动作结果为 `action: { dispatched, changed, textDrift, url?, downloads? }`，其中 `textDrift` 单独提示 inspect 后正文是否变化。

元素、查询、输入和页面被动重定向错误可恢复并保留会话；致命策略、传输和运行时错误才关闭会话，`status` 会保留关闭原因。参数校验会指出具体字段或批量动作序号；Chromium 能识别点击拦截元素时，错误详情也会包含该元素。

## 精简观察与调用模板

### 精简观察与滚动

`open`、`act`、默认 `inspect` 最多返回 200 个视口元素及 6,000 字符视口正文，先过滤再截断，避免隐藏项占满名额。计算祖先透明度、overflow 裁剪及长段落的文本范围；这是几何可见性判断，不是 OCR，也不保证正文没有被遮罩覆盖。`omittedElements` 表示隐藏、屏外及超出上限的候选总数。可滚动容器即使没有按钮也会获得索引，并标记 `scrollable: true`。

`{"operation":"inspect","detail":"full"}` 可临时展开最多 200 个未过滤候选和 16,000 字符正文；下一次默认观察仍为精简模式。没有原子快照能力的自定义驱动保留旧接口回退行为。

滚动使用受限的原生 `Element.scrollBy`（instant），不执行模型提供的脚本，也不模拟 wheel 事件。指定的 `element` 必须已经观察且当前位于视口内，省略则滚动文档。`action.scroll`（批量为 `steps[i].action.scroll`）返回 CSS 像素单位的 `beforeX/beforeY/afterX/afterY/deltaX/deltaY` 即时实测值。滚动位置纳入观察版本检查。错误索引或不可见目标返回可恢复错误，不会悄悄改用其他索引目标。仅响应 wheel 的自定义控件、canvas 和 iframe 内部不在本次 DOM 滚动能力范围内。

长图流程：截图 → 单步滚动 `act` → 读取实际位移与新观察 → 单独截图。实际位移为 0 表示到达边界或目标不可滚动。吸附滚动、吸顶内容、延迟渲染和设备缩放仍可能需要图像对齐，不能把输入 delta 当成拼图保证。

### 少往返，不增加第二层 planner

- 每批最多 32 个动作，仅使用已观察到的目标。用 `waitFor` 串联，五种条件只能选一种，`timeout` 为 1–10,000 毫秒，不是报告示例中的 15,000。
- `act` 已返回新观察，不要立即再 `inspect`。新弹窗或跳转后的目标须依据新观察选择，不能猜索引。
- `observationId` 是逐动作保护，不是批次令牌。状态变化后不要继续复用旧版本；需要保护的动态步骤拆成多个 `act`。批次中途失败不能盲目整批重放，前面可能已经产生副作用。
- 等待模板：`{"operation":"act","actions":[{"kind":"waitFor","text":"Ready","timeout":10000}]}`。滚动模板：`{"operation":"act","actions":[{"kind":"scroll","element":7,"deltaY":560}]}`，其中 7 必须替换为新观察中的容器索引。截图不属于批内动作。
- 登录/发送消息：先观察表单并解析当前字段/按钮索引，填写已知字段，再点击用户授权的提交控件并等待成功条件。在动态 DOM 边界处分批，不固化凭据或旧索引进行宏回放。

不引入 Jev 或内层模型，域名、提交门禁、所有权及租约校验不变。[性能记录](docs/snapshot-performance.md)仅代表合成页面的观察测量，不能直接推导报告中的整任务耗时或 token 降幅。

## 下载、隔离与生命周期

普通下载没有插件级文件大小、数量、MIME、文件名或完成时间限制。完成后返回 `{ name, path, size }`，文件位于 `BYCLAW_BROWSER_DOWNLOAD_ROOT`。浏览器与 DSH 使用同一运行用户，私有 `0600` 产物可直接读取，不再需要跨用户共享组。

下载是临时交付物：页面、租约、broker 连接或进程关闭时会删除。必须在 `close` 前读取/复制；取消还会终止进行中的下载和上游连接。

- claim 由服务端按 session ID 建立；首个 Agent 独占该 session 的唯一 Context，其他 Agent 得到 `browser-session-owned-by-another-agent`；turn 边界不再销毁 Context。
- 同 session 在唯一 lane 内 FIFO 串行；同一 broker socket 上的不同 session 使用不同 lane，在 `maxContexts` 内并发，超出进入有界 FIFO 队列。
- 调用取消会发送认证控制帧；`close`、取消、断连和 shutdown 绕过卡住的业务 lane，中止正在执行的操作，并且只关闭 capability 授权的 Context。
- `close`、Agent/session 销毁、活跃操作取消、租约超时、断连和插件关闭都会清理 Context。
- Docker 默认 `viewer=shared-novnc`：所有 session 与 byCLI 共用一个有头持久 Chromium、全局 profile 和常驻 VNC 桌面，各租约仍只拥有自己的页面与策略；`viewer=none` 使用同一共享 profile 但不启动 VNC；旧 `viewer=novnc` 仍为每租约独立临时 Chromium/VNC。
- `shared-novnc` 下租约关闭或空闲 15 分钟只回收该租约页面；Chromium、byCLI 扩展桥接和 VNC 随 browserd 进程常驻。`none` 才使用 30 秒浏览器保温；旧 `novnc` 随租约立即回收独立桌面。

## 配置

```yaml
- id: byclaw-browser-use
  name: '@byclaw/dsh-browser-use'
  config:
    maxContexts: 4
    maxQueue: 32
    idleBrowserMs: 30000
    leaseTimeoutMs: 900000
```

| Profile 字段 | 默认值 | 含义 |
| --- | ---: | --- |
| `maxContexts` | `4` | 并发 session 租约上限；`novnc` 模式下也是独立 Chromium/X/VNC 桌面数量上限。 |
| `maxQueue` | `32` | 等待 session 上限。 |
| `leaseTimeoutMs` | `900000` | Agent-session 租约空闲超时。活跃操作暂停过期，操作结束后重新获得完整空闲窗口。 |
| `idleBrowserMs` | `30000` | profile 兼容声明；分进程 broker 的实际空闲 TTL 由 `BYCLAW_BROWSER_IDLE_MS` 控制。 |

| 环境变量 | Docker 默认值 | 含义 |
| --- | --- | --- |
| `BYCLAW_BROWSER_SOCKET` | `/run/byclaw-browser/browserd.sock` | 私有 Unix socket。 |
| `BYCLAW_BROWSER_DOWNLOAD_ROOT` | `/run/byclaw-browser/downloads` | 临时下载交付目录。 |
| `BYCLAW_BROWSER_SCREENSHOT_ROOT` | `/run/byclaw-browser/screenshots` | 截图交付目录；会话关闭后仍可读取，容器结束时清理。 |
| `BYCLAW_BROWSER_IDLE_MS` | `30000` | `none` 模式的 Chromium 空闲保温时间；进程级 `shared-novnc` 忽略此值。 |
| `BYCLI_BROWSER_IDLE_TIMEOUT` | `900` | byCLI raw browser 租约空闲超时（秒）；每次命令都会续期。 |
| `BYCLAW_BROWSER_EXECUTABLE_PATH` | `/usr/local/bin/byclaw-playwright-chromium` | 基础镜像已有 Chromium。 |
| `BYCLAW_BROWSER_USER_DATA_DIR` | `${DSH_HOME}/browser/user-data` | `shared-novnc` 与 `none` 的全局持久化 profile；所有 session 和 byCLI 共享登录态。 |
| `BYCLAW_BROWSER_EXTENSIONS` | byCLI extension 目录 | 以系统路径分隔符分隔的 unpacked extension 目录；无效目录会告警并跳过。 |
| `BYCLAW_BYCLI_ENABLED` | `true` | 首次使用时由 browserd 启动并监控 byCLI daemon/extension 桥接。 |
| `BYCLAW_BROWSER_VIEWER` | `shared-novnc` | 单一持久浏览器与稳定 VNC；`none` 关闭 VNC；旧 `novnc` 为每会话独立桌面。 |
| `BYCLAW_BROWSER_XVFB_SCREEN` | `1365x768x24` | Xvfb 尺寸/色深。 |
| `BYCLAW_BROWSER_SESSION_RUNTIME_ROOT` | `/run/byclaw-browser/sessions` | 私有桌面运行根目录；`shared-novnc` 只创建一个进程级目录。 |
| `BYCLAW_BROWSER_DISPLAY_RANGE` | `100-199` | 独立 X display 分配范围。 |
| `BYCLAW_BROWSER_RFB_PORT_RANGE` | `5901-6000` | 每会话原始 VNC 内部端口范围，只绑定 loopback。 |
| `BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE` | `6101-6200` | 每会话内部 websockify 端口范围，只绑定 loopback。 |
| `BYCLAW_BROWSER_VNC_WEB_PORT` | `8081` | 按 `sessionId` 路由的统一 noVNC 网关。 |
| `BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS` | `0.0.0.0` | noVNC 网关地址；默认免鉴权，应限制在可信网络或外层代理后。 |

root Supervisor 在准备 Profile 后立即以 `byclaw` 用户启动 DSH，不等待浏览器或 byCLI。browserd 只提前监听私有 Broker、激活 Socket 和 noVNC HTTP 入口；首次调用 `browser` 工具或打开 noVNC 时才创建 Xvfb、x11vnc、websockify 和 Chromium。并发首次请求共享一次启动，失败返回调用方，后续请求可以重试。首次启动后仍保留常驻共享浏览器及登录状态。

byCLI 业务命令和 `bridge-bootstrap.mjs` 通过私有激活 Socket 请求浏览器就绪，再启动 daemon 并等待扩展连接。`doctor`、`daemon status`、帮助和版本查询不会激活浏览器。只有首次使用后才启用 Bridge 健康检查，断线后独立恢复；启动或恢复失败不终止 DSH。Supervisor 自动提供 `BYCLAW_BROWSER_ACTIVATION_SOCKET` 和 `BYCLAW_BROWSER_READY_TIMEOUT_MS`，部署时无需新增配置。激活 Socket 权限为 0600，只接受固定的 byCLI 激活请求，不接收任意命令或浏览器凭证。

Supervisor 在启动 browserd 前取得持久 Chromium profile 的排他咨询锁；发生冲突时仅浏览器不可用，DSH 继续运行，不清理活动实例的 singleton 文件。browserd 退出后独立退避重启，Chromium 断开后仍由 BrowserRuntime 重建。随机 secret 通过独立继承 FD 交付，Supervisor 保留内存副本用于 browserd 重启，退出时清除。DSH 就绪不再代表浏览器和 Bridge 已就绪，浏览器首次调用需要计入启动时间。

`shared-novnc` 使用稳定入口 `http://HOST:8081/?hideHeader=true&sessionId=shared`，省略 `sessionId` 会重定向到该地址；单个租约关闭不会拆除路由或桌面。Browser 工具通过 broker 操作该 Chromium 的持久 Context，byCLI 通过加载在同一 Chromium 中的扩展操作页面，所以两类工具的页面跳转、点击和输入都会显示在这个 VNC 桌面中；byCLI 不应另起浏览器或使用独立 profile。旧 `novnc` 仍按编码后的 DSH session ID 选择独立桌面。外层 Sandbox 代理需要 token 时可继续透传。browserd 默认不验证 token；任何能访问 8081 的客户端都能控制共享桌面，因此生产环境必须限制网络入口。

有界面 VNC Context 使用 Chromium 原生 viewport。browserd 从 `BYCLAW_BROWSER_XVFB_SCREEN`（默认 `1365x768x24`）读取与 Xvfb 相同的宽高，请求浏览器外层窗口位于 `(0, 0)` 并采用桌面尺寸，再通过 CDP 确认回读窗口为普通状态、宽高为正、整个外框位于桌面内。无窗口管理器时 Chromium 可能回读略小的尺寸；完整可见即为有效，无需精确铺满桌面。启动窗口以及 Browser 工具、byCLI 扩展后续打开的页面都会检查，持久浏览器复用租约后仍然有效。每个新页面都会重新检查所属窗口，修正外部操作造成的越界裁剪；已完整可见时不再设置尺寸，同一窗口的并发页面共用正在执行的校正任务。最大化、最小化或全屏窗口会先恢复普通状态再设置外层尺寸。目标未就绪时只做有限次数重试，Context 关闭时移除监听并取消等待中的重试。启动或 Browser 工具窗口尺寸校验失败会拒绝操作，后续扩展窗口失败会在 browserd 日志中记录 `browser-window-normalization-failed` 及长度受限的错误详情。headless 与非 VNC Context 保持原有 viewport 行为。

## 从 DSH 源码安装

插件不修改任何 DSH 源码。用实际启动的同一 DSH checkout 构建并注册：

```sh
cd /path/to/byclaw-dsh/plugins/dsh-browser-use
DSH_ROOT=/path/to/deepseek-harness pnpm install --frozen-lockfile
DSH_ROOT=/path/to/deepseek-harness pnpm verify

cd /path/to/deepseek-harness
test_dsh_home="$(mktemp -d)"
DSH_HOME="$test_dsh_home" pnpm dsh plugin --profile web add \
  /path/to/byclaw-dsh/plugins/dsh-browser-use
DSH_HOME="$test_dsh_home" pnpm dsh --profile web --dump-config
```

输出必须包含 `id: byclaw-browser-use`。源码启动还需要单独启动 `lib/browserd.js`，并通过两个继承 FD 向 broker 与 DSH 传入相同且不含换行的 secret；生产镜像由 `byclaw-dsh-entrypoint` 安全完成。测试时用隔离的 `DSH_HOME`，从 DSH 源码目录加载其 `.env`，不要打印 `.env`/secret，结束后清理 broker、socket 和测试目录。英文 README 提供完整手动命令。

## Docker 与 noVNC

`Dockerfile.base` 新增 Xvfb、xauth、x11vnc、noVNC 和 websockify，所以构建业务镜像前**必须重新构建基础镜像**。只重建 `Dockerfile` 并继续使用旧基础镜像会失败。

```sh
docker build -f Dockerfile.base --build-arg DSH_REF=master \
  -t 10.10.168.203:9080/byclaw/dsh-base:2026.9.8 .
docker build -f Dockerfile \
  --build-arg BASE_IMAGE=10.10.168.203:9080/byclaw/dsh-base:2026.9.8 \
  -t byclaw/dsh:2026.9.8 .
```

业务镜像复用基础镜像固定版本的 Playwright Chromium，并内置 byCLI CLI 与 extension，不下载第二份浏览器。Docker 默认 `BYCLAW_BROWSER_VIEWER=shared-novnc`，首次使用浏览器时创建一套 X/VNC 和一个持久 Chromium；`none` 使用同一全局 profile 但不启动 VNC；旧 `novnc` 继续为每个活跃 session 启动独立临时桌面。

Dockerfile 的 `EXPOSE 8081` 只声明端口，不会自动发布到宿主机。运行容器时需使用 `-p 8081:8081`，或让托管平台/Sandbox proxy 转发并鉴权该端口。容器内正常而宿主 TCP 超时属于部署层未发布，browserd 代码无法自行放通。

重建 Linux 镜像后，旧的隔离 `novnc` 模式可运行真实双会话 RFB 验收：`BYCLAW_RUN_VNC_INTEGRATION=1 node /opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use/scripts/vnc-isolation-integration.mjs`。该测试会打开两个独立桌面，经各自 VNC WebSocket 输入不同内容，关闭其中一个 session，并确认另一个仍保持连接且内容不受影响。

## 防绕过边界

安装 `@byclaw/dsh-bash-provider` 后，已知的 Playwright、browser-use、Chrome/Chromium、CDP、remote-debugging、包执行器和脚本 loader 命令会返回 `DIRECT_BROWSER_ACCESS_DENIED`，普通项目命令不受影响。

这只是纵深防御，不是同容器任意代码执行的硬边界；新的 loader/路径仍可能绕过字符串策略。同不可信 Agent 需要强隔离时，应把 `browserd` 放入 sidecar，使用私有 API、独立文件系统/进程命名空间、网络白名单，并从 DSH 容器移除浏览器和 CDP。

## 故障排查与验证状态

- secret/socket/FD 错误：Docker 中从 `byclaw-dsh-entrypoint` 启动；确认私有 `/run/byclaw-browser` 目录树归运行账户 `byclaw` 所有。
- 浏览器启动失败：确认 executable 与 `playwright-core` 1.62.1 兼容；业务镜像禁止再次 `playwright install`。
- 模型不能理解页面：优先使用 `inspect` DOM。`screenshot` 返回元数据和可读文件路径，需要调用方显式检查或附加该文件。
- ByClaw 同步授权失败：补齐外部 Beyond Token/登录态；与 broker 无关。
- noVNC 断开：确认 viewer 已启用、URL 含正确且经过编码的活跃 `sessionId`，检查该会话运行目录及 Xvfb/x11vnc/websockify 子进程；若使用 Sandbox proxy，保留其 token 和路径前缀。
- 下载不可读：在 `close` 前消费，并检查下载根目录/子目录为私有 `0700`、文件为 `0600`，且浏览器与 DSH 都以 `byclaw` 运行。

包级测试覆盖 Agent session 生命周期、结构化错误、版本化观察、页面就绪与等待、批量动作、截图文件、broker 隔离和真实 Chromium 行为；直接 Playwright 被拒绝而普通项目命令成功。Docker 构建包含同运行 UID 的产物权限和 subreaper 检查；无 Docker daemon 时，以静态 Docker/noVNC/supervisor/entrypoint 和包级检查作为本地验证 gate。

## Jev 目标执行（默认关闭）

设置 `BYCLAW_BROWSER_JEV_ENABLED=true` 并重启 Worker 与 browserd 后，现有 `browser` 工具增加 `runGoal` 和 `goalControl`。关闭时不注册这两个操作，执行端也拒绝直接调用。此开关独立于员工路由、模型路由开关，普通数字员工与超级助手均可使用浏览器目标执行。

```dotenv
BYCLAW_BROWSER_JEV_ENABLED=true
BYCLAW_JEV_API_KEY=<沿用现有 Jev 网关密钥，或 AI_GATEWAY_API_KEY>
BYCLAW_JEV_BASE_URL=https://ai-gateway.vercel.sh/typesafe
BYCLAW_JEV_MODEL=typesafe-ai/jev
BYCLAW_JEV_TIMEOUT_MS=15000
```

填写文字通过 ByClaw integration 的 `byclawBrowserText` 服务生成，默认复用调用方当前会话的实际模型及其现有凭据，无需单独配置文字模型。每次 runGoal 开始时绑定会话 requestHeader 中的实际 provider/model；Auto 已选定的模型也直接复用，不重新路由，不携带工具。一次目标执行期间保持该模型，后续 runGoal 使用届时会话的实际模型。仅填写时发起文字请求；缺少实际会话模型或必要信息时返回 `needs_user`。Jev 一次请求同时选择操作及各操作的候选目标，只消费实际选中操作的目标头。当前支持点击、填写普通文本输入框、原生单选下拉框、垂直滚动、等待和结束；复杂拖拽、文件上传、验证码、密码输入需交回用户或已有专用流程。

```json
{
  "operation": "runGoal",
  "goal": "搜索杭州天气，将城市选为杭州，读取查询结果",
  "startUrl": "https://example.com/search",
  "allowedDomains": ["example.com"],
  "allowSubmit": false,
  "maxSteps": 20,
  "successText": "查询结果"
}
```

新会话省略 allowedDomains 时取 startUrl 的域；已有会话只可沿用已有域和提交权限，不能借 runGoal 扩大。`allowSubmit` 默认为 false；设置 true 仍须已有业务授权。该字段只能拦截可识别表单提交，不能识别所有按钮的业务写入含义；不要把它当通用只读模式。

执行复用 browserd、登录态与原有网络/下载策略。候选只来自当前可见且可操作的元素，包含 ARIA 选项、原生下拉选项、可滚动范围；模型不能提供选择器或代码。每次模型返回后校验页面结构及可见文本，变更则重新决策；暂停/继续还会撤销旧决策。只对确定发生在派发前的过期状态重选，动作结果不明时返回 `execution_unknown`，不会自动重放。

结果中 `goal.status` 的含义：

| 状态 | 可以确认 |
| --- | --- |
| `reported_done` | Jev 判断目标完成，未提供独立成功条件 |
| `verified` | 最终可见文本包含 successText、URL 完全等于 successUrl；提供两者时须均满足，不代表服务端业务结果已验证 |
| `needs_user` | 缺少输入信息、文字模型不可用或当前交互无法继续 |
| `blocked` | 页面条件未满足、权限拒绝或连续无进展 |
| `failed` | 达到预算、Jev 不可用、低置信度或执行结果不明；检查 reason 与 steps |
| `cancelled` | 已取消；已完成的动作不会回滚 |

`goal` 同时返回动作数、决策数、文字模型次数、分阶段耗时、Jev token 计数、完成步骤和下载产物。下载在 lease 清理前复制到 `BYCLAW_BROWSER_GOAL_ARTIFACT_DIR`，默认 Worker 当前目录的 `.byclaw-browser-artifacts/<runId>/`，需要运维配置持久化及清理周期。观察位于顶层 observation；无法获得新观察时只保留已完成步骤。

### 人工接管与并发

noVNC 顶部显示运行状态及暂停/继续/取消。为在服务端隔离人工输入，本版本运行时暂时断开 VNC，仍可查看任务状态；点击暂停后，等待当前已派发动作结束，状态变成 `paused` 才重连桌面。继续时立即断开并重新观察。暂停也计入总时限，默认最多暂停 120 秒。暂未实现运行中只读直播画面。

工具侧控制使用同一真实 Agent/session 所有权，并携带当前 runId 与 generation；可通过 noVNC 状态取得控制信息。旧 runId 或旧 generation 的控制请求会被拒绝。例：`{"operation":"goalControl","runId":"<当前 runId>","generation":0,"command":"pause"}`，command 支持 state/pause/resume/cancel。

每个 sandbox 同时只允许一个目标执行；Docker 镜像的托管 byCLI 启动器与目标执行持有同一 OS 文件锁，命令结束/进程退出释放。doctor、daemon、help、list 等管理命令不占锁。开启开关后其余 byCLI 命令串行，不再保持原先跨 Adapter 的并行度。不得通过 npm 包路径、原生 CDP 或自建客户端绕过托管启动器；文件锁不是针对同 Unix 用户任意代码的安全边界。宿主机手工运行的 byCLI 不自动接入该锁。

### 预算与日志

环境变量完整样例见仓库 `.env.example`。默认 40 动作、80 决策、180 秒总时限、12 次填字请求、0.5 最低置信度；工具可调低 maxSteps/maxRunMs，不能提高部署上限。连续无进展停止；不进行动作或模型请求的隐藏重试。

日志前缀 `[byclaw-browser-goal]`：

- `enabled` / `disabled`：插件加载时记录开关状态。
- `started`、`observed`：目标进入执行、收到页面观察。
- `jev_request` / `jev_response`：Jev 确实被调用；response 包含操作、置信度、耗时及可用 usage。
- `text_model`（source=session、会话 ID、实际 provider/model）、`text_request` / `text_response`：填写模型调用次数和耗时，不含输入值。
- `action_requested` / `action_completed`：尝试动作、broker 完整返回结果；结果不明记录 `action_unknown`。
- `stale`：页面或控制代次变化，旧决策已放弃。
- `finished`：最终状态、原因、步骤数、总耗时。

目标日志按 runId/sessionId 关联；辅助文字模型的 text_model 日志按 sessionId 关联。不记录原始目标、网页正文、输入值、密钥或 Cookie。`jev_response` 不能证明动作成功；以 action_completed、finished、页面成功条件及真实业务结果逐层核对。真实 Jev 渠道、真实文本模型和 Docker/noVNC 部署仍需部署环境验证，本地模拟不能证明生产调用成功或性能收益。
