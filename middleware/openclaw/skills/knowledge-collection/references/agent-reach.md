# 公共互联网来源路由（原 By-Reach 路由器）

本文件是采集编排器 `knowledge-collection` 的内置公共互联网路由器 `agent-reach`，取代原先独立的 By-Reach 技能。
任何一次公共互联网取内容前，必须先按本文选定来源执行器，再委派该执行器；**采集编排器自身永不取内容**。

角色固定为：采集编排器 `knowledge-collection`（本技能，含本路由层）、网站执行器 `bycli`、
企业来源执行器 `dws` / `fws` / `wecomcli` / `ima`、直接查询所有者（根 Agent）。
路由层只选择执行器并接收其返回结果，持久化、产物契约与采集交付归采集编排器。
来源执行器不得启动任何下游动作，也不得反向加载 `knowledge-collection`。

## 网页铁律（不可协商）

对**任何网站、网页或 URL** 的打开、读取、站内搜索、采集、抓取或操作，取内容前**必须无条件加载 `bycli` skill**。
公开静态页、服务端渲染页、SPA、raw URL、Markdown、纯文本、无需登录的页面均无例外。

唯一的通用网页读取命令是：

```bash
bycli web read --url <URL> --stdout
```

不得预读、探测，也不得回退到 fetcher、reader proxy、直连 HTTP 客户端、旧适配器、通用浏览器或其他网页工具；
不得使用 `web_fetch`、`curl`、`wget`、`requests`。**byCLI 无法完成时必须停止并报告，不得回退到其他网页获取工具。**
已经用直连拿到内容时该结果作废，按规范流程重新采集。

`knowledge-collection public-discover` 自己负责公共发现的回退、桥接恢复和候选证据落盘。SearXNG 无候选或输出无效时，不得脱离 `public-discover` 手工执行 `bycli <site> search` 补结果；应由命令内置的 `hot_discovery` 回退进入统一恢复链路。其他经路由的 byCLI 命令出现 `BROWSER_CONNECT` 时，必须按已加载的 `bycli` skill 执行托管浏览器状态检查、`/usr/local/bin/start-chrome.sh` 冷启动或标准启动回退、复检与最多一次 daemon restart，不得直接要求用户连接桌面 Chrome。

## 路由表

| 目标 | 首选执行器 | 唯一允许的兜底 |
| --- | --- | --- |
| 通用网页 / URL | `bycli web read --url <URL> --stdout` | 无 |
| Twitter / X | `twitter-cli` | `bycli twitter search` |
| Reddit | `rdt-cli` | `bycli reddit search` |
| Bilibili | `bili-cli` | `bycli bilibili search` |
| YouTube | `yt-dlp` | `bycli youtube search` |
| V2EX | 打包 V2EX API channel | `bycli v2ex hot` |
| Xueqiu | 打包 Xueqiu API channel | `bycli xueqiu search` |
| Facebook / Instagram / LinkedIn / 小红书 | `bycli` | 无 |
| GitHub | `gh` CLI | 无 |
| RSS | `feedparser` | 无 |
| Exa 搜索 | `mcporter` + `exa.web_search_exa` | 无 |
| 小宇宙音频 | `by-reach transcribe` | 无 |

有兜底的行：首选执行器只执行一次。仅当输出失败、为空、呈挑战页形态、畸形或无意义时，**才允许一次 byCLI 兜底**；
该兜底再失败即停止并报告。不得替换为另一种 CLI 或通用网页机制。

首选执行器与 byCLI 兜底的结果必须统一进入同一套 collection contract，不得按执行后端分叉产物协议。

## 只读边界

本路由层是只读的：不得发帖、评论、点赞、认证或以任何方式向公共平台写入。

## 各渠道命令面

### 网页与 RSS

通用网页见上方铁律。RSS（非具体网页读取）可用 `feedparser`：

```python
import feedparser
feedparser.parse("FEED_URL")
```

### 社交与社区

按路由表选一次首选执行器。对具体 URL、页面、帖子或主页的读取一律走 `bycli`，不得替换为另一种 CLI、API 或网页工具。

### 视频与播客

YouTube 首选 `yt-dlp` 提取字幕或媒体元数据；Bilibili 首选 `bili-cli`。
打开或读取视频页面、评论、频道、详情页或 URL 时走 `bycli`，byCLI 失败即停止。

小宇宙音频转写：

```bash
by-reach transcribe "URL" -o /tmp/transcript.txt
```

配置由 `by-reach configure` 写入 `~/.by-reach/`；任务过程中不得安装、卸载或升级 By-Reach 组件。

### GitHub（gh CLI）

```bash
gh auth status
gh search repos "query" --sort stars --limit 10
gh search code "query" --language python
gh repo view owner/repo
gh issue list -R owner/repo --state open
gh pr list -R owner/repo --state open
gh run list --repo owner/repo --limit 10
gh release list -R owner/repo
gh api repos/owner/repo
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```

选择指南：`gh` 做仓库/Issue/PR/CI 操作与搜索；读仓库内容用 `zread`；查技术文档用 `context7`。

### Exa 搜索

```bash
mcporter call 'exa.web_search_exa(query: "query", numResults: 5)'
mcporter call 'exa.get_code_context_exa(query: "code question", tokensNum: 3000)'
```

擅长英文内容、技术文档与代码上下文搜索。中文检索优先 `online-search`
（见 [online-search.md](online-search.md)），GitHub 仓库/代码搜索用 `gh`。

### 职场招聘

LinkedIn、招聘站与职位详情都是具体网页任务，走 `bycli` 并遵循其 Adapter 发现与浏览器生命周期规则。
登录、人工验证、验证码或限流时停止并报告。

## 诊断与状态

可用性不明时用 `byclaw-capability-doctor` 做被动诊断（`schemaVersion: 2`）：
`providers.byReach.channels.<channel>.effectiveBackend` 是选中的执行器，`diagnosticBackend` 只作为观察到的健康信息。
诊断不得启动 Chrome 或恢复浏览器；直接 CLI 诊断用 `by-reach doctor --json`。
provider 诊断只是被动信息，不能替代企业业务 Skills。

临时输出放 `/tmp/`，持久化 By-Reach 状态放 `~/.by-reach/`。

## 企业来源不走本路由层

企业来源（钉钉/飞书/企微/IMA）的采集、归档或批量搜索按 SKILL.md「来源路由」节加载
`dws` / `fws` / `wecomcli` / `ima-skill`，不得作为公共互联网任务交给 `bycli`。

IMA 企业渠道的命令面由 `ima-skill` 提供：

```bash
ima auth check --test --json
ima note search --content "<query>" --json
```

IMA 只允许通过 CLI 访问；认证失败时停止并提示重新连接，不得回退到 `bycli` 或直接 HTTP。采集编排器不执行 IMA 写操作。

---

本文件的路由表与渠道命令面源自 By-Reach（原 `agent-reach` skill），MIT License，Copyright (c) 2025 Agent Eyes。
