# 公共互联网来源路由（原 By-Reach 路由器）

本文件是采集编排器 `knowledge-collection` 的内置公共互联网路由器 `agent-reach`，取代原先独立的 By-Reach 技能。
任何一次公共互联网取内容前，必须先按本文选定来源执行器，再委派该执行器；**采集编排器自身永不取内容**。

角色固定为：采集编排器 `knowledge-collection`（本技能，含本路由层）、网站执行器 `bycli`、
企业来源执行器 `dws` / `fws` / `wecomcli` / `bycli ima` adapter、直接查询所有者（根 Agent）。
路由层只选择执行器并接收其返回结果，持久化、产物契约与采集交付归采集编排器。
来源执行器不得启动任何下游动作，也不得反向加载 `knowledge-collection`。

## 网页铁律（不可协商）

对**任何网站、网页或 URL** 的打开、读取、站内搜索、采集、抓取或操作，取内容前**必须无条件加载 `bycli` skill**。
公开静态页、服务端渲染页、SPA、raw URL、Markdown、纯文本、无需登录的页面均无例外。

除下方明确列出的站点专用 byCLI 执行路径外，唯一的通用网页读取命令是：

```bash
node scripts/knowledge-collection.mjs acquire-web --session-dir <dir> --item-id <item-id> --source-url <URL>
```

不得预读、探测，也不得回退到 fetcher、reader proxy、直连 HTTP 客户端、旧适配器、通用浏览器或其他网页工具；
不得使用 `web_fetch`、`curl`、`wget`、`requests`。**byCLI 无法完成时必须停止并报告，不得回退到其他网页获取工具。**
已经用直连拿到内容时该结果作废，按规范流程重新采集。

`knowledge-collection public-discover` 只负责公共发现、候选授权和证据落盘。WSA 的 passage/content 是搜索摘要级发现证据，不保证目标 URL 是正文页，也不保证不会返回登录、注册、验证、错误或导航页面。明确要求数量的文章任务必须改用 `knowledge-collection public-collect`，由它独占两轮发现、正文探测、验证、去重、晋升与数量闭环；不得手工串联原子命令模拟。未指定数量的文章任务默认由 `unified-search` 同时检索公共互联网与当前项目云盘，再由 `unified-materialize` 物化选中的正文。SearXNG 无候选或输出无效时，不得手工执行 `bycli <site> search`、使用模型记忆中的 URL/DOI/论文 ID，或调用独立搜索器补结果。

`public-collect` 的自动正文 probe 支持三类来源：普通 HTTP(S) 文章页、微信文章和 arXiv 论文。微信候选进入专用正文净化与结构验证，arXiv 候选只使用已登记的同论文官方 HTML 表示并执行论文结构验证；视频、社交平台和 RSS 等尚无专用 verifier 的候选会明确记为 `unsupported`，不会计入 requested count。每个 query 必须先运行 online-search 并验证其候选，仍缺正文时才运行同一 query 的 hot-discovery；阻塞恢复必须回到原 query 和原 channel。遇到真实登录、MFA 或 CAPTCHA 时按 run ID 恢复或跳过；不得创建平行会话继续写入。

本文件下列原子来源命令仅适用于未由 `public-collect` 持有的 operator 会话。`public-collect` 持有的会话只能调用编排器内部 verifier；根 Agent、路由层和来源执行器均不得对该会话手工执行表格或后文中的 `acquire-web`、`materialize-*`、`collect`、`crawl-*` 命令。

用户明确只要候选链接时，即使用户指定了链接数量，也使用 `public-discover`。用户要求文章、正文或全文但未指定数量时，默认使用 `unified-search` 并行检索公共互联网与当前项目云盘；调用时必须把可信 `<project_context>` 的 `project_id` 传为 `--project-id`，缺少显式 `cloudResourceId` 时由 `project-context basic` 解析项目云盘资源，再用 `unified-materialize` 物化选中的正文。用户明确指定数量时（如“一篇”“5 篇”“至少 10 篇”），使用 `public-collect`，仅检索公共互联网，并在首次 `init` 传 `--workflow public-collect`。用户明确限定来源时服从限定，不自动扩展来源。直链无独立检索主题时，`--query` 与 `--fallback-query` 都复用首次 `init` 的原始任务描述。

## 路由表

| 目标 | 首选执行器 | 唯一允许的兜底 |
| --- | --- | --- |
| 已选中的 `mp.weixin.qq.com/s...` 或 `weixin.sogou.com/link?...` 文章（仅限 operator；`public-collect` 使用内部 verifier） | `bycli weixin download --url <URL>` | 无 |
| 用户明确提供的 arXiv 论文全文（仅限 operator；`public-collect` 使用内部 verifier） | `bycli arxiv paper <paper-id>` + `bycli web read --url <URL> --output <session-dir>/raw/bycli/arxiv/<item-id>/` | 同一论文 ID 的 `https://arxiv.org/html/<paper-id>` |
| 通用网页 / URL（仅限 operator；`public-collect` 使用内部 verifier） | `knowledge-collection acquire-web` → `materialize-web` | 已由 public-discover 或用户直链授权的 URL |
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

微信文章行仍然完全位于 byCLI 来源执行器边界内，不是直接 HTTP 例外。输出目录必须是当前采集会话的
`raw/bycli/weixin/<item-id>/`；保留 `source_url`、`resolved_url`、`saved` Markdown、已下载图片和结构化结果。
随后由采集编排器执行 `materialize-wechat`，再把其 `collectPayloadPath` 交给 `collect`。其他网页走
`acquire-web` → `materialize-web`；不得手工重定向 stdout、不得手工构造 collect payload。任何登录、CAPTCHA、环境验证或
requires-user-action 都按 STOP 契约保留命令自有 TAB 并停止，微信专用命令失败时也不得回退到 `curl`、`wget`、`requests` 或通用浏览器。

### arXiv 全文

已授权并选中的 arXiv 候选要求完整正文时，无论候选来自用户通过 `--direct-urls` 提供的直链还是 `public-discover` 的 eligible article，先用 `bycli arxiv paper <paper-id>` 获取元数据，再用
`bycli web read --url <URL> --output <session-dir>/raw/bycli/arxiv/<item-id>/` 获取全文并让 byCLI 在同一输出目录中落盘正文及图片。`<URL>`
先使用已授权候选 URL；若 PDF 表示无法读取，只允许改用 arXiv 官方同一论文 ID 的
`https://arxiv.org/html/<paper-id>`；不得切换论文、使用镜像或凭据参数。原始 URL 必须作为 `sourceUrl`，实际成功读取的
HTML URL 必须作为 `acquisitionUrl` 持久化，然后交给 `materialize-arxiv` 验证结构完整性并生成全文证据。只有返回非空
`collectPayloadPath` 时才能调用 `collect`。保留 byCLI 的原始输出布局，把其实际生成的 Markdown 文件传给
`materialize-arxiv --fulltext-file`；重试必须使用新的 `raw/bycli/arxiv/<item-id>-<attempt>/` 并保留首次及所有既有输出，
不得把 stdout 手工重定向成正文，不得覆盖或手工改写 raw 证据，也不得手工下载或补抓图片。
不得使用 `curl`、`web_fetch`、`wget`、`requests` 做诊断或兜底。

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
`dws` / `fws` / `wecomcli` / 对应来源 reference，不得作为公共互联网任务走本路由层。

IMA 企业渠道统一使用浏览器支持的 byCLI IMA adapter：

```bash
bycli ima knowledge-list -f json
bycli ima knowledge "<knowledgeBase>" -f json
```

指定知识库时直接读取该库；未指定时先枚举知识库再逐库读取，并按
[sources/ima.md](sources/ima.md) 在本地筛选、去重和记录部分失败。登录或 bridge 不可用时按 collection Runner 的
结构化状态停止，不得回退到独立 IMA 命令或直接 HTTP。采集编排器不执行 IMA 写操作。

---

本文件的路由表与渠道命令面源自 By-Reach（原 `agent-reach` skill），MIT License，Copyright (c) 2025 Agent Eyes。
