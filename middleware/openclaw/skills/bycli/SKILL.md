---
name: bycli
description: Use when the user asks to run bycli, query bycli usage, drive a browser, operate a website, repair or write adapters, or perform web search, scraping, crawling, structured data collection, DingTalk data collection, login-assisted browsing, or open-URL tasks.
cli_version: ">=1.0.15"
allowed-tools: Bash(bycli:*), Bash(dws:*), Bash(openclaw browser:*), Bash(gh:*), Bash(node:*), Read, Edit, Write, Grep
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

本 skill 是唯一入口——根据意图路由到对应工作流，详细参考按需加载。

常见触发：`bycli`、浏览器操作、驱动浏览器、打开网站、访问网页、登录、操作网站、搜索、查找、采集、抓取、爬取、钉钉采集、听记采集、钉钉文档采集、写爬虫、adapter 坏了、写 adapter、修复命令、`shanji.dingtalk.com`、`alidocs.dingtalk.com`、`browser open`、`open cli`、`autofix`、`scrape`、`crawl`、`browse`、`open URL`。

## 严格禁止 (NEVER DO)

- 不要硬编码 adapter 列表，始终用 `bycli list -f json` 动态发现
- 不要在 `browser eval` 中执行写操作（submit/click/navigate），用 `click`/`type`/`select` 结构化命令
- 不要跨页面复用 numeric ref，页面变化后必须 re-`state`
- 不要在修复 adapter 时修改 `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`
- 不要放宽 `verify/<cmd>.json` fixture 来掩盖失败——修 adapter 让输出正确
- 不要猜测字段含义——猜错了 verify 通过但数据是错的
- 不要在 repo 根目录 / `clis/<site>/` 留临时 dump 文件（`.dbg-*.html` / `raw-*.json`）
- AUTH_REQUIRED（exit 77）/ BROWSER_CONNECT（exit 69）/ CAPTCHA / 限流 → 不修改代码，报告用户
- 不要在主 SKILL 内联知识库上传 / 更新细节——入库一律进入 [knowledge-ingest.md](./references/knowledge-ingest.md) 流程，底层 upload/build 再由 by-knowledge-manager 执行
- 不要把 token、SESSION、Cookie、凭据写入技能文件、命令参数或对话回复
- 不要在符合采集边界的任务成功后跳过采集后处理询问（入库 / 知识整理 / 跳过，入库和知识整理只能二选一），也不要采集完不落盘就询问
- 不要把采集产物落到 `/tmp/` 或工作区根目录，不要让入参与正文分在不同目录，不要覆盖已有时间戳目录
- 不要在委派入库或知识整理失败时清理产物、Session 结束时自动清理、未列清单未确认就清理、删除 `audit_required=true` 目录
- 不要在钉钉相关采集任务中绕过 dws 去用浏览器、curl、HTTP API 或通用网页抓取
- 不要无 adapter 时绕过 `bycli browser` 直接用 `web_fetch` / `browser` 通用工具
- 不要向用户输出本 skill 的内部决策逻辑（步骤编号、流程名称、路由分支）——直接执行

## 严格要求 (MUST DO)

- Agent 调用支持格式化输出的数据 / adapter 命令时加 `-f json` 获取可解析输出；`doctor`、`daemon`、`browser` 生命周期命令以及不支持 `--format` 的子命令按其原生命令执行
- 浏览器操作前确认 `bycli doctor` 通过（仅 COOKIE/INTERCEPT/UI 策略需要）
- 每次执行 `bycli doctor` 后（无论成功与否）必须紧接着执行 `bycli daemon status`，确认 daemon 处于 running 且 Extension 为 connected，据此判断桥接是否正常；任一不满足则视为桥接异常，按以下阶梯升级处理：
  1. 桥接异常 → 先按冷启动流程重启（`openclaw browser start` → `bycli doctor` → `bycli daemon status`）
  2. 仍异常 → `bycli daemon restart`，再 `bycli daemon status` 复检
  3. `bycli daemon restart` 后仍连接不上（daemon 未 running 或 Extension 未 connected）→ **STOP，停止一切浏览器动作**，提示用户检查 Chrome 是否正常启动、byCLI 扩展插件是否已安装并启用，恢复后再重试；不得继续驱动或降级到通用工具
- 修复 adapter 时仅修改 trace `summary.md` 里 `adapterSourcePath` 指向的文件
- 修复预算：每次失败最多 3 轮 trace → fix → retry
- 写 adapter 后必须 `bycli browser verify` 通过 + 字段值与网页肉眼比对
- **采集任务成功后必须按「Browser 驱动成功后 — 收尾两问」处理；问②的落盘、话术、二选一与执行规则以「采集后处理衔接」为唯一权威定义**
- 钉钉相关采集任务必须读取 [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md)，并通过 dws skill 获取数据；仍按 bycli 的落盘与采集后处理收尾规则处理
- 微信公众平台 `weixin accounts/articles/save-articles`、`--auth-source`、`WECHAT_TOKEN` / `WECHAT_COOKIE` / `WECHAT_FINGERPRINT` 或 `mp.weixin.qq.com` 认证失败任务，必须读取 [references/weixin/SKILL.md](./references/weixin/SKILL.md)
- 浏览器 session 结束后执行 cleanup（close tab → stop daemon → stop browser）
- Login/Auth/人工验证页面例外：不关闭 session、TAB、daemon 或浏览器，报告 session name + URL 给用户并等待用户完成验证

## 意图决策树

| 用户意图 | 工作流 | 参考文件 |
|---------|--------|---------|
| "bycli 有什么命令" / 不知道怎么用 | 基础用法（见下方内联） | — |
| 运行 bycli 命令 / 单次查数据 / 执行操作 | 基础用法 | — |
| 微信公众平台账号搜索、历史文章、批量保存或认证失败 | weixin 认证与凭据 | [references/weixin/SKILL.md](./references/weixin/SKILL.md) |
| 钉钉听记 / 钉钉文档 / 在线表格 / 云盘 / `shanji.dingtalk.com` / `alidocs.dingtalk.com` 采集 | dws 桥接采集 | [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) |
| 驱动浏览器完成一次性任务 / 填表 / 爬数据 | Browser 驱动 | [browser.md](./references/browser.md) |
| bycli 命令报错 / adapter 坏了 / 网站改版 | AutoFix 修复 | [autofix.md](./references/autofix.md) |
| 给新站点写 adapter / 新增命令 | Adapter 编写 | [adapter-author.md](./references/adapter-author.md) |
| 采集成功后处理 / "存到知识库" / "入库" / "知识整理" | 入库进入 bycli 内部 knowledge-ingest 流程；知识整理委派 knowledge-organizer | [knowledge-ingest.md](./references/knowledge-ingest.md) |

关键区分：
- 有现成 adapter → 直接用 `bycli <site> <command>`
- 钉钉相关采集 → bycli 作为唯一入口，按 [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) 加载 dws 获取数据，不走浏览器降级
- 没有 adapter 但需要一次性浏览 / 查询 → Browser 驱动（是否触发复用和采集后处理收尾，按下方收尾条件判断）
- 没有 adapter 且需要复用 → 写新 adapter
- 现有 adapter 报错 → AutoFix
- 已有 Markdown 内容 + 用户说"入库" → 进入 [knowledge-ingest.md](./references/knowledge-ingest.md) 流程
- 已有 Markdown 内容 + 用户说"知识整理" / "整理资料" → 委派 knowledge-organizer skill（知识整理）

收到**搜索 / 采集 / 抓取 / 网站操作 / 入库 / 知识整理**类任务时，先按本决策树路由，未确定路径前不直接调用通用 `web_fetch` / `browser` 工具。本 skill 不匹配时再评估其他 skill（如 `dws`、`knowledge-organizer`），全部不匹配才兜底通用工具。

收到钉钉域名或钉钉产品采集任务时，本 skill 仍是入口；读取 [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) 后加载 dws skill。dws 只负责获取钉钉数据，不接管 bycli 的产物目录、采集后处理询问、knowledge-ingest 流程或 knowledge-organizer 委派。

### 查询 vs 采集边界

| 场景 | 行为 |
|------|------|
| 用户只是让 agent 查一个事实、看一个页面、打开网页、登录、读一篇内容、或执行一次站点操作 | 完成请求即可，不主动问入库或知识整理 |
| 用户明确使用“采集 / 抓取 / 爬取 / 批量获取 / 搜索结果 / 多篇正文 / 存知识库”等意图，或产出结构化多条结果 / 批量正文 | 视为采集任务，成功后先落盘，再按收尾规则询问采集后处理 |
| 用户说“保存文件 / 下载” | 只做本地文件保存，不触发入库或知识整理 |
| 用户说“记住这个” | 不触发 knowledge-ingest 或 knowledge-organizer；按对话记忆或用户指定机制处理 |

### 适配器缺失降级（强制）

`bycli list -f json` 无对应适配器时：

1. 用 `bycli browser` 系列命令完成任务，不跳到通用工具
2. 按下方浏览器生命周期 + [browser.md](./references/browser.md) 规范执行
3. 驱动前先 `bycli doctor` 确认桥接，紧接着 `bycli daemon status` 确认 daemon running + Extension connected
4. 采集任务成功后，按下方「Browser 驱动成功后 — 收尾两问」判断是否需要问①「复用」和问②「处理」

### Browser 驱动成功后 — 收尾两问（按条件不可跳过）

采集任务成功后按条件做收尾两问。两问**触发条件不同**，各自该问必问；单次查数据、读网页、浏览内容或执行站点操作不触发采集后处理询问。

**问题 ①「复用」— 是否保存为 adapter（仅降级驱动时问）：**

触发条件：本次数据通过 `bycli browser` 降级驱动获取（即 `bycli list -f json` 无现成 adapter），且该过程具备明显复用价值（例如同站点同字段会反复获取、步骤稳定、用户明确要以后复用）。已有现成 adapter（直接 `bycli <site> <command>`）或一次性浏览 / 登录 / 单篇阅读则**跳过此问**。

在返回数据的同一轮回复里问：

> 「本次数据是通过浏览器实时驱动获取的。是否把刚才的获取过程保存成一个专用 adapter（适配器）？保存后下次同类请求可直接 `bycli <site> <command>` 快速获取，无需再驱动浏览器。（是 / 否）」

- 用户答**是 / 需要 / 保存 / 可以**等肯定意图 → 进入 [adapter-author.md](./references/adapter-author.md) 流程，把本次驱动过程（站点、命令、抓到的接口 / DOM、字段）沉淀为 adapter（含 verify、原始请求重放、交付，均按该流程 runbook 执行）
- 用户答**否 / 不用 / 跳过** → 不写 adapter

**问题 ②「处理」— 入库 / 知识整理 / 跳过（明确采集任务才问）：**

触发条件：**无论用现成 adapter 还是降级驱动**，只要本次是明确采集任务，或产出了结构化多条结果 / 批量正文，就问。问②的落盘时机、用户话术、入库 / 知识整理二选一和执行规则只看「采集后处理衔接」，此处不重复定义。

**强制约束：**

- 问①与问②相互独立：①问「过程要不要复用」（仅有复用价值的降级驱动），②问「采集产物接下来怎么处理」（明确采集任务或批量结果）。二者互不替代，也不互为前提
- 当本次是有复用价值的降级驱动且也是采集任务时，①②**都要问**，顺序先①后②，不得问了一个省另一个
- 当本次用现成 adapter 且符合采集边界时，只问②
- 当本次只是单次查询、读网页、浏览内容、登录或一次性站点操作时，①②都跳过
- 都不自动执行，必须等用户对每一问分别答复后才进入对应流程
- 不向用户暴露本收尾的内部触发条件（步骤编号、流程名）

### 入库 / 知识整理 — 所有权边界（最高优先级）

本节只定义所有权，不重复定义问②话术和触发条件；问②一律以「采集后处理衔接」为准。

- **入库**：由 bycli 内部 [knowledge-ingest.md](./references/knowledge-ingest.md) 流程编排，并由该流程调用 by-knowledge-manager 执行底层 upload/build。
- **知识整理**：由 knowledge-organizer skill（知识整理）执行。
- **互斥规则**：入库和知识整理只能二选一；若用户同时要求两者，先让用户选择其中一个。

不是 bycli 采集收尾、而是用户拿已有内容直接请求入库或知识整理时，也按上述所有权边界处理。

## 基础用法

### 安装

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

命令失败时加 `--trace retain-on-failure` 重跑，读取 trace `summary.md`，进入 AutoFix 流程。

## 错误处理

| 错误类型 | Agent 行为 |
|---------|-----------|
| AUTH_REQUIRED (exit 77) | STOP，提示用户登录 |
| BROWSER_CONNECT (exit 69) | STOP，运行 `bycli doctor` + `bycli daemon status` 诊断；`bycli daemon restart` 后仍连不上则停止一切动作，提示用户检查 Chrome 与 byCLI 扩展插件是否正常启动 |
| CAPTCHA / 限流 / 环境验证 | STOP，不是 adapter 问题；保持当前 TAB、daemon 和浏览器，等待用户完成验证 |
| SELECTOR / EMPTY_RESULT / API_ERROR | 进入 AutoFix 流程 |
| TIMEOUT / PAGE_CHANGED | 进入 AutoFix 流程 |
| 3 轮修复仍失败 | 报告尝试过的方法，停止 |
| 站点大改需要重写 | 转 Adapter 编写流程 |

## 浏览器生命周期（OpenClaw 托管环境）

在 OpenClaw 托管环境中，浏览器进程由三个独立组件管理：

| 组件 | 归属 | 控制方式 |
|------|------|---------|
| Chromium 进程树 | OpenClaw browser plugin | `openclaw browser --browser-profile openclaw start/stop/status` |
| byCLI Browser Bridge daemon (port 19825) | `bycli` 自身 | `bycli daemon start/restart/stop` |
| Browser tab lease (CDP target) | `bycli` session name | `bycli browser <sess> open/close` |
| Extension 握手 | 两侧都需要 | `bycli doctor` 检查 |

### 冷启动

```bash
openclaw browser --browser-profile openclaw start
bycli doctor
bycli daemon status                # doctor 后必跑：确认 daemon running + Extension connected
bycli browser <session> open <url>
bycli browser <session> state
```

注意：`bycli browser <sess> open` 是 CDP 客户端，不能冷启动 Chromium。未运行时报 `Browser profile "<id>" is not connected`，必须先 `openclaw browser start`。

### 关闭流程（非登录页）

何时执行三层关闭（以下条件**同时满足**）：

1. 当前浏览器任务链已完成（数据已获取 / 操作已完成）
2. 当前页面**不是** login/SSO/MFA 页面
3. 没有后续操作需要复用同一 session

何时不关闭：

- 页面仍在 login/SSO/MFA → 保持 session，报告 session name + URL
- 用户后续任务明确需要继续使用同一浏览器上下文
- 多步操作未完成（如「采集多页 → 入库」是连续动作，中间不关）

关闭粒度：

| 场景 | 操作 |
|------|------|
| 单次任务完成，无后续 | 三层全关（下方流程） |
| 任务完成但可能继续操作同站点 | 仅 `browser close` 释放 tab，保留 daemon + Chromium |
| 异常 / 卡死 | Kill-all-Chrome（见下方） |

三层关闭，顺序重要：

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
- 只有 `openclaw browser stop` 才能真正释放 Chromium 进程

### Login/Auth/人工验证页面例外

页面仍在 login/SSO/MFA、CAPTCHA、反爬或环境验证状态时，**不执行任何关闭、跳转或重试操作**。保持当前 session、TAB、daemon 与浏览器存活，向用户报告 session name + URL，并等待用户亲自完成验证和明确确认。

### Kill-all-Chrome

```bash
bycli browser <sess> close 2>/dev/null || true
bycli daemon stop           2>/dev/null || true
openclaw browser --browser-profile openclaw stop
pkill -f chromium 2>/dev/null || true
```

## 采集后处理衔接（强制）

本章节是「收尾两问」中**问②（采集后处理）的权威定义**——无论用现成 adapter 还是降级驱动，只要本次符合「查询 vs 采集边界」中的采集任务条件，就按此执行，问②不在别处重复询问。入库的**执行**由 bycli 内部 [knowledge-ingest.md](./references/knowledge-ingest.md) 流程负责；知识整理的**执行**由 knowledge-organizer skill（知识整理）负责。本 skill 只做「落盘 + 询问 + 进入对应流程」。

### 1. 自动落盘（采集完成时立即执行，无需等用户确认）

- 将采集结果完整内容（Markdown 正文 + 元数据）自动落盘到会话目录，**最多落盘 10 篇**
- 同时写入 `bycli-output.json`（含全部结果索引，包括未落盘文章的标题 / URL）
- 落盘后向用户展示采集摘要并询问：

> 「本次成功采集到 X 条数据（已预存 N 篇正文），接下来如何处理？（入库 / 知识整理 / 跳过；入库和知识整理只能二选一；可指定全部、部分或前 N 篇；如选择入库且已知目标知识库 resource-id 和目录路径，也可以一并提供）」

### 2. 用户选择处理动作后 → 进入对应流程

- **入库** → 进入 [knowledge-ingest.md](./references/knowledge-ingest.md) 流程，把用户选择范围内的已落盘 Markdown / 支持的文档文件路径交给该流程；目标知识库 `resource-id`、目录路径、归一化、补采、上传、构建和清理按该流程执行
- **知识整理** → 委派 knowledge-organizer skill（知识整理），把用户选择范围内的已落盘 Markdown / 支持的文档文件路径交给它；整理、拆分、gbrain 写入、对象打标等按该 skill 的规则执行
- 入库和知识整理是互斥处理动作；如果用户同时要求两者，先让用户选择其中一个，不自动排序、不组合执行
- **已落盘文章** → 后续 skill 直接使用落盘文件，不重新采集
- **超出 10 篇的剩余文章** → 委派前先按用户选择范围逐篇补采正文并追加落盘，再交给对应 skill
- 处理范围以用户选择为准（全部 / 指定篇目 / 仅前 N 篇）

### 3. 用户拒绝 / 跳过

- 返回采集结果，已落盘产物保留（不主动删除）
- 用户后续可再发起入库或知识整理，届时直接复用已落盘文件 + 按需补采剩余

### 禁止

- 本 skill 不在主文档内联执行知识库管理细节（选库 / 归一化 / upload / build / 清理一律走 [knowledge-ingest.md](./references/knowledge-ingest.md) 和 `bycli/scripts/bycli-markdown-ingest.mjs`）
- 本 skill 不内联执行知识整理步骤（gbrain 写入 / 文档拆分 / 对象打标一律走 knowledge-organizer）
- 自动落盘超过 10 篇正文（控制磁盘占用，超出部分按需采集）
- 采集完成后不落盘就直接询问入库或知识整理（必须先落盘再询问）

## 采集产物落盘约定（强制）

所有 `bycli` 采集的原始产物**必须**落盘到会话专属目录，严禁落到 `/tmp/`、工作区根目录或 `references/` 同级位置。默认使用 `/by/.sessions`；若本地验证环境中 `/by` 不存在且因只读根文件系统无法创建，则使用工作区内 `.by-sessions` 作为 fallback，并在 `metadata.json` 中写入 `storageFallback=true` 与原因。

### 路径模板

```
/by/.sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

本地验证 fallback：

```
<workspace>/.by-sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

- `<sessionId>`：本会话 ID
- `<collectionRunName>`：本次采集运行名，按采集入口生成：
	  - 浏览器降级驱动：使用 `bycli browser <name> open` 时的 session name
	  - 现成 adapter：使用 `adapter-<site>-<command>`，例如 `adapter-xueqiu-search`
	  - 外部 CLI 透传：使用 `external-<cli>-<command>`，例如 `external-gh-pr-list`
	  - 钉钉桥接采集：使用 `dingtalk-<backend>-<product>-<operation>`，例如 `dingtalk-dws-minutes-transcribe`
- `<YYYYMMDD_HHMMSS>`：本次采集起始时间戳（Asia/Shanghai）

### 必含文件

| 文件 | 说明 |
|------|------|
| `bycli-output.json` | 规范化入参，结构 `{title, url, items:[{title, url, author, publish_time, markdown, fileName}]}` |
| `<fileName>.md` | 原始 Markdown 正文（与 `items[].fileName` 一致） |

### 可选文件

| 文件 | 说明 |
|------|------|
| `search-results.json` | 多结果采集的原始结果快照 |
| `metadata.json` | 来源、点赞 / 评论 / 阅读数、采集时间、策略、session 信息 |
| `pages/<slug>.html` / `pages/<slug>.json` | 原始抓取页（事后回放） |

### 落盘后交给处理技能

```bash
SESSION_DIR=/by/.sessions/<sessionId>/<collectionRunName>/$(date +%Y%m%d_%H%M%S)
mkdir -p "$SESSION_DIR"
# 写入 bycli-output.json 和 .md 文件后，根据用户选择把落盘文件交给对应 skill：
# 入库 -> bycli knowledge-ingest；知识整理 -> knowledge-organizer；两者只能二选一，不组合执行。
# resource-id、directory-path、upload / build、gbrain 写入、拆分、打标等动作由对应流程/skill 执行，本 skill 不内联调用。
```

## 采集产物保留策略

### 生命周期

| 时机 | 行为 |
|------|------|
| 落盘完成 | 保留 |
| 入库成功（knowledge-ingest 调用 by-knowledge-manager 上传并验证后） | 清理该时间戳目录内容（已归档至知识库） |
| 知识整理成功但未入库 | 保留（知识整理不是文件归档） |
| 入库或知识整理失败 | 保留（审计与重试） |
| 用户说"跳过入库" / "跳过知识整理" / "跳过处理" | 保留（后续可再发起） |
| 用户说"保留 / 不清理" | 即使入库成功也保留 |
| Session 结束 | 不主动清理（由会话清理策略统一处理） |

### 用户显式清理

仅在用户**明确说出**清理意图时执行：

1. 列出目标目录下所有时间戳子目录（降序）
2. 按用户指定策略保留（默认保留最近 10 次）
3. `audit_required=true` 的目录不可删
4. 清理前列清单二次确认
5. 只删目录内容，不删目录本身

## 详细参考（按需读取）

| 文件 | 何时加载 |
|------|---------|
| [references/browser.md](./references/browser.md) | 需要浏览器驱动命令参考时 |
| [references/dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) | 钉钉域名或钉钉产品数据采集，需要通过 dws 并按 bycli 流程落盘时 |
| [references/weixin/SKILL.md](./references/weixin/SKILL.md) | 运行 `weixin accounts/articles/save-articles`、选择 `--auth-source`、处理微信 token/Cookie/fingerprint 或 `AUTH_REQUIRED` 时 |
| [references/knowledge-ingest.md](./references/knowledge-ingest.md) | 采集后用户选择"入库"，或已有 bycli 采集产物请求入库时 |
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
- 不要在用户只是浏览内容、单次查询、登录或一次性站点操作时自动触发入库或知识整理——只有明确采集任务或批量结构化结果成功后才主动问一次，并按用户二选一结果进入 knowledge-ingest 或委派 knowledge-organizer。
