---
name: bycli
description: Use when a task opens, reads, searches within, collects from, scrapes, or operates any concrete website, webpage, or URL; when a task has already been routed to byCLI; or when the user explicitly asks for byCLI, Adapter, or browser execution.
allowed-tools: Bash(bycli:*), Bash(gh:*), Bash(node:*), Read, Edit, Write, Grep
---

# byCLI Skill

byCLI skill 封装 byCLI —— byCLI 把任意网站、Electron 桌面应用或外部 CLI 统一为 `bycli <site> <command>` 接口，agent 无需 screen-scraping 即可驱动。

本 skill 是 byCLI 的浏览器与 Adapter 执行层——根据已路由的站点任务选择命令、驱动浏览器、发现或修复 Adapter，并返回执行结果。

常见触发：`bycli`、浏览器操作、驱动浏览器、打开网站、访问网页、登录、操作网站、搜索、查找、采集、抓取、爬取、写爬虫、adapter 坏了、写 adapter、修复命令、`browser open`、`open cli`、`autofix`、`scrape`、`crawl`、`browse`、`open URL`。

## 路由边界

- 公共互联网调研、搜索或读取先由 `knowledge-collection` 的内置路由层（`skills/knowledge-collection/references/agent-reach.md`，原 By-Reach 路由器）做意图路由；Exa、`gh` CLI、RSS、视频字幕等不打开或读取具体网页的渠道可继续使用其专用后端。
- 任何网站、网页或 URL 的打开、读取、站内搜索、采集、抓取或操作任务，包括 generic public webpage 读取，路由层必须无条件选择并加载 `bycli` skill；公开静态页、服务端渲染页、SPA、raw URL、纯文本、Markdown 和无需登录的页面均无例外。
- byCLI 是所有具体网页任务的唯一网站执行器，不是公共互联网非网页渠道的默认路由器。选择 byCLI 必须发生在获取网页内容之前，不能先调用任何其他网页工具试读。
- 用户显式要求 byCLI、Adapter、浏览器操作、登录态网站，或路由层选择 byCLI 作为浏览器执行层时，进入本 skill。
- 选中 byCLI 后，浏览器启动、Adapter 发现、授权与执行仍完全遵守本 skill。
- `byclaw-capability-doctor` 只是被动诊断；被动诊断不得启动 Chrome，其 `available_on_demand` 状态也不得触发 Chrome。实际浏览器任务按下方 DSH 托管生命周期确认所有权和桥接状态。
- byCLI 无法完成网页任务时必须停止并报告，不得回退到 `web_fetch`、Jina Reader、Web Reader MCP、`curl`、`wget`、`requests`、原站直连或其他网页获取工具。

## 可选 Jev 目标执行

当当前 `browser` 工具参数中确实有 `runGoal` 时，先发现现有站点 Adapter；有适用 Adapter 继续优先使用。没有适用 Adapter、需要通用网页多步交互且业务授权明确时，可使用 `browser` 的 `runGoal`，这是本 skill 的可选执行后端。未暴露 runGoal 时继续原 byCLI 流程，不自行开启开关、不回退其他抓取渠道。

- 给出目标、起始 URL、允许域和已提供的信息；提交操作须先有用户授权才设 allowSubmit=true。默认 false 不能拦截所有业务写入。
- 优先提供可核对的 successText/successUrl。reported_done 仅模型判断，verified 仅满足页面条件；交付前仍核对业务结果。
- runGoal 与 byCLI 不并发；返回后再继续 Adapter/byCLI。执行结果不明时停止核对，不自动切换后端重放写操作。
- 需要人工登录、验证码或不支持的交互时，用 noVNC 暂停并接管。等待 paused 后操作，继续时重新观察；不杀托管进程。
- 下文“browser 仅用于 status”的限制在 runGoal 已暴露且满足以上条件时增加此例外；其他域、登录态、资源所有权及业务授权要求继续适用。

## 委派所有权边界

- 角色名称固定为：采集编排器 `knowledge-collection`（含内置公共互联网路由层）、网站执行器 `bycli`、站点 Adapter、直接查询所有者（根 Agent）。
- 采集编排器委派时，`knowledge-collection` 只负责统一持久化、产物协议与采集交付；任何下游处理由根 Agent 另行委派。
- 网站执行器只执行或发现、修复 Adapter，并把结构化记录、正文或文件元数据返回采集编排器，不规定统一产物名称或目录。
- 网站执行器不得反向加载 `knowledge-collection`。是否处于委派模式不改变 byCLI 的命令、授权、浏览器生命周期或 Adapter 验证规则。
- 委派模式下若浏览器降级过程值得复用，返回 `adapterCandidate` 与判断依据给采集编排器，不得直接询问用户是否保存 Adapter。
  非委派的直接查询中，只有直接查询所有者（根 Agent）可以按下方规则询问 Adapter 复用。

## 规则优先级

规则冲突时，按以下顺序处理：

1. 用户明确的当前操作范围和安全边界。
2. 微信任务的专属认证与验证规则。
3. 本 Skill 的 STOP / 认证 / 浏览器生命周期规则。
4. 已选择工作流的详细 reference。

遇到认证、人工验证、桥接不可用或其他 STOP 条件时，停止当前工作流；不得为了补充信息扩大操作范围。

## 严格禁止 (NEVER DO)

- 不要硬编码 adapter 列表，始终用 `bycli list -f json` 动态发现
- 不要在 `browser eval` 中执行写操作（submit/click/navigate），用 `click`/`type`/`select` 结构化命令
- 不要跨页面复用 numeric ref，页面变化后必须 re-`state`
- 不要在修复 adapter 时修改 `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`
- 不要放宽 `verify/<cmd>.json` fixture 来掩盖失败——修 adapter 让输出正确
- 不要猜测字段含义——猜错了 verify 通过但数据是错的
- 不要在 repo 根目录 / `clis/<site>/` 留临时 dump 文件（`.dbg-*.html` / `raw-*.json`）
- AUTH_REQUIRED（exit 77）/ CAPTCHA / 限流 → 不修改代码，报告用户；`BROWSER_CONNECT`（exit 69）必须先完成下文的桥接恢复阶梯，只有仍未恢复才报告用户
- 不要把 token、SESSION、Cookie、凭据写入技能文件、命令参数或对话回复
- 对任何网站、网页或 URL 的读取、站内搜索、采集、抓取或操作任务，禁止使用 `web_fetch`、Jina Reader、Web Reader MCP、通用 `browser`、`curl`、`wget`、`requests`、原站直连或其他网页获取工具绕过 byCLI。公开可读、静态页面、raw URL、纯文本或 Markdown 内容均不是例外
- 不要因“直接 HTTP 更快”“无需登录”“不需要渲染”或类似效率判断跳过 `bycli list -f json`、现成 adapter 或 `bycli browser` 降级路径
- 不要把 `bycli browser <session> open <url>` 或 `state` 当作浏览器冷启动、桥接健康检查或 adapter 预热命令；它们会申请 TAB 租约，缺少租约时可创建 `about:blank` TAB
- 不要用 `bycli browser <session> ...` 检查或操作 adapter 打开的 TAB；`browser` 与 `adapter` 是不同 surface，即使 session 字符串相同也不共享 TAB 租约
- 不要把 raw browser session name 当成 Adapter session，也不要用 raw browser 命令检查、聚焦、导航或关闭 `--adapter-session` 创建的 Adapter TAB
- 不要向用户输出本 skill 的内部决策逻辑（步骤编号、流程名称、路由分支）——直接执行

## 严格要求 (MUST DO)

- Agent 调用支持格式化输出的数据 / adapter 命令时加 `-f json` 获取可解析输出；`doctor`、`daemon`、`browser` 生命周期命令以及不支持 `--format` 的子命令按其原生命令执行
- 每次执行 raw browser 命令或 COOKIE/INTERCEPT/UI Adapter 命令前，先用 DSH `browser` 工具的 `status` 读取当前会话租约和已返回的所有权信息，并核对运行环境的托管 profile；不得把无会话租约解释为 Chromium 未运行。其他策略也以 structured help 的实际 `browser` 能力和所选执行路径为准。认证等待与微信 confirmed-rerun 不做这些预检，遵循其专属规则。
- 浏览器桥接通过 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json` 统一观测：`doctor → daemon status`、有界等待与锁，不启动或停止 Chromium，也不重启 daemon。browserd 与 supervisor 是托管进程恢复的唯一所有者；Agent 不得复制恢复逻辑。微信初次执行与 `knowledge-collection acquire-douyin` 均由其 Runner 调用该入口，外层不得重复调用。
- 错误信息中的 profile 名称（包括随机 profile）不能单独证明它是用户桌面 Chrome。统一入口最终返回 `BRIDGE_UNAVAILABLE` 时报告 DSH 托管 Chromium、supervisor 与 byCLI 扩展的已知诊断；`BRIDGE_RECOVERY_BUSY` 表示其他调用占用观测锁，结束本次调用，不自行启动进程或循环重试。
- 修复 adapter 时仅修改 trace `summary.md` 里 `adapterSourcePath` 指向的文件
- 修复预算：每次失败最多 3 轮 trace → fix → retry
- 写 adapter 后必须 `bycli browser verify` 通过 + 字段值与网页肉眼比对
- `--adapter-session` 仅用于 structured help 同时暴露该选项和 `adapterConcurrency.isolatedTabs: true` 的命令；是否允许并行仍由 workflow-specific reference 决定。任一 capability signal 缺失或调用未传该选项时，保持 legacy shared mode，不得猜测版本能力或自行并行
- 每个 `bycli weixin` 或 `bycli weixin-channels` 命令、`--auth-source`、`WECHAT_TOKEN` / `WECHAT_COOKIE` / `WECHAT_FINGERPRINT`，以及 `mp.weixin.qq.com`、`weixin.sogou.com` 或 `channels.weixin.qq.com` 的登录、认证或环境验证任务，都必须读取 [references/weixin.md](./references/weixin.md)；其微信登录/验证规则优先于本文件的通用错误处理、AutoFix 和 cleanup 规则。视频号适用该文档的“视频号统计与鉴权”段，不能套用公众号 token 或登录 TIMEOUT 判定。
- 独立执行 browser-backed `weixin` / `weixin-channels` 命令必须经过 `scripts/weixin-browser-runner.mjs`，状态放在当前已初始化任务目录下。Runner 内部持有登录 Gate 与桥接恢复预算，Agent 不得直接调用底层浏览器命令或 Gate CLI。`knowledge-collection acquire-weixin-channels` 是获准编排入口：它内部复用同一 Gate、统一持有一次桥接预检，外层不得再套 Runner。仅用户明确完成验证后的新确认可传 `--verification-confirmed true`，“再试试”不算确认。
- If the Runner returns `details.bridgeCode=BRIDGE_UNAVAILABLE` or `BRIDGE_RECOVERY_BUSY`, the outer Agent must not run bridge-bootstrap, doctor, browser start, or daemon restart again. Report the final state; a write retry after `BRIDGE_RECOVERED_RETRY_REQUIRES_APPROVAL` requires separate explicit user approval and must not use `--verification-confirmed`.
- 浏览器 session 结束后仅清理当前任务创建或独占拥有的资源；任务开始前已经运行或由其他任务共享的资源保持不变
- Login/Auth/人工验证页面例外：不关闭 session、TAB、daemon 或浏览器，报告命令结果中**已知的** session name 与 URL 后立即结束本轮并等待用户下一条明确确认；若结果未返回 URL，明确说明 URL 未提供，不得为补齐信息再检查页面。等待期间不得自行检查、重试或继续任务

## 意图决策树

| 用户意图 | 工作流 | 参考文件 |
|---------|--------|---------|
| "bycli 有什么命令" / 不知道怎么用 | 基础用法（见下方内联） | — |
| 运行 bycli 命令 / 单次查数据 / 执行操作 | 基础用法 | — |
| 微信公众号账号/文章搜索、历史文章、批量保存或认证失败 | weixin 检索、认证与凭据 | [references/weixin.md](./references/weixin.md) |
| 抖音作品、分享链接或视频文件归档 | 现成 douyin Adapter；委派采集由 `acquire-douyin` 持有 | 下方「抖音作品读取与下载」 |
| 驱动浏览器完成一次性任务 / 填表 / 爬数据 | Browser 驱动 | [browser.md](./references/browser.md) |
| bycli 命令报错 / adapter 坏了 / 网站改版 | AutoFix 修复 | [autofix.md](./references/autofix.md) |
| 给新站点写 adapter / 新增命令 | Adapter 编写 | [adapter-author.md](./references/adapter-author.md) |

关键区分：
- 已路由到 byCLI 的网页读取、搜索、采集、抓取、网站操作或打开 URL 任务 → 先执行 `bycli list -f json` 动态发现 adapter，再选择执行路径；不得先调用通用网页工具
- 有现成 adapter → 直接用 `bycli <site> <command>`。adapter 即使内部使用浏览器，仍必须由 adapter 管理；不得改用 raw `bycli browser` 或通用网页工具
- 没有 adapter 但需要一次性浏览 / 查询 → Browser 驱动，并按下方条件判断是否询问 Adapter 复用
- 没有 adapter 且需要复用 → 写新 adapter
- 现有 adapter 报错 → AutoFix

收到已路由到本 skill 的**搜索 / 采集 / 抓取 / 网站操作**类任务时，按本决策树选择执行路径。网页相关任务在 adapter 缺失时必须使用 `bycli browser`，不得降级到通用网页工具。byCLI 已明确报告该任务不支持或当前无法执行时，必须说明具体结果与无法继续的原因并停止；即使用户确认，也不得在本任务中改用 `web_fetch`、Jina Reader、Web Reader MCP 或直接 HTTP 工具。不得因“内容公开”“静态”“纯 Markdown”或“更高效”自行触发例外。

### 适配器缺失降级（强制）

`bycli list -f json` 确认无对应适配器时：

1. 用 `bycli browser` 系列命令完成任务，不跳到通用工具
2. 按下方浏览器生命周期 + [browser.md](./references/browser.md) 规范执行
3. 驱动前按 DSH 生命周期确认托管 profile 与租约所有权，并通过 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json` 有界观测桥接
4. 执行成功后，按下方所有权规则处理 Adapter 复用候选

### Browser 驱动成功后 — Adapter 复用询问

触发条件：本次数据通过 `bycli browser` 降级驱动获取（即 `bycli list -f json` 无现成 adapter），且该过程具备明显复用价值（例如同站点同字段会反复获取、步骤稳定、用户明确要以后复用）。已有现成 adapter（直接 `bycli <site> <command>`）或一次性浏览 / 登录 / 单篇阅读则**跳过此问**。

委派采集模式下，不直接提问；将 `adapterCandidate` 设为 `true`，并把站点、复用理由、建议命令写入返回给采集编排器的执行元数据。

非委派的直接查询中，由直接查询所有者（根 Agent）在返回数据的同一轮回复里问：

> 「本次数据是通过浏览器实时驱动获取的。是否把刚才的获取过程保存成一个专用 adapter（适配器）？保存后下次同类请求可直接 `bycli <site> <command>` 快速获取，无需再驱动浏览器。（是 / 否）」

- 用户答**是 / 需要 / 保存 / 可以**等肯定意图 → 进入 [adapter-author.md](./references/adapter-author.md) 流程，把本次驱动过程（站点、命令、抓到的接口 / DOM、字段）沉淀为 adapter（含 verify、原始请求重放、交付，均按该流程 runbook 执行）
- 用户答**否 / 不用 / 跳过** → 不写 adapter

## 基础用法

### 安装

使用环境中已安装的 byCLI，并需要 Node >= 21。

```bash
npm install -g @sovovs/bycli    # 需要 Node >= 21
node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json # 仅实际浏览器执行路径需要；微信由 Runner 调用
```

### 命令发现

```bash
bycli list                         # 表格视图，按站点分组
bycli list -f json                 # 机读格式，agent 首选
bycli list | grep -i <site>        # 搜索特定站点
bycli <site> --help                # 该站点的命令列表
bycli <site> <command> --help      # 命令参数详情
```

### 抖音作品读取与下载

先用 `bycli list -f json` 和 `bycli douyin read --help -f json`、`bycli douyin download --help -f json` 核对当前安装能力。直接查询作品与可用官方字幕选 `read`；用户要求保存视频文件时选 `download --metadata true`，输出目录必须在本次任务授权范围内：

```bash
bycli douyin read "<作品 ID、HTTPS 链接或分享文案>" -f json
bycli douyin download "<同一作品目标>" --output "<授权输出目录>" --metadata true -f json
```

`read` 返回作品、默认不读取的可选评论、实际可用的官方字幕和 `limitations`。字幕 `status=available` 时使用真实 `cues[].from/to/text`；无字幕或 `unavailable` 时如实说明，不从标题或评论编造口播，不执行 ASR、抽帧或视频理解。当前实现最多读取前三条官方字幕轨道、每轨 1 MiB，解析 JSON/VTT/SRT；有字幕也不证明覆盖整段视频，不能宣称获得完整全文。

委派采集归档只由已初始化会话的 `knowledge-collection acquire-douyin` 串行调用 `read` 与 `download --metadata true`，网站执行器不另跑这两条命令、不反向加载采集 Skill、不手工写归档回执。Runner 独占一次 bridge 预检，外层不另跑 bootstrap、doctor 或套其他 Runner。明确认证或人工验证时保留原 session、TAB 和证据并 STOP；只有用户明确完成验证后，根 Agent 才可对原 `acquire-douyin` 命令添加 `--verification-confirmed true` 续采，不重做桥接。字幕缺失不触发认证重试。未委派的直接查询继续遵循本 Skill 的浏览器前置与 STOP 规则。

### 通用 flag

| flag | 说明 |
|------|------|
| `-f, --format <fmt>` | `json`(agent 首选) / `table` / `yaml` / `plain` / `md` / `csv` |
| `-v, --verbose` | 调试日志 + 堆栈跟踪 |

### 策略与前置条件

| 策略 | 需要什么 |
|------|---------|
| `PUBLIC` | 通常为纯 HTTP；显式 `browser: true` 或 conditional 浏览器分支仍需桥接 |
| `COOKIE` | Chrome 已登录目标站 + byCLI 扩展 |
| `INTERCEPT` | 同 COOKIE，额外打开自动化窗口捕获签名请求 |
| `UI` | 同 COOKIE，全 DOM 交互 |
| `LOCAL` | 通常访问本地/开发端点；以命令声明的实际浏览器能力为准 |

### 外部 CLI 透传

```bash
bycli external install gh          # 自动安装
bycli gh pr list --limit 5         # 透传调用
```

### 自修复入口

先按下方错误规则分类。仅证据表明 Adapter 的 selector、API、响应 schema 或等待条件失配，且当前操作允许重试时，才加 `--trace retain-on-failure` 收集 trace 并进入 AutoFix。认证、人工验证、执行结果不确定和已终结操作不得为采集 trace 重放。微信任务优先遵循 `references/weixin.md` 的预算与终态规则。

### 工具更新与旧 TAB

- 更新 CLI 或 stealth 只改变后续注入；不能据此认定现有 TAB 已使用新代码。daemon 重连、桥接就绪或微信 confirmed-rerun 都不会自动刷新旧文档。
- 只有目标 TAB 所有权明确、未处于认证/人工验证、没有未提交编辑、没有结果不确定的写操作且业务范围允许导航时，才可在原 session 与原 `--tab <page>` 上完整重新导航，使新文档使用更新后的注入；随后重新获取 ref 并验证目标内容。仅 SPA 路由变化不能证明已加载新文档。
- Adapter TAB 由 Adapter 自行管理，不得用 raw browser 命令刷新、检查或关闭。绑定用户 TAB、认证等待、未保存编辑或不确定写状态先保留上下文并报告，不自动刷新或更换 session。
- 工具更新不重置 Runner/Gate 的 terminal fingerprint 或重试预算；不得清 state、修改业务参数或输出路径绕过终态。不确定写先报告原始结果与现有产物，不重放业务操作。

### TIMEOUT 与执行原因分类

- 先使用已返回的结构化错误、现有 trace 和本地产物，区分认证/验证、桥接连接、Adapter 等待条件失配与执行结果不确定；TIMEOUT 本身不能证明网站改版、登录失效或 JS 暂停。
- 仅底层返回与目标匹配的 `Debugger.paused` 或等价明确暂停证据时，才报告 JS 被暂停。当前接口没有暂停检测能力或未返回证据时，标记执行原因/结果不确定并停止，不声称检测到暂停，不自动 resume，也不新增检查 API 或重复命令来猜测。
- 只有已有证据确认 selector、API、schema 或等待条件失配时才进入 AutoFix。桥接就绪不证明目标网页仍在执行；不得靠改 wait 或重启共享进程掩盖原因。微信终态、人工验证与写保护规则优先，保留现有预算。

## 认证、人工验证与 STOP

命中 `AUTH_REQUIRED`、登录 / SSO / MFA、CAPTCHA、反爬、限流或环境验证时，不修改 adapter、不自动降级、不重试。保持当前
session、TAB、daemon 与浏览器存活；不得调用 `state`、`tab list`、`get url` 或其他页面补查，不得跳转、bind、重试、AutoFix 或重跑 trace。

只使用已经返回的结果：报告错误类型、已知 session name 与已返回 URL；若 URL 未返回，明确说明“URL 未提供”。提示用户亲自完成验证后
结束本轮，等待其明确确认。微信任务优先遵循 [references/weixin.md](./references/weixin.md) 的专属规则。

## 错误处理

| 错误类型 | Agent 行为 |
|---------|-----------|
| Weixin 登录/验证：`AUTH_REQUIRED` (77)、公众号登录 `TIMEOUT` (75)、CAPTCHA 或环境验证 | 加载 `references/weixin.md`；保留当前 TAB、daemon 和浏览器，提示用户操作后立即结束本轮。视频号须明确认证/验证错误，普通 TIMEOUT 即使含 finish login 提示也不算鉴权；等待期间不得自行检查、AutoFix、trace 重跑、改超时或重复执行命令 |
| Weixin `AUTH_RETRY_EXHAUSTED` | 验证确认预算已耗尽；这是不可重试终态，不得再次提示登录、添加 `--verification-confirmed`、修改参数或创建新 fingerprint |
| Weixin `COMMAND_TIMEOUT_UNCERTAIN` / `COMMAND_EXEC_UNCERTAIN` | Runner 未取得最终结构化结果；这不是登录状态，不得添加 `--verification-confirmed`。先检查返回的进程诊断和已有本地产物；`download-publish-data` 仅按 `references/weixin.md` 的单次诊断重试规则请求独立授权 |
| Weixin `OPERATION_ALREADY_FINALIZED` | 同一逻辑操作此前已终结，本次未执行底层命令；读取首次执行时保存的结果或产物，禁止解释成登录失败、修改 `--limit`/日期/输出路径绕过 gate，或声称前次业务结果一定成功 |
| AUTH_REQUIRED (exit 77，非 Weixin) | STOP，提示用户登录 |
| BROWSER_CONNECT (exit 69) | 不得因随机 profile 名称推断需要用户操作。未经过 Runner 的通用命令调用 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json`；Runner 已返回最终 bridgeCode 时不得再次执行恢复。只有 `BRIDGE_UNAVAILABLE` 才请求用户检查托管 Chromium 与扩展 |
| CAPTCHA / 限流 / 环境验证（非 Weixin） | STOP，不是 adapter 问题；保持当前 TAB、daemon 和浏览器，等待用户完成验证 |
| SELECTOR / EMPTY_RESULT / API_ERROR | 进入 AutoFix 流程 |
| TIMEOUT | 先按「TIMEOUT 与执行原因分类」处理；原因或业务结果不确定则停止，确认 Adapter 等待条件失配且允许重试才进入 AutoFix；微信专属规则优先 |
| PAGE_CHANGED | 证据确认页面结构变化且允许重试时进入 AutoFix |
| 3 轮修复仍失败 | 报告尝试过的方法，停止 |
| 站点大改需要重写 | 转 Adapter 编写流程 |

## 浏览器生命周期（DSH 托管环境）

DSH 的 browserd 与 supervisor 管理同一运行账号下的托管 Chromium、byCLI daemon 和扩展连接。默认持久化 profile 为 `${DSH_HOME}/browser/user-data`；实际路径以运行环境配置为准，所有任务共享登录身份，TAB 租约与业务授权分别管理。

| 组件 | 归属 | 控制方式 |
|------|------|---------|
| Chromium 与持久化 profile | DSH browserd / supervisor | DSH `browser` 工具的 `status` 读取当前会话状态；进程启动、重连与退出由托管服务负责 |
| byCLI Browser Bridge daemon (port 19825) | supervisor | 统一入口只执行 `doctor → daemon status` 并有界等待；不由 Agent 启停或重启 |
| Browser tab lease (CDP target) | `surface + session + browser context` | raw browser 用 `bycli browser <sess> ...`；adapter 由命令自身管理 |
| Extension 握手 | 两侧都需要 | `bycli doctor` 检查 |

### 统一桥接观测

```bash
node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json
```

先用 DSH `browser` 工具的 `status` 确认当前会话租约、已返回的资源所有权信息和运行环境配置。`status` 未返回 profile、进程或所有权信息时如实记录未知，不猜测；无 lease 不等于全局 Chromium 停止。此处 DSH 工具仅用于托管状态和资源所有权，具体网页读取与操作仍由 byCLI 执行，不杜撰 `dsh browser` CLI。

统一入口不创建、导航或检查任务 TAB，只串行执行 `doctor → daemon status`，在锁和超时预算内等待 supervisor 恢复连接。`actions` 记录本次实际动作而非建议；没有进程恢复动作不能声称已启动浏览器或重启 daemon。保留 Runner 的共享预算与终态保护，不把一次观测变成外层重新恢复的授权。

最终桥接结果为 `BRIDGE_READY` 且 `extensionState=connected` 才可继续允许的浏览器任务；仍须核对业务内容和结果。`BRIDGE_UNAVAILABLE` 或 `BRIDGE_RECOVERY_BUSY` 时报告已有诊断并结束本次调用，不另开 profile、不启动第二个 Chromium、不自行 restart daemon，也不再次执行统一入口。微信 confirmed-rerun 跳过桥接预检，保留原命令和已有 TAB，按其专属规则执行。

### 桥接正常后的 TAB 分流

| 场景 | 必须行为 |
|------|---------|
| 有现成 adapter | 直接执行 `bycli <site> <command>`；不先执行任何 `bycli browser ...` 命令 |
| 继续 raw browser session | 先用 `bycli browser <session> tab list` 只读列举 browser surface 下的现有 TAB；有目标 TAB 时复用其 `page`，后续命令必须带 `--tab <page>` |
| 接管用户已打开的 TAB | 让目标 TAB 保持在前台，执行 `bycli browser <session> bind`；不用 `open` 覆盖当前页 |
| 需要导航 raw browser TAB | 仅在明确需要打开目标 URL 时执行 `open`；已有 TAB 时保持同一 session 并用 `--tab <page>` 定向导航，不更换 session 来新建 TAB |
| 需要 DOM 交互 | 页面已导航到目标 URL 后，用 `state` 或范围更小的 `find` 获取实时 ref；它们不是 session 存在性检查 |
| 非 DOM 读取 | `get url`、`extract`、`network` 等命令不要为了例行预检再追加 `state` |

Adapter session 与 raw browser session 是两套独立命名空间：raw browser surface 使用 `bycli browser <session> ...`，Adapter surface 仅在命令明确支持时使用 `--adapter-session <name>`。未命名的 persistent Adapter 命令继续复用 `site:<site>` 的 legacy shared mode；同名 Adapter session 复用同一 Adapter TAB 并保持串行，不同名称只隔离 TAB，不隔离 Cookie、登录身份、账号状态或限频。命名 Adapter session 必须使用不含账号、用户、token、Cookie 或其他秘密的任务级操作标签；不得在面向用户的诊断信息中暴露原始名称。只有 workflow-specific reference 明确授权的命令才可并行，并且必须先读取 structured help 验证能力。环境中的 byCLI 对所有声明 `adapterConcurrency.isolatedTabs: true` 的命令在同一 profile/site 池内统一执行至少 5 秒的租约启动错峰；并发提交顺序由实际进入调度队列的先后决定，不按 worker 名称排序，也不要用 Agent 侧 sleep 替代中央调度。

Session 复用边界：

- 同名 session 只在同一 `surface + browser context` 且租约仍存活时指向同一 TAB；session name 不是持久的 Chrome TAB 标识
- `bycli browser <session> tab list` 只查 browser surface；返回空数组时表示当前 browser surface 下没有可复用租约，不能据此判断 adapter TAB 不存在
- `open` 和 `state` 在缺少租约时都可申请 TAB；`open` 导航前会先使用 `about:blank` 建立租约，命令中途失败时该空白 TAB 可能保留
- `tab list` 返回多个 TAB 时，根据其 URL 和 title 选择唯一目标 `page`；无法确定时停止并请用户确认，不得猜测后导航或新建 TAB
- `tab list` 非空但当前 URL 不是目标页时，使用同一 session 的 `open <url> --tab <page>` 导航已有 TAB；不为同一任务生成新 session name
- 复用已列出 TAB 时不得省略 `--tab <page>`；若 TAB 在列举后被关闭或 target 失效，报告原始错误并停止，不得去掉 `--tab` 回退到自动申请新 TAB
- `bind` 失败或前台 TAB 发生变化时，报告原始错误并停止；不得自动换 session、执行 `open` 或绑定其他 TAB
- `open` 失败后不得更换 session name 或循环执行 `open/state`；先根据原始错误分流，遇到登录、CAPTCHA、反爬或环境验证立即按验证规则停止
- adapter（包括 Weixin）的 persistent session 由 adapter surface 自身复用；不得用同名 `bycli browser` session 做预检、聚焦、`state` 或验证登录状态
- named Adapter session 仍由 Adapter surface 自行管理；即使 raw browser session 使用相同文本名称，也不得检查、操作或关闭其 TAB
- adapter 自行管理其 TAB；执行器不得用 raw `bycli browser ... close` 关闭 adapter 创建或复用的 TAB

### 关闭流程（非登录或验证页）

只清理当前任务明确创建或独占拥有的 raw browser TAB。DSH browserd、supervisor、daemon、Chromium 与共享 profile 始终由托管服务管理，Agent 不停止或重启它们。

何时执行任务资源清理（以下条件**同时满足**）：

1. 当前浏览器任务链已完成（数据已获取 / 操作已完成）
2. 当前页面**不是** login/SSO/MFA、CAPTCHA、反爬或环境验证页面
3. 没有后续操作需要复用同一 session

何时不关闭：

- 页面仍在 login/SSO/MFA、CAPTCHA、反爬或环境验证 → 保持 session，报告命令结果中已知的 session name 和 URL；未返回 URL 时不补查
- 用户后续任务明确需要继续使用同一浏览器上下文
- 多步操作未完成（例如连续采集多个分页时中途不关闭）
- raw browser 通过 `bind` 接管用户已打开的 TAB，或复用了任务开始前已有的 TAB

关闭粒度：

| 场景 | 操作 |
|------|------|
| 当前任务创建了 raw browser TAB | 用创建该 TAB 的 session 执行 `browser close` |
| 当前任务创建了 DSH 会话 lease | 仅在 DSH 工具返回的所有权允许且业务链已完成时，通过该工具关闭本任务 lease；不停止全局进程 |
| adapter 执行、绑定/复用既有 TAB | 不关闭或停止，由其所有者管理 |
| daemon、Chromium、browserd、supervisor 或共享 profile | 不关闭或重启；报告诊断，由托管服务或部署运维处理 |

仅当任务创建且拥有 raw browser TAB，并满足上述非登录关闭条件时执行：

```bash
# 仅释放本任务拥有的 raw browser tab lease
bycli browser <session> close
```

关键事实：
- `browser close` 只释放 tab，不停 daemon 或 Chrome
- 无 TAB 租约不能据此停止 daemon、Chromium 或共享 profile
- bridge-bootstrap 不拥有托管进程，不能替代 supervisor 恢复或清理它们

### Login/Auth/人工验证页面例外

页面仍在 login/SSO/MFA、CAPTCHA、反爬或环境验证状态时，**不执行任何关闭、跳转、页面检查或重试操作**。保持当前 session、TAB、daemon 与浏览器存活，向用户报告命令结果中已知的 session name 和 URL；未返回 URL 时直接注明未提供，不得调用 `state`、`tab list`、`get url` 或其他命令补查。然后等待用户亲自完成验证和明确确认。

### 异常资源处理

异常或卡死时仍遵守所有权边界。仅在业务结果明确且非认证状态下处理能够确认属于当前任务的 TAB；无法确认所有权、原因或写结果时保留上下文并报告。不得执行 `pkill`、kill-all、全局 resume 或停止/重启共享进程；托管进程故障交给 supervisor 或部署运维处理。

## 详细参考（按需读取）

| 文件 | 何时加载 |
|------|---------|
| [references/browser.md](./references/browser.md) | 需要浏览器驱动命令参考时 |
| [references/weixin.md](./references/weixin.md) | 运行任意 `bycli weixin` 命令、选择 `--auth-source`、处理微信 token/Cookie/fingerprint 或 `AUTH_REQUIRED` 时 |
| [references/autofix.md](./references/autofix.md) | adapter 修复完整流程 |
| [references/adapter-author.md](./references/adapter-author.md) | 写新 adapter 完整流程 |
| [references/adapter-template.md](./references/adapter-template.md) | adapter 文件结构模板 |
| [references/api-discovery.md](./references/api-discovery.md) | API 发现方法论 |
| [references/site-recon.md](./references/site-recon.md) | 站点侦察分类 |
| [references/coverage-matrix.md](./references/coverage-matrix.md) | 动手前可行性自测 |
| [references/field-conventions.md](./references/field-conventions.md) | 已知字段代号词典 |
| [references/field-decode-playbook.md](./references/field-decode-playbook.md) | 字段解码手册 |
| [references/output-design.md](./references/output-design.md) | columns 命名/类型/顺序规范 |
| [references/site-memory.md](./references/site-memory.md) | 站点记忆结构说明 |
| [references/success-rate-pitfalls.md](./references/success-rate-pitfalls.md) | 静默失败陷阱 |
| [references/jsdom-fixture-pattern.md](./references/jsdom-fixture-pattern.md) | JSDOM 测试模式 |
| [references/typed-errors.md](./references/typed-errors.md) | 5 类 typed error 规范 |
| [references/site-memory/](./references/site-memory/) | 各站点公共知识 |

## Don't

- 不要把动态发现的 adapter / 站点命令列表粘贴到计划中——它会过期；基础生命周期命令可保留，实际站点能力以 `bycli list -f json` 和 `bycli <site> --help` 为准。
- 不要按策略标签猜测浏览器需求——以 structured help 的实际 `browser` 能力和本次执行路径为准。
- 不要从失败的 adapter 默默 fallback 到手写 `fetch`——先走 `--trace retain-on-failure`。
- 不要在 `bycli browser` 中硬编码 CSS selector——用 `state`/`find` 获取 numeric ref。
