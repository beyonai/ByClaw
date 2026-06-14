---
name: bycli
description: byCLI 全能力 skill — 统一管理 bycli 命令执行、浏览器驱动、适配器自修复、适配器编写、Markdown 入库。当用户需要运行 bycli 命令、驱动浏览器完成任务、修复失败的 adapter、编写新 adapter、查询 bycli 用法、将内容存入知识库，或发起搜索 / 采集 / 抓取 / 爬取 / 网站操作类任务时使用。触发短语："bycli"、"浏览器操作"、"adapter 坏了"、"写个 adapter"、"爬取数据"、"修复命令"、"browser open"、"autofix"、"open cli"、"驱动浏览器"、"写爬虫"、"browser driving"、"fix adapter"、"write adapter"、"搜索"、"查找"、"采集"、"抓取"、"爬取"、"获取"、"打开网站"、"访问网页"、"登录"、"操作网站"、"scrape"、"crawl"、"browse"、"open URL"、"存到知识库"、"入库"、"导入知识库"、"保存到知识库"、"沉淀到知识库"、"收藏到知识库"、"归档"。
cli_version: ">=1.0.15"
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
    primaryEnv: BE_SERVER_PORT
---

# byCLI Skill

byCLI skill 封装 byCLI —— byCLI 把任意网站、Electron 桌面应用或外部 CLI 统一为 `bycli <site> <command>` 接口，agent 无需 screen-scraping 即可驱动。

本 skill 是唯一入口——根据意图路由到对应工作流，详细参考按需加载。

## 严格禁止 (NEVER DO)

- 不要硬编码 adapter 列表，始终用 `bycli list -f json` 动态发现
- 不要在 `browser eval` 中执行写操作（submit/click/navigate），用 `click`/`type`/`select` 结构化命令
- 不要跨页面复用 numeric ref，页面变化后必须 re-`state`
- 不要在修复 adapter 时修改 `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`
- 不要放宽 `verify/<cmd>.json` fixture 来掩盖失败——修 adapter 让输出正确
- 不要猜测字段含义——猜错了 verify 通过但数据是错的
- 不要在 repo 根目录 / `clis/<site>/` 留临时 dump 文件（`.dbg-*.html` / `raw-*.json`）
- AUTH_REQUIRED（exit 77）/ BROWSER_CONNECT（exit 69）/ CAPTCHA / 限流 → 不修改代码，报告用户
- 不要绕过入库脚本手写 `curl`、`fetch` 或自行拼签名头
- 不要把 token、SESSION、Cookie、Beyond-Token、签名盐写入技能文件、命令参数或对话回复
- 不要在用户未明确表达入库意图时主动建议入库
- 不要采集成功后不主动询问是否入库，也不要采集完不落盘就询问
- 不要把采集产物落到 `/tmp/` 或工作区根目录，不要让入参与正文分在不同目录，不要覆盖已有时间戳目录
- 不要在入库失败时清理产物、Session 结束时自动清理、未列清单未确认就清理、删除 `audit_required=true` 目录
- 不要无 adapter 时绕过 `bycli browser` 直接用 `web_fetch` / `browser` 通用工具
- 不要向用户输出本 skill 的内部决策逻辑（步骤编号、流程名称、路由分支）——直接执行

## 严格要求 (MUST DO)

- Agent 调用 bycli 时始终加 `-f json` 获取可解析输出
- 浏览器操作前确认 `bycli doctor` 通过（仅 COOKIE/INTERCEPT/UI 策略需要）
- 每次执行 `bycli doctor` 后（无论成功与否）必须紧接着执行 `bycli daemon status`，确认 daemon 处于 running 且 Extension 为 connected，据此判断桥接是否正常；任一不满足则视为桥接异常，按冷启动 / `bycli daemon restart` 处理或报告用户
- 修复 adapter 时仅修改 trace `summary.md` 里 `adapterSourcePath` 指向的文件
- 修复预算：每次失败最多 3 轮 trace → fix → retry
- 写 adapter 后必须 `bycli browser verify` 通过 + 字段值与网页肉眼比对
- 浏览器 session 结束后执行 cleanup（close tab → stop daemon → stop browser）
- Login/Auth 页面例外：不关闭 session，报告 session name + URL 给用户
- 入库必须通过 `node scripts/bycli-markdown-ingest.mjs` 执行，不得旁路
- 入库前必须先 `list-kb` 查询知识库并让用户选择目标
- 对用户展示入库摘要并获得确认后再执行真实 `ingest`

## 意图决策树

| 用户意图 | 工作流 | 参考文件 |
|---------|--------|---------|
| "bycli 有什么命令" / 不知道怎么用 | 基础用法（见下方内联） | — |
| 运行 bycli 命令 / 查数据 / 执行操作 | 基础用法 | — |
| 驱动浏览器完成一次性任务 / 填表 / 爬数据 | Browser 驱动 | [browser.md](./references/browser.md) |
| bycli 命令报错 / adapter 坏了 / 网站改版 | AutoFix 修复 | [autofix.md](./references/autofix.md) |
| 给新站点写 adapter / 新增命令 | Adapter 编写 | [adapter-author.md](./references/adapter-author.md) |
| "存到知识库" / "入库" / "导入知识库" / "沉淀" | Markdown 入库 | [markdown-ingestion.md](./references/markdown-ingestion.md) |

关键区分：
- 有现成 adapter → 直接用 `bycli <site> <command>`
- 没有 adapter 但需要一次性数据 → Browser 驱动
- 没有 adapter 且需要复用 → 写新 adapter
- 现有 adapter 报错 → AutoFix
- 已有 Markdown 内容 + 用户说"入库" → Markdown 入库

收到**搜索 / 采集 / 抓取 / 网站操作 / 入库**类任务时，先按本决策树路由，未确定路径前不直接调用通用 `web_fetch` / `browser` 工具。本 skill 不匹配时再评估其他 skill（如 `dws`），全部不匹配才兜底通用工具。

### 适配器缺失降级（强制）

`bycli list -f json` 无对应适配器时：

1. 用 `bycli browser` 系列命令完成任务，不跳到通用工具
2. 按下方浏览器生命周期 + [browser.md](./references/browser.md) 规范执行
3. 驱动前先 `bycli doctor` 确认桥接，紧接着 `bycli daemon status` 确认 daemon running + Extension connected
4. 任务结束后可建议用户「是否编写专用适配器」（仅建议，不自动执行）

### Markdown 入库 — 触发边界（最高优先级）

仅在用户**明确表达入库意图**时进入此工作流。以下情况**不触发**：

- 用户只是在查数据/读网页/浏览内容——即使刚用 bycli 获取了 Markdown，也不自动入库
- 用户说"保存文件"/"下载"——这是本地文件操作，不是知识库入库
- 用户说"记住这个"/"记一下"——这是对话记忆，不是知识库入库
- 没有明确的入库目标表达时，不要主动建议入库

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
| BROWSER_CONNECT (exit 69) | STOP，提示运行 `bycli doctor` + `bycli daemon status` 诊断桥接 |
| CAPTCHA / 限流 | STOP，不是 adapter 问题 |
| SELECTOR / EMPTY_RESULT / API_ERROR | 进入 AutoFix 流程 |
| TIMEOUT / PAGE_CHANGED | 进入 AutoFix 流程 |
| 3 轮修复仍失败 | 报告尝试过的方法，停止 |
| 站点大改需要重写 | 转 Adapter 编写流程 |
| 入库 HTTP 401/403 | 门户登录态不可用，停止入库，提示用户恢复会话 |

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

### Login/Auth 页面例外

页面仍在 login/SSO/MFA 状态时，**不执行任何关闭操作**。保持 session 存活，向用户报告 session name + URL。

### Kill-all-Chrome

```bash
bycli browser <sess> close 2>/dev/null || true
bycli daemon stop           2>/dev/null || true
openclaw browser --browser-profile openclaw stop
pkill -f chromium 2>/dev/null || true
```

## 采集后入库衔接（强制）

bycli 成功采集到数据后：

### 1. 自动落盘（采集完成时立即执行，无需等用户确认）

- 将采集结果完整内容（Markdown 正文 + 元数据）自动落盘到会话目录，**最多落盘 10 篇**
- 同时写入 `bycli-output.json`（含全部结果索引，包括未落盘文章的标题 / URL）
- 落盘后向用户展示采集摘要并询问：

> 「本次成功采集到 X 条数据（已预存 N 篇正文），是否需要保存到您的知识库？（全部 / 部分 / 跳过）」

### 2. 用户确认入库后

- **已落盘文章** → 直接用落盘文件入库，不重新采集
- **超出 10 篇的剩余文章** → 此时再逐篇采集正文并追加落盘，然后一并入库
- 入库范围以用户选择为准（全部 / 指定篇目 / 仅前 N 篇）
- **入库成功后** → 自动删除该时间戳目录下的落盘文件（已归档至知识库，本地无需保留）

### 3. 用户拒绝 / 跳过

- 返回采集结果，已落盘产物保留（不主动删除）
- 用户后续可再发起入库，届时直接复用已落盘文件 + 补采剩余

### 禁止

- 用户未明确同意前执行入库脚本
- 自动落盘超过 10 篇正文（控制磁盘占用，超出部分按需采集）
- 采集完成后不落盘就直接询问入库（必须先落盘再询问）

## 采集产物落盘约定（强制）

所有 `bycli` 采集的原始产物**必须**落盘到会话专属目录，严禁落到 `/tmp/`、工作区根目录或 `references/` 同级位置。

### 路径模板

```
/by/.sessions/<sessionId>/<bycliSessionName>/<YYYYMMDD_HHMMSS>/
```

- `<sessionId>`：本会话 ID
- `<bycliSessionName>`：`bycli browser <name> open` 时使用的 session 名
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

### 调用入库

```bash
SESSION_DIR=/by/.sessions/<sessionId>/<bycliSessionName>/$(date +%Y%m%d_%H%M%S)
mkdir -p "$SESSION_DIR"
# 写入 bycli-output.json 和 .md 文件后：
node scripts/bycli-markdown-ingest.mjs ingest \
  --bycli-json-file "$SESSION_DIR/bycli-output.json" \
  --task-name "生态采集-<source>" \
  --connector-code <source> \
  --source-name "<source>" \
  --source-url "<原文链接>" \
  --knowledge-base-resource-id <resourceId> \
  --knowledge-base-name "<知识库名>"
```

## 采集产物保留策略

### 生命周期

| 时机 | 行为 |
|------|------|
| 落盘完成 | 保留 |
| 入库成功 | 清理该时间戳目录内容（已归档至知识库） |
| 入库失败 | 保留（审计与重试） |
| 用户说"跳过入库" | 保留（后续可再发起） |
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
| [references/autofix.md](./references/autofix.md) | adapter 修复完整流程 |
| [references/adapter-author.md](./references/adapter-author.md) | 写新 adapter 完整流程 |
| [references/markdown-ingestion.md](./references/markdown-ingestion.md) | Markdown 入库完整流程 |
| [references/ingestion-api.md](./references/ingestion-api.md) | 入库接口字段速查 |
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

- 不要把本 skill 的命令列表粘贴到计划中——它会过期。用 `bycli list -f json`。
- 不要假设所有 adapter 都需要浏览器——`PUBLIC`/`LOCAL` 不需要。
- 不要从失败的 adapter 默默 fallback 到手写 `fetch`——先走 `--trace retain-on-failure`。
- 不要在 `bycli browser` 中硬编码 CSS selector——用 `state`/`find` 获取 numeric ref。
- 不要在用户只是浏览内容时自动触发入库——必须有明确入库意图。
