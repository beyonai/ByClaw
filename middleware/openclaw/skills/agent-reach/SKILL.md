---
name: agent-reach
description: Use when the user asks to research, search, look up, read, collect, or summarize public-internet content; gives a URL; or mentions Twitter/X, Reddit, Bilibili, XiaoHongShu, Facebook, Instagram, LinkedIn, YouTube, GitHub, V2EX, Xueqiu, RSS, Xiaoyuzhou, or Exa. Route concrete webpages through byCLI before acquiring content. For persistent collection artifacts, use knowledge-collection.
---

# By-Reach

> **入口与使用前提（必读）**：被调用时，若本会话尚未读过本文件，**必须先打开完整通读本文**
> （含路由表、non-negotiable webpage rule 与 bycli 铁律），再按其中命令面执行；
> 禁止把技能名当作平台工具名调用（如直接调 `agent-reach` 工具会报 "Tool not found"）。
> 检索只负责发现；取网页内容一律委派 `bycli`，**禁止 `web_fetch` / `curl` / `requests` 等直连**。

By-Reach v2 is the public-internet router bundled with ByClaw. Its technical
Skill identifier and invocation remain `agent-reach` / `$agent-reach`; its
product name, CLI, configuration directory, and diagnostic provider are
By-Reach, `by-reach`, `~/.by-reach/`, and `providers.byReach`.

Use this Skill to select an approved read-only executor. Do not post, comment,
like, authenticate, or otherwise write to a public platform. When the user
explicitly requests collection, crawling, archiving, ingestion, or knowledge
organization, load `knowledge-collection`; this router only selects the source
executor and returns its result.

## Non-negotiable webpage rule

For **任何网站、网页或 URL** that must be opened, read, searched within,
collected from, scraped, or operated, before acquiring content the router
**必须无条件选择并加载 `bycli` skill**. This includes public static pages,
server-rendered pages, SPAs, raw URLs, Markdown, plain text, and pages without
login.

The only generic webpage read command is:

```bash
bycli web read --url <URL> --stdout
```

Do not pre-read, probe, or fall back to a fetcher, reader proxy, direct HTTP
client, legacy adapter, generic browser, or another webpage tool. byCLI
failure means **byCLI 无法完成时必须停止并报告**; **不得回退到其他网页获取工具**.

Run `byclaw-capability-doctor` for passive diagnostics when availability is
unclear. It exposes `schemaVersion: 2`; use
`providers.byReach.channels.<channel>.effectiveBackend` for the selected
executor and `diagnosticBackend` only as observed health information. A
diagnostic check must not start Chrome or recover a browser. For direct CLI
diagnostics, use `by-reach doctor --json`; do not install, uninstall, or update
By-Reach during a task.

## Approved routing table

| Target | First executor | One permitted fallback |
| --- | --- | --- |
| Generic webpage / URL | `bycli web read --url <URL> --stdout` | none |
| Twitter / X | `twitter-cli` | `bycli twitter search` |
| Reddit | `rdt-cli` | `bycli reddit search` |
| Bilibili | `bili-cli` | `bycli bilibili search` |
| YouTube | `yt-dlp` | `bycli youtube search` |
| V2EX | packaged V2EX API channel | `bycli v2ex hot` |
| Xueqiu | packaged Xueqiu API channel | `bycli xueqiu search` |
| Facebook / Instagram / LinkedIn / XiaoHongShu | byCLI | none |
| GitHub | `gh` CLI | none |
| RSS | `feedparser` | none |
| Exa search | `mcporter` with `exa.web_search_exa` | none |
| Xiaoyuzhou audio | By-Reach transcription | none |

For a row with a fallback, execute the first executor once. Only failed,
empty, challenge-shaped, malformed, or non-meaningful output permits **只允许一次 byCLI 兜底**.
After that attempt fails, stop and report it. Never substitute a
different CLI or generic webpage mechanism.

## Ownership and enterprise boundaries

The named actors are: router `agent-reach` (By-Reach), webpage executor
`bycli`, collection orchestrator `knowledge-collection`, and direct-query
owner (the root Agent). In delegated collection mode, `knowledge-collection`
owns persistence, artifact contracts, post-processing, ingestion, and user
follow-up. By-Reach and byCLI only return acquisition results and must not ask
about "入库 / 知识整理 / 跳过".

直接查询时由根 Agent 负责最终回复；委派采集时由采集编排器
`knowledge-collection` 负责统一持久化、后处理和入库或知识整理。

企业来源的采集、归档、批量搜索或入库请求交给采集编排器 `knowledge-collection`，并按来源加载 `dws`、`fws` 或 `wecomcli`。不得作为公共互联网任务交给 `bycli`。企业业务请求不使用本公共互联网路由器；其 provider
诊断只是被动信息，不能替代这些业务 Skills。

Keep temporary output in `/tmp/` and persistent By-Reach state in
`~/.by-reach/`. Read a focused reference only when its platform is needed:

- [web](references/web.md) — generic URLs and RSS
- [social](references/social.md) — social and community channels
- [video](references/video.md) — YouTube, Bilibili, Xiaoyuzhou
- [dev](references/dev.md) — GitHub
- [search](references/search.md) — Exa
- [career](references/career.md) — LinkedIn
