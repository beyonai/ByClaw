---
name: bycli
description: Use when the user asks to run bycli, query bycli usage, drive a browser, operate a website, repair or write adapters, or perform web search, scraping, crawling, structured data collection, DingTalk, WeCom, or Feishu data collection, login-assisted browsing, or open-URL tasks.
allowed-tools: Bash(bycli:*), Bash(dws:*), Bash(wecom-cli:*), Bash(lark-cli:*), Bash(openclaw browser:*), Bash(gh:*), Bash(node:*), Read, Edit, Write, Grep
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

# byCLI

byCLI 将网站、Electron 应用和外部 CLI 统一为 `bycli <site> <command>` 接口。本 skill 是唯一入口：先按本文件路由，再按需读取 references；不要向用户输出内部步骤编号或路由名称。

常见触发词包括：`bycli`、浏览器操作、打开 URL、登录、搜索、查找、采集、抓取、爬取、写/修复 adapter、`browser open`、`autofix`，以及钉钉、企业微信、飞书、微信公众平台相关任务。

## 先记住的优先级

规则冲突时按以下顺序处理：

1. 用户明确的当前操作范围和安全边界
2. 微信公众平台任务的 [references/weixin/SKILL.md](./references/weixin/SKILL.md)
3. 本文件的 STOP / 认证 / 浏览器生命周期规则
4. 对应 workflow reference（browser、bridge、autofix、adapter 等）

任何命令返回认证、人工验证、桥接不可用或安全相关 STOP 条件时，停止当前 workflow，不为“补充信息”自行扩大操作范围。

## 硬规则

### 1. 路由与命令边界

- 除钉钉、企业微信、飞书 connector bridge 外，网页读取、搜索、采集、抓取、网站操作和打开 URL 任务必须先执行 `bycli list -f json` 动态发现能力；不得硬编码 adapter 列表。
- 有现成 adapter 时，直接调用 `bycli <site> <command>`；即使 adapter 内部使用浏览器，也不得改用 raw `bycli browser` 或通用网页工具预检、接管或替代。
- 没有 adapter 的一次性浏览或查询才使用 raw `bycli browser`；有复用价值时才进入新 adapter 流程。
- 钉钉任务必须读取 [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) 并通过 dws；企业微信必须读取 [wecom-wecomcli-bridge.md](./references/wecom-wecomcli-bridge.md) 并通过 `wecom-cli`；飞书必须读取 [feishu-fws-bridge.md](./references/feishu-fws-bridge.md) 并通过 fws / `lark-cli`。
- 禁止用 `web_fetch`、通用 `browser`、`curl`、`wget`、`requests` 或其他直接 HTTP 客户端绕过 byCLI；只有 byCLI 或对应 connector 明确报告无法执行，且用户确认后，才可使用替代工具。
- 支持格式化输出的数据 / adapter 命令使用 `-f json`；`doctor`、`daemon`、`browser` 生命周期命令和不支持 `--format` 的子命令使用原生命令格式。
- 不要把动态站点命令列表粘贴进计划或长期文档；实际能力以 `bycli list -f json` 和 `bycli <site> --help` 为准。

### 2. 浏览器和页面安全

- `bycli browser <session> open`、`state`、`tab list` 都不是冷启动、桥接健康检查或 adapter 预热命令；它们可能申请 TAB lease。
- `browser` 与 `adapter` 是不同 surface；不得用同名 browser session 检查或操作 adapter 打开的 TAB，也不得用 raw browser 预检 adapter 登录状态。
- 不在 `browser eval` 中执行 `submit` / `click` / `navigate` 等写操作；使用 `click`、`type`、`select` 等结构化命令。
- 页面变化后不得复用 numeric ref；重新获取 `state` / `find` 结果。
- 不在 browser 命令中硬编码 CSS selector；按 [references/browser.md](./references/browser.md) 使用实时 ref 和 target contract。
- 不确定 TAB 目标时停止并请用户确认；不得猜测后导航、自动换 session 或新建 TAB。

### 3. 认证、人工验证和 STOP

以下情况不修改 adapter、不自动降级、不重试：

- `AUTH_REQUIRED`（exit 77）
- `BROWSER_CONNECT`（exit 69）在桥接恢复阶梯失败后
- CAPTCHA、限流、反爬、登录 / SSO / MFA、环境验证

命中登录或人工验证状态后，**不得关闭 session、TAB、daemon 或浏览器；不得调用 `state`、`tab list`、`get url`、`extract`、`network` 等补查命令；不得跳转、bind、重试、AutoFix 或重跑 trace**。只使用已经返回的结果：

1. 报告错误类型和已知的 session name。
2. 报告已返回的 URL；若未返回，明确写“URL 未提供”，不得补查。
3. 提示用户亲自完成登录 / 验证，结束本轮，等待用户明确确认后再继续。

Weixin 任务必须优先读取 [references/weixin/SKILL.md](./references/weixin/SKILL.md)，其 `AUTH_REQUIRED`、登录 `TIMEOUT`、CAPTCHA 和环境验证规则覆盖本文件的通用错误处理与 cleanup 规则。

### 4. 代码修改和修复边界

- adapter 修复只修改 trace `summary.md` 中 `adapterSourcePath` 指向的文件。
- 修复 adapter 时不得修改 `src/`、`extension/`、`tests/`、`package.json`、`tsconfig.json`，不得放宽 `verify/<cmd>.json` fixture 掩盖失败。
- 不猜测字段含义；字段语义不清时先读取字段参考或进行可验证的解码。
- 不从失败 adapter 默默 fallback 到手写 `fetch`；先按 [references/autofix.md](./references/autofix.md) 采集 trace。
- 每次失败最多 3 轮 `trace → fix → retry`；写 adapter 后必须 `bycli browser verify` 通过，并将字段值与网页实际内容比对。
- 临时 dump 不得留在 repo 根目录或 `clis/<site>/`，不得创建 `.dbg-*.html` / `raw-*.json`。

### 5. 凭据、产物和清理

- 不把 token、SESSION、Cookie、凭据写入技能文件、命令参数或对话回复。
- 采集原始产物必须落到会话专属目录，不得落到 `/tmp/`、工作区根目录或 `references/` 同级位置；不得覆盖已有时间戳目录。
- 不在 session 结束时自动清理，不在未列清单和未确认时清理，不删除 `audit_required=true` 目录。
- 只有明确采集任务或批量结构化结果成功后，才落盘并询问“入库 / 知识整理 / 跳过”；单次查询、读网页、登录或一次性站点操作不触发该询问。
- 入库和知识整理只能二选一；具体上传、构建、清理和知识整理步骤分别交给对应 reference / skill，不在本文件展开。

## 意图路由

| 用户意图 | 入口行为 | 继续读取 |
|---|---|---|
| 查询 bycli 用法、运行一次命令、单次查数据 | `bycli list -f json` 或按已知命令执行 | 本文件“基础用法” |
| 微信公众平台账号 / 文章 / 保存 / 下载 / 认证 | 先识别为 Weixin 专属流程 | [weixin/SKILL.md](./references/weixin/SKILL.md) |
| 钉钉听记、文档、表格、云盘 | 不走浏览器，使用 dws bridge | [dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) |
| 企业微信文档、表格、智能文档、消息 | 不走浏览器，使用 `wecom-cli` bridge | [wecom-wecomcli-bridge.md](./references/wecom-wecomcli-bridge.md) |
| 飞书妙记、文档、表格、Base、消息 | 不走浏览器，使用 fws / `lark-cli` bridge | [feishu-fws-bridge.md](./references/feishu-fws-bridge.md) |
| 没有 adapter 的一次性浏览、填表、抓取 | 进入 raw browser workflow | [browser.md](./references/browser.md) |
| 现有 adapter 报错、网站改版 | 进入 AutoFix，不先改代码 | [autofix.md](./references/autofix.md) |
| 新站点 / 新命令 / 明确要求复用 | 进入 adapter 编写流程 | [adapter-author.md](./references/adapter-author.md) |
| 已有 Markdown 内容请求入库 | 直接交给 knowledge-ingest | [knowledge-ingest.md](./references/knowledge-ingest.md) |
| 已有内容请求知识整理 | 委派 knowledge-organizer，不执行入库 | 对应 knowledge-organizer skill |

### 查询与采集边界

| 场景 | 行为 |
|---|---|
| 查一个事实、看一个页面、打开网页、登录、读一篇内容、一次站点操作 | 完成请求，不主动问入库或知识整理 |
| “采集 / 抓取 / 爬取 / 批量获取 / 搜索结果 / 多篇正文 / 存知识库”，或结构化多条结果 / 批量正文 | 视为采集任务：成功后先落盘，再问处理动作 |
| “保存文件 / 下载” | 只做本地文件保存，不触发知识处理询问 |
| “记住这个” | 按对话记忆或用户指定机制处理，不触发 knowledge-ingest / knowledge-organizer |

## 基础用法

```bash
npm install -g @sovovs/bycli    # 需要 Node >= 21
bycli list -f json                 # 动态发现可用站点和命令
bycli <site> --help                # 查看站点命令
bycli <site> <command> --help      # 查看参数
bycli <site> <command> -f json     # 执行数据 / adapter 命令
bycli doctor                       # COOKIE / INTERCEPT / UI 策略的桥接检查
bycli daemon status                # 每次 doctor 后紧接执行
```

策略要求：`PUBLIC` / `LOCAL` 不需要浏览器；`COOKIE` / `INTERCEPT` / `UI` 需要 Chrome 登录态和 byCLI Extension，`INTERCEPT` 还需要自动化窗口捕获签名请求。

外部 CLI 透传示例：

```bash
bycli external install gh
bycli gh pr list --limit 5
```

## 浏览器生命周期

### 1. 冷启动和桥接检查

浏览器由 Chromium、byCLI daemon、TAB lease 和 Extension 握手四层组成。浏览器操作前（仅 COOKIE / INTERCEPT / UI 策略）执行：

```bash
openclaw browser --browser-profile openclaw status
# 只有 status 明确显示浏览器未运行时才执行：
/usr/local/bin/start-chrome.sh
bycli doctor
bycli daemon status
```

每次 `bycli doctor` 后，无论成功与否，必须紧接 `bycli daemon status`。daemon 必须 running 且 Extension 必须 connected；否则按以下阶梯：

1. 先检查 OpenClaw browser status；只有未运行才冷启动，再 `doctor → daemon status` 复检。
2. 仍异常时执行一次 `bycli daemon restart`，再 `bycli daemon status`。
3. 仍未连接时 STOP：提示用户检查 Chrome 和 byCLI Extension，停止一切浏览器动作，不降级到通用工具。

冷启动不包含 `bycli browser open` / `state` / `tab list`，浏览器已运行时不得重复执行启动脚本。

### 2. TAB 分流

| 目标 | 行为 |
|---|---|
| 有现成 adapter | 直接调用 adapter，不先调用 `bycli browser ...` |
| 继续 raw browser session | 先 `tab list`；选定目标后，后续命令都带 `--tab <page>` |
| 接管用户前台 TAB | 保持目标页前台，执行 `bind`，不使用 `open` 覆盖 |
| 需要导航 raw TAB | 仅在明确需要目标 URL 时 `open <url> --tab <page>`，不换 session |
| 需要 DOM 交互 | 页面已到目标 URL 后，用 `state` 或更小范围的 `find` 获取实时 ref |
| 非 DOM 读取 | 直接使用 `get url` / `extract` / `network`，不额外追加 `state` |

TAB 约束：同名 session 只有在相同 surface、browser context 和存活 lease 下才指向同一 TAB；`tab list` 只查看 browser surface，不能判断 adapter TAB；多个候选 TAB 无法唯一确定时停止并请用户确认；`bind` 或 target 失效时报告原始错误，不去掉 `--tab`、换 session 或循环 `open/state`。

### 3. 关闭和异常

仅当任务完成、当前页不是登录 / 验证 / CAPTCHA / 反爬页面且没有后续复用需求时关闭：

```bash
bycli browser <session> close
bycli daemon stop
openclaw browser --browser-profile openclaw stop
```

如果可能继续操作同站点，只执行 `browser close`，保留 daemon 和 Chromium。异常或卡死才使用 Kill-all-Chrome：

```bash
bycli browser <session> close 2>/dev/null || true
bycli daemon stop 2>/dev/null || true
openclaw browser --browser-profile openclaw stop
pkill -f chromium 2>/dev/null || true
```

登录 / SSO / MFA、CAPTCHA、反爬或环境验证页面遵循上方“认证、人工验证和 STOP”，绝不因 cleanup 规则关闭或补查。

## 错误分流

| 返回或症状 | 行为 |
|---|---|
| Weixin `AUTH_REQUIRED`、登录 `TIMEOUT`、CAPTCHA、环境验证 | 读取 [weixin/SKILL.md](./references/weixin/SKILL.md)，按其规则 STOP |
| 非 Weixin `AUTH_REQUIRED` (77) | STOP，保持资源存活；报告已知 session / URL，URL 缺失写“URL 未提供”；不得补查、重试或 AutoFix |
| `BROWSER_CONNECT` (69) | 按桥接恢复阶梯执行；复检仍失败后 STOP，不执行 `browser open/state` |
| 非 Weixin CAPTCHA / 限流 / 反爬 / 环境验证 | STOP，不修改 adapter，保持当前 TAB、daemon、浏览器 |
| `SELECTOR` / `EMPTY_RESULT` / `API_ERROR` | 读取 [autofix.md](./references/autofix.md) 进入 AutoFix |
| `TIMEOUT` / `PAGE_CHANGED` | 进入 AutoFix；Weixin 登录 `TIMEOUT` 除外 |
| 3 轮修复仍失败 | 报告已尝试方法并停止 |
| 站点大改、现有 adapter 不适合继续修补 | 进入 [adapter-author.md](./references/adapter-author.md) |

### `AUTH_REQUIRED` 正误示例

❌ 错误：命令返回 `AUTH_REQUIRED (77)` 后调用 `bycli browser <session> get url`、`state` 或 `tab list` 补查。

✅ 正确：若结果已知 session 为 `grand-prairie` 且没有 URL，回复“session grand-prairie 收到 AUTH_REQUIRED；URL 未提供。请完成登录后明确告诉我”，保持 session、TAB、daemon 和浏览器存活并结束本轮。

## 采集成功后的收尾

### 收尾问题

两问独立，只有满足条件才问：

1. **是否保存 adapter？** 仅当本次使用 raw browser 降级且具备明显复用价值时问；现成 adapter、一次性浏览、登录和单篇阅读跳过。
2. **如何处理采集产物？** 只要是明确采集任务或结构化多条结果 / 批量正文就问；选项为“入库 / 知识整理 / 跳过”。

若两问都触发，先问 adapter 再问处理；不自动执行任一动作。adapter 问题的肯定回答进入 [adapter-author.md](./references/adapter-author.md)。connector bridge 任务不询问保存 adapter。

处理问题固定话术：

> 本次成功采集到 X 条数据（已预存 N 篇正文），接下来如何处理？（入库 / 知识整理 / 跳过；入库和知识整理只能二选一；可指定全部、部分或前 N 篇；如选择入库且已知目标知识库 resource-id 和目录路径，也可以一并提供）

### 自动落盘

采集完成后、询问处理前，必须先落盘：

- 所有采集原始产物放入会话专属目录，默认 `/by/.sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/`；本地无法创建 `/by` 时使用 `<workspace>/.by-sessions/...`，并在 `metadata.json` 写入 `storageFallback=true` 和原因。
- 最多自动落盘 10 篇正文；其余文章只有在用户选择范围包含它们时按需补采。
- 每篇 Markdown 开头必须有 `bycli_filter` YAML front matter。条件来自用户明确给出的检索词、筛选参数和限定；没有明确条件时写 `bycli_filter: []`，不得从标题、标签或排序推断。已有 front matter 只能合并更新，不得创建第二段。
- 同时写入 `bycli-output.json`，包含全部结果索引（包括未落盘正文的标题 / URL）。

`<collectionRunName>` 按入口生成：浏览器降级使用 session name；adapter 使用 `adapter-<site>-<command>`；外部 CLI 使用 `external-<cli>-<command>`；钉钉 bridge 使用 `dingtalk-<backend>-<product>-<operation>`。

必含文件：

| 文件 | 约定 |
|---|---|
| `bycli-output.json` | `{title, url, items:[{title, url, author, publish_time, markdown, fileName}]}` |
| `<fileName>.md` | 原始正文，开头包含 `bycli_filter` |

可选文件：`search-results.json`、记录来源 / 指标 / 策略 / session / filter 的 `metadata.json`、以及 `pages/<slug>.html` / `pages/<slug>.json`。

### 处理动作与保留

- **入库**：把用户选择范围内的落盘文件交给 [knowledge-ingest.md](./references/knowledge-ingest.md)；它负责归一化、补采、上传、构建和清理。
- **知识整理**：把落盘文件交给 knowledge-organizer；不执行入库。
- 两者互斥；用户同时要求时先让用户选择，不自动排序或组合。
- 已落盘文件优先复用，不重新采集；超出 10 篇的正文按用户范围逐篇补采、写入 front matter 后再交给对应流程。
- 用户跳过或拒绝时返回结果并保留产物。

保留策略：落盘后保留；入库成功且用户未要求保留时可由 knowledge-ingest 清理已归档时间戳目录；知识整理成功、任一处理失败、用户跳过或明确要求保留时均保留；session 结束不主动清理。

用户明确要求清理时，先列出目标时间戳目录（降序），默认保留最近 10 次，`audit_required=true` 不可删，二次确认后只删目录内容、不删目录本身。

## 结果展示

- 搜索、列表、排行、文章和采集结果中，凡返回非空 `url` 的展示项都必须提供可点击 Markdown 链接，优先 `[title](url)`；只展示前 N 条时每条仍保留链接。
- 只有后端确实没有返回 `url` 时才可不展示，并明确注明未返回链接；不得猜造、拼接或替换 URL。
- 发送前逐项检查已展示结果：有非空 URL 就必须有可点击链接。

## 按需读取的详细参考

| 参考 | 何时读取 |
|---|---|
| [references/browser.md](./references/browser.md) | raw browser 命令、target contract、表单、extract、network |
| [references/weixin/SKILL.md](./references/weixin/SKILL.md) | 微信公众平台、微信凭据、微信认证 / 验证 |
| [references/dingtalk-dws-bridge.md](./references/dingtalk-dws-bridge.md) | 钉钉产品或域名采集 |
| [references/wecom-wecomcli-bridge.md](./references/wecom-wecomcli-bridge.md) | 企业微信产品或域名采集 |
| [references/feishu-fws-bridge.md](./references/feishu-fws-bridge.md) | 飞书产品或域名采集 |
| [references/autofix.md](./references/autofix.md) | adapter 报错、trace、修复和验证 |
| [references/adapter-author.md](./references/adapter-author.md) | 新 adapter / 新命令 |
| [references/adapter-template.md](./references/adapter-template.md) | adapter 文件结构和 verify fixture |
| [references/api-discovery.md](./references/api-discovery.md) | adapter API 发现 |
| [references/site-recon.md](./references/site-recon.md) | 新站点侦察 |
| [references/coverage-matrix.md](./references/coverage-matrix.md) | 动手前能力自测 |
| [references/field-conventions.md](./references/field-conventions.md) | 已知字段代号 |
| [references/field-decode-playbook.md](./references/field-decode-playbook.md) | 字段解码 |
| [references/output-design.md](./references/output-design.md) | columns 命名、类型和顺序 |
| [references/site-memory.md](./references/site-memory.md) | 站点记忆 |
| [references/success-rate-pitfalls.md](./references/success-rate-pitfalls.md) | 静默失败陷阱 |
| [references/jsdom-fixture-pattern.md](./references/jsdom-fixture-pattern.md) | JSDOM extractor 测试 |
| [references/typed-errors.md](./references/typed-errors.md) | typed error 规范 |

不要把上述详细 reference 的实现步骤复制回主 skill；主 skill 只负责入口、优先级、STOP 条件、生命周期和交接边界。
