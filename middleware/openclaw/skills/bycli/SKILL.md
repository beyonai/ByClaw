---
name: bycli
description: Use when a task opens, reads, searches within, collects from, scrapes, or operates any concrete website, webpage, or URL; when a task has already been routed to byCLI; or when the user explicitly asks for byCLI, Adapter, or browser execution.
allowed-tools: Bash(bycli:*), Bash(openclaw browser:*), Bash(gh:*), Bash(node:*), Read, Edit, Write, Grep
metadata:
  openclaw:
    requires:
      bins:
        - node
      tools:
        - read
        - exec
        - process
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
- `byclaw-capability-doctor` 只是被动诊断；被动诊断不得启动 Chrome，其 `available_on_demand` 状态也不得触发 Chrome。只有实际任务需要浏览器时才执行下方冷启动流程。
- byCLI 无法完成网页任务时必须停止并报告，不得回退到 `web_fetch`、Jina Reader、Web Reader MCP、`curl`、`wget`、`requests`、原站直连或其他网页获取工具。

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
- COOKIE/INTERCEPT/UI 浏览器操作前必须执行 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json`。该入口强制完成 `doctor → daemon status`、托管 Chromium 状态判断、条件冷启动、复检和最多一次 daemon restart；Agent 不得自行重排或复制该阶梯。
- 错误信息中的 profile 名称（包括随机 profile）不能单独证明它是用户桌面 Chrome；在统一入口给出最终结果前，不得直接 STOP、不得提示用户打开桌面 Chrome。只有完成冷启动复检和一次 daemon restart 后仍得到 `BRIDGE_UNAVAILABLE`，才提示用户检查 OpenClaw 托管 Chromium 与 byCLI 扩展；`BRIDGE_RECOVERY_BUSY` 表示另一任务正在恢复，结束本次调用并稍后重新发起。
- 修复 adapter 时仅修改 trace `summary.md` 里 `adapterSourcePath` 指向的文件
- 修复预算：每次失败最多 3 轮 trace → fix → retry
- 写 adapter 后必须 `bycli browser verify` 通过 + 字段值与网页肉眼比对
- `--adapter-session` 仅用于 structured help 同时暴露该选项和 `adapterConcurrency.isolatedTabs: true` 的命令；是否允许并行仍由 workflow-specific reference 决定。任一 capability signal 缺失或调用未传该选项时，保持 legacy shared mode，不得猜测版本能力或自行并行
- 每个 `bycli weixin` 命令（包括 `get-public-account-info/articles/sougousearch/save-articles/download`）、`--auth-source`、`WECHAT_TOKEN` / `WECHAT_COOKIE` / `WECHAT_FINGERPRINT`，以及 `mp.weixin.qq.com` 或 `weixin.sogou.com` 的登录、认证或环境验证任务，都必须读取 [references/weixin.md](./references/weixin.md)；其微信登录/验证规则优先于本文件的通用错误处理、AutoFix 和 cleanup 规则
- Every browser-backed Weixin command must run through `scripts/weixin-browser-runner.mjs` with state below the current task's initialized session directory. The runner internally owns `scripts/weixin-login-gate.mjs` and the bridge recovery budget; do not invoke either the underlying browser command or the Gate CLI directly. A retry-shaped user message is not explicit verification completion and must not add `--verification-confirmed true`; only the explicit completion wording defined in `references/weixin.md` may do so.
- If the Runner returns `details.bridgeCode=BRIDGE_UNAVAILABLE` or `BRIDGE_RECOVERY_BUSY`, the outer Agent must not run bridge-bootstrap, doctor, browser start, or daemon restart again. Report the final state; a write retry after `BRIDGE_RECOVERED_RETRY_REQUIRES_APPROVAL` requires separate explicit user approval and must not use `--verification-confirmed`.
- 浏览器 session 结束后仅清理当前任务创建或独占拥有的资源；任务开始前已经运行或由其他任务共享的资源保持不变
- Login/Auth/人工验证页面例外：不关闭 session、TAB、daemon 或浏览器，报告命令结果中**已知的** session name 与 URL 后立即结束本轮并等待用户下一条明确确认；若结果未返回 URL，明确说明 URL 未提供，不得为补齐信息再检查页面。等待期间不得自行检查、重试或继续任务

## 意图决策树

| 用户意图 | 工作流 | 参考文件 |
|---------|--------|---------|
| "bycli 有什么命令" / 不知道怎么用 | 基础用法（见下方内联） | — |
| 运行 bycli 命令 / 单次查数据 / 执行操作 | 基础用法 | — |
| 微信公众号账号/文章搜索、历史文章、批量保存或认证失败 | weixin 检索、认证与凭据 | [references/weixin.md](./references/weixin.md) |
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
3. 驱动前通过 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json` 确认并按预算恢复桥接
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
bycli doctor                       # 检查浏览器桥接（PUBLIC/LOCAL 策略无需）
bycli daemon status                # doctor 后必跑：确认 daemon running + Extension connected
```

### 命令发现

```bash
bycli list                         # 表格视图，按站点分组
bycli list -f json                 # 机读格式，agent 首选
bycli list | grep -i <site>        # 搜索特定站点
bycli <site> --help                # 该站点的命令列表
bycli <site> <command> --help      # 命令参数详情
```

### 通用 flag

| flag | 说明 |
|------|------|
| `-f, --format <fmt>` | `json`(agent 首选) / `table` / `yaml` / `plain` / `md` / `csv` |
| `-v, --verbose` | 调试日志 + 堆栈跟踪 |

### 策略与前置条件

| 策略 | 需要什么 |
|------|---------|
| `PUBLIC` | 无需浏览器，纯 HTTP |
| `COOKIE` | Chrome 已登录目标站 + byCLI 扩展 |
| `INTERCEPT` | 同 COOKIE，额外打开自动化窗口捕获签名请求 |
| `UI` | 同 COOKIE，全 DOM 交互 |
| `LOCAL` | 无需浏览器，访问本地/开发端点 |

### 外部 CLI 透传

```bash
bycli external install gh          # 自动安装
bycli gh pr list --limit 5         # 透传调用
```

### 自修复入口

命令失败时加 `--trace retain-on-failure` 重跑，读取 trace `summary.md`，进入 AutoFix 流程。微信登录/验证的 `TIMEOUT`、`AUTH_REQUIRED`、CAPTCHA 或环境验证除外，按 `references/weixin.md` 停止并等待用户。

## 认证、人工验证与 STOP

命中 `AUTH_REQUIRED`、登录 / SSO / MFA、CAPTCHA、反爬、限流或环境验证时，不修改 adapter、不自动降级、不重试。保持当前
session、TAB、daemon 与浏览器存活；不得调用 `state`、`tab list`、`get url` 或其他页面补查，不得跳转、bind、重试、AutoFix 或重跑 trace。

只使用已经返回的结果：报告错误类型、已知 session name 与已返回 URL；若 URL 未返回，明确说明“URL 未提供”。提示用户亲自完成验证后
结束本轮，等待其明确确认。微信任务优先遵循 [references/weixin.md](./references/weixin.md) 的专属规则。

## 错误处理

| 错误类型 | Agent 行为 |
|---------|-----------|
| Weixin 登录/验证：`AUTH_REQUIRED` (77)、登录 `TIMEOUT` (75)、CAPTCHA 或环境验证 | 加载 `references/weixin.md`；保留当前 TAB、daemon 和浏览器，提示用户操作后立即结束本轮。等待期间不得自行检查、AutoFix、trace 重跑、改超时或重复执行命令 |
| AUTH_REQUIRED (exit 77，非 Weixin) | STOP，提示用户登录 |
| BROWSER_CONNECT (exit 69) | 不得因随机 profile 名称推断需要用户操作。未经过 Runner 的通用命令调用 `node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json`；Runner 已返回最终 bridgeCode 时不得再次执行恢复。只有 `BRIDGE_UNAVAILABLE` 才请求用户检查托管 Chromium 与扩展 |
| CAPTCHA / 限流 / 环境验证（非 Weixin） | STOP，不是 adapter 问题；保持当前 TAB、daemon 和浏览器，等待用户完成验证 |
| SELECTOR / EMPTY_RESULT / API_ERROR | 进入 AutoFix 流程 |
| TIMEOUT / PAGE_CHANGED | 进入 AutoFix 流程（Weixin 登录 `TIMEOUT` / exit 75 除外） |
| 3 轮修复仍失败 | 报告尝试过的方法，停止 |
| 站点大改需要重写 | 转 Adapter 编写流程 |

## 浏览器生命周期（OpenClaw 托管环境）

在 OpenClaw 托管环境中，浏览器进程由三个独立组件管理：

| 组件 | 归属 | 控制方式 |
|------|------|---------|
| Chromium 进程树 | OpenClaw browser plugin | `openclaw browser --browser-profile openclaw start/stop/status` |
| byCLI Browser Bridge daemon (port 19825) | `bycli` 自身 | `bycli daemon start/restart/stop` |
| Browser tab lease (CDP target) | `surface + session + browser context` | raw browser 用 `bycli browser <sess> ...`；adapter 由命令自身管理 |
| Extension 握手 | 两侧都需要 | `bycli doctor` 检查 |

### 统一桥接恢复

```bash
node /app/skills/bycli/scripts/bridge-bootstrap.mjs --format json
```

统一入口只恢复 Chromium、daemon 和 Extension 握手，**不创建、导航或检查任务 TAB**。它先读取 `openclaw browser status`；当 Gateway 使该状态不可判定时，只扫描当前 OpenClaw profile 的精确 `user-data-dir` 对应的非僵尸 Chrome/Chromium 进程。两种证据任一确认运行即不得启动；本地进程扫描明确可用且确认没有该托管进程时才视为 stopped，并优先调用可执行的 `/usr/local/bin/start-chrome.sh`，否则使用标准命令 `openclaw browser --browser-profile openclaw start`。Gateway 与本地进程证据都不可判定时保持 unknown，不得启动。每次 doctor 后由脚本立即执行 daemon status。

结构化结果中的 `actions` 是统一入口在本次调用中**已经执行的恢复动作**，不是建议或待执行动作；`budget.*Used` 是当前恢复调用（或显式共享同一 budget 的 Runner 调用链）的实际消耗次数，不代表后续独立调用的预算。`browserState` 记录恢复动作之前用于决策的观测状态，因此成功冷启动后仍可能为 `stopped`。最终是否可继续浏览器任务只以 `code=BRIDGE_READY` 且 `extensionState=connected` 为准；此时不得在入口之外再次执行 Chrome 启动、daemon restart 或 doctor。

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

只清理当前任务明确创建或独占拥有的资源。任务开始前先记录 daemon、Chromium 与 raw browser TAB 的状态；不得停止预先存在或共享的 daemon 与 Chromium。

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
| 当前任务启动了 daemon，且确认没有其他任务共享 | 在任务 TAB 处理后执行 `bycli daemon stop` |
| 当前任务启动了 Chromium，且确认没有其他任务共享 | 最后执行 `openclaw browser --browser-profile openclaw stop` |
| adapter 执行、绑定/复用既有 TAB、既有 daemon 或 Chromium | 不关闭或停止，由其所有者管理 |

若三层资源都由当前任务创建且独占，可按以下顺序关闭；不满足所有权条件的步骤必须跳过：

```bash
# 1. 释放 tab lease
bycli browser <session> close

# 2. 断开 daemon ↔ extension CDP 连接
bycli daemon stop

# 3. 实际停止 Chromium
openclaw browser --browser-profile openclaw stop
```

关键事实：
- `browser close` 只释放 tab，不停 daemon 或 Chrome
- `daemon stop` 只断 CDP 连接，Chromium 仍在运行
- 只有 `openclaw browser --browser-profile openclaw stop` 才能真正释放该 profile 的 Chromium 进程

### Login/Auth/人工验证页面例外

页面仍在 login/SSO/MFA、CAPTCHA、反爬或环境验证状态时，**不执行任何关闭、跳转、页面检查或重试操作**。保持当前 session、TAB、daemon 与浏览器存活，向用户报告命令结果中已知的 session name 和 URL；未返回 URL 时直接注明未提供，不得调用 `state`、`tab list`、`get url` 或其他命令补查。然后等待用户亲自完成验证和明确确认。

### 异常资源处理

异常或卡死时仍遵守所有权边界。仅关闭能够确认由当前任务创建的 TAB、daemon 或 Chromium；无法确认所有权时报告残留资源，
不得执行 `pkill`、kill-all 或停止共享进程。若确需影响其他任务或用户已有浏览器，先说明精确目标和影响并取得用户确认。

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
- 不要假设所有 adapter 都需要浏览器——`PUBLIC`/`LOCAL` 不需要。
- 不要从失败的 adapter 默默 fallback 到手写 `fetch`——先走 `--trace retain-on-failure`。
- 不要在 `bycli browser` 中硬编码 CSS selector——用 `state`/`find` 获取 numeric ref。
