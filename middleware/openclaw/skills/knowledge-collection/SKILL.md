---
name: knowledge-collection
description: Use when a user explicitly asks to collect, crawl, batch-search, or archive articles, documents, URLs, or files from public or enterprise sources. Produces traceable collection artifacts and validated sanitized Markdown for handoff without proactively prompting for downstream choices.
---

# Knowledge Collection

Collect traceable source materials and deliver validated, sanitized Markdown. The collection orchestrator `knowledge-collection` chooses authorized sources and delegates retrieval; it never bypasses source executors with direct HTTP clients.

## 0. 默认落盘位置

在创建任何采集目录或调用 `init` 前，先读取当前 Agent 上下文提供的 **Session Root**。在用户沙箱中，
本次任务的内部采集文件默认落在 `/by/.sessions/<sessionId>/` 下；没有显式保存路径时，推荐使用
`/by/.sessions/<sessionId>/collections/<task-name>/` 作为唯一采集会话根。这里的 `<sessionId>` 是当前聊天会话 ID，
必须来自 Agent 上下文中的 Session Root，不得使用登录 Cookie、`BAIYING_SESSION` 或其他认证会话值推断。
`--session-dir`、`--parent-session-dir`、`--output-dir`、`--output-root` 与显式 `--report-path` 以 `/` 开头时按
绝对路径使用，可指向沙箱内任意可写位置；使用相对路径时必须同时显式传入 `--session-root <Session Root>`，
并相对于该 Session Root 解析。

不得依赖进程当前目录解释相对路径。相对路径中的 `..` 或符号链接不得越出当前 Session Root。若相对路径调用的上下文
没有提供 Session Root，不得猜测 sessionId，应先向上游取得当前会话目录。绝对路径不受 Session Root 成员关系限制，
但会话内部的 `.collection-inputs/`、`raw/`、`markdown/` 和 `sanitized/items/` 布局仍必须遵守本 Skill 的目录契约。

用户提供的保存路径是交付目录，不是采集会话目录。只要请求中出现明确的保存文件路径，就把该路径记为
`requestedDeliveryDir`，并在当前 Session Root 的 `.collection-runs/<run-id>/` 中初始化独立的内部会话；不得把用户目录
直接传给 `init`，也不得假定以后仍使用 `00-collection/`。相对保存路径按当前 Session Root 解析，绝对路径保持其绝对位置。
`requestedDeliveryDir` 在发布前是不可探测的 opaque 值：采集和校验期间只写内部会话；最终通过 `publish`
非破坏性地发布正文与引用图片。

## 1. Decide whether to use this skill

Use it only when the user explicitly asks to collect, crawl, batch-search, archive, or preserve source material. A normal question, a single fact lookup, opening one page, or login is not collection work unless the user explicitly asks for an explicit collection outcome.

Before discovery, state the effective source scope and materialization target in ordinary language. Do not make the user choose technical modes.

| User intent | `sourceScope` | `materializationTarget` |
|---|---|---|
| Public information, no internal context | `public-internet` | `selected` by default |
| Names DingTalk, Feishu, WeCom, or IMA | Add only the named platform(s) | Match the requested result |
| Explicit internal-material request | Add only the necessary enterprise source(s) | Match the requested result |
| “Find candidates” | Task-derived scope | `candidates` |
| “Collect these selected items” | Task-derived scope | `selected` |
| “Archive all” | Task-derived scope | `all` |

`enterprise search-all` is a low-level batch command. In user-facing orchestration, always pass explicit `--sources` for a narrower scope; omit it only for an explicit all-enterprise request or an auditable organization policy. Every enterprise `search`, `search-all`, or `resource` call must receive the initialized parent session through `--parent-session-dir`; the command rejects sources outside that session's `task.sourceScope`. The `search-all` output root is itself a canonical session and is the status/delivery target.

单一企业来源执行 `enterprise search` 时，`--output-dir` 必须等于 `--parent-session-dir`，直接把权威状态、`raw/`、`markdown/` 和 `sanitized/` 发布到已初始化会话根。不得把 `raw/<source>/` 当作第二个会话根；`raw/ima/sanitized/items` 等嵌套交付路径不合规。为兼容旧调用，runner 会把位于父会话 `raw/` 下的 `--output-dir` 自动归一到父会话根。

## 2. Select one collection workflow

| Situation | Required reference |
|---|---|
| Complex, multi-source, cited research | [research-methodology.md](references/research-methodology.md) |
| Public URL/source routing | [agent-reach.md](references/agent-reach.md) |
| DingTalk, Feishu, WeCom, or IMA | Relevant file in [references/sources/](references/sources/) |
| Product documentation site or multi-page crawl | [site-crawl/SKILL.md](references/site-crawl/SKILL.md) |
| Session state and collection artifacts | [collection-contract.md](references/collection-contract.md) |
| Final validation and handoff | [delivery.md](references/delivery.md) |

Read only the reference that matches the chosen workflow, plus `collection-contract.md` for any collection session and `delivery.md` before handoff. The complete reference index is [manifest.json](references/manifest.json).

## 3. Execute through validated commands

发布验证或性能测试开始前，先运行 `knowledge-collection.mjs version` 并记录 `version`、`buildId` 与
`buildIdSource`。发布系统应通过 `KNOWLEDGE_COLLECTION_BUILD_ID` 注入 commit/build 标识；未注入时 CLI 返回
运行时 Skill 文件的 `sha256:` 内容指纹，线上与本地指纹一致才可视为同一候选构建。

1. Create or load a session before discovery. Before any source executor, browser preflight, or delegated acquisition command, complete that initialization. Use `init` with the derived `--source-scope` and `--materialization-target`. 用户明确要求“全文”“完整正文”或“PDF 全文”时，还必须传 `--required-content-granularity full-text`；否则使用默认的 `any`。 When the user supplied a save path, use `<Session Root>/.collection-runs/<run-id>/` as `--session-dir` and retain the save path separately as `requestedDeliveryDir`. When the user already selected direct source URLs, pass those exact URLs through `init --direct-urls '<JSON array>'` and initialize their inventory as `pending` before acquisition so a terminal source gate remains reportable. `--direct-urls` is only for URLs explicitly present in the user's request, never for URLs found or remembered by the Agent.
2. For public URL discovery that uses SearXNG, run `public-discover`. When the user explicitly requests a quantity (for example, “采集一篇”), pass that positive integer as `--requested-count`; this runs SearXNG first with the requested quantity as its result limit and automatically falls back to the relocated `hot_discovery` channel when unique eligible articles are below the requested count. Read `candidateQuality.<channel>.eligibleArticle`、`candidateQuality.<channel>.topicRelevance` and each candidate's `pageTypeReasons` plus `topicRelevance`. `article` only describes page shape; a usable candidate also requires `topicRelevance.status=matched|not-required`. Login, home, navigation, search-result, and off-topic publication pages are not successful candidates. Without `--requested-count`, the command starts the relocated `online-search` and `hot_discovery` channels in parallel and reports unavailable coverage without suppressing successful results.

   中文文章 profile 对 `requested-count` 使用固定来源顺序和超额采样；SearXNG 与 hot-discovery 共享 **60 秒软预算**、**90 秒硬上限**，单适配器最多 10 秒。软预算到达后不得启动新来源，硬上限到达后终止整个执行器进程树并保留已完成诊断。选文只取确定性排序后的首个 eligible article；`merged.article=0` 时不得使用 weak，也不得人工跳过高位候选另选文章。

   中文品牌文章采集的首轮 query 应一次表达文章意图，例如 `<品牌> 报道 访谈 公众号`，而不是只传品牌名后逐轮碰运气。学术主题应在允许的第二轮中改用 `--category science`，而不是改走站点搜索。

   所有公共发现任务都受同一硬边界约束：公共发现最多允许两轮，且只有首轮合并结果的 `candidateQuality.merged.eligibleArticle=0` 时才能调用第二轮 `public-discover`。每轮 query 必须保留初始化时锁定的主题锚点；`DISCOVERY_QUERY_DRIFT` 会在执行器启动前终止本轮。不得脱离 `public-discover` 手工调用其他发现器补结果；不得使用模型记忆中的 URL、DOI、论文 ID，也不得把 `weak`/`reject` 或 `unmatched`/`unknown` 候选人工提升。第二轮仍无 eligible article 时，保留 `stopReason=no-article-candidates`，读取 `stopDetail=no-relevant-article-candidates`，运行 `status`，报告覆盖缺口并停止。后续 inventory/`collect` 只接受本会话的 eligible article、用户原始请求通过 `--direct-urls` 登记的 URL，或已在 crawl frontier 标为 fetched 且仍在 scope 内的页面；其他来源返回 `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY`。

   Public discovery keeps normalized deduplication separate from acquisition URLs. Use the selected candidate's `url` unchanged for the first acquisition attempt. When that attempt fails and the candidate has `sourceUrls`, retry the remaining listed variants in order. Never reconstruct an acquisition URL from a duplicate key, and never persist a variant containing credentials or sensitive parameters.
3. Delegate retrieval to the selected source executor. Do not use `web_fetch`, `curl`, `wget`, `requests`, or another direct HTTP client to bypass it. 委派来源执行器时只传内部 `session-dir` 及其 `raw/` 子路径，不得向被委派 Agent 或执行器传递、描述或要求其操作
   `requestedDeliveryDir`。

   已选候选是 `https://mp.weixin.qq.com/s...` 或 `https://weixin.sogou.com/link?...` 时，按 [agent-reach.md](references/agent-reach.md) 委派 `bycli weixin download --url <URL>`，把输出目录和结构化结果都保存在本会话 `raw/bycli/weixin/<item-id>/`。确认返回的 `saved` 文件可读后，运行 `materialize-wechat`，参数为 `--executor-result-file <raw-result.json> --item-id <item-id>`；只有命令返回非空 `collectPayloadPath` 时才把它交给 `collect`。低置信度结果由该命令保留为 pending/unknown，不得手写脚本将其提升为全文。

   其他通用网页必须先运行 `acquire-web --item-id <item-id> --source-url <已授权 URL>`，再把命令返回的 `executorResult` 交给 `materialize-web --item-id <item-id> --executor-result-file <path>`。不得手工重定向 stdout 到 raw，不得手工构造 collect payload；只有 `materialize-web` 返回非空 `collectPayloadPath` 时才能调用 `collect`。执行器返回登录、CAPTCHA、环境验证或其他 requires-user-action 时遵守 byCLI **STOP** 契约：保留 pending/raw 与命令自有 TAB，停止且不降级、不清理、不自动重试。

   已授权并选中的 arXiv 候选要求完整正文时，无论候选来自用户通过 `--direct-urls` 提供的直链还是 `public-discover` 的 eligible article，都按 [agent-reach.md](references/agent-reach.md) 获取元数据与全文。全文读取必须使用 `bycli web read --url <URL> --output <session-dir>/raw/bycli/arxiv/<item-id>/`，由 byCLI 同时落盘正文和图片。若原始 PDF URL 不能由 `bycli web read` 物化，可仅改用同一官方论文的 `https://arxiv.org/html/<paper-id>`，并保留已授权候选 URL 为 `sourceUrl`、实际读取 URL 为 `acquisitionUrl`；两者必须具有相同论文 ID。把两份执行器原始输出原样保留在 `raw/` 后运行 `materialize-arxiv`。只有该命令返回非空 `collectPayloadPath` 时才交给 `collect`；结构不完整时保持 pending，摘要或节选不能满足全文要求。重试必须写入新的 `raw/bycli/arxiv/<item-id>-<attempt>/`，不得覆盖首次或任何既有执行器输出。不得手工改写 raw 证据，不得手工下载或补抓图片，不得使用 `curl`、`web_fetch`、`wget` 或 `requests` 探测、补抓或转换。

   当选用的执行器是 `bycli` 时，初次 `BROWSER_CONNECT` 是桥接恢复信号，不是要求用户操作桌面浏览器的证据。执行器必须先完成托管浏览器恢复阶梯（状态检查、冷启动、`doctor`/`daemon status` 复检，以及最多一次 daemon restart），再报告桥接失败；采集编排器不得直接要求用户打开 Chrome，也不得将这次首次失败归类为认证问题。只有最终 `bridge_unavailable`，或明确的登录、MFA、CAPTCHA、认证结果，才可作为需要用户处理的事项对外说明。

   Authentication failure does not undo initialization. Preserve `session.json`, keep every selected source visible as `failed` or `pending`, and run `status` before reporting the stopped collection. A directory without `session.json` is not a partial or failed collection terminal state.
4. Register only actual artifacts through `collect`; excerpts and abstracts are valid typed artifacts only when their actual `contentGranularity` is recorded, but they must never be treated or described as full text. For a topic-gated public-discovery item, `collect` re-evaluates the canonical title and visible sanitized Markdown; `MATERIALIZED_CONTENT_NOT_RELEVANT` is terminal for that artifact. Agent prose, a relevant search snippet, trusted publication URL shape, or a manually edited payload cannot override it. A public `full-text` item must carry `fullTextEvidence` that points to a matching structured receipt under `raw/`; only an approved source executor or dedicated materializer may create that receipt. Agent-authored Markdown, length checks, or Agent-authored evidence are insufficient. Do not hand-edit inventory metadata, topic relevance, or `fullTextEvidence`.
5. For research mode, call `report` to generate the requested research report.
6. Use `status` before delivery. It distinguishes source records, duplicate groups, materialized bodies, pending bodies, failed bodies, content granularity, media coverage, crawl coverage, and `collection.deliveryComplete`. It read-only revalidates materialized topic relevance; failure makes `deliveryComplete=false` and removes `downstreamInput`. `selected` 和 `all` 至少包含一个条目才可能完成；当 `requiredContentGranularity=full-text` 时，每个已物化正文都必须是 `full-text`。摘要或节选不能满足全文要求，此时即使文件存在也不得称为完成。
7. When the user supplied a save path and `status.collection.deliveryComplete=true`, only the root Agent may run `publish --session-dir <dir> --delivery-dir <path>` (and pass `--session-root <Session Root>` for a relative path). If completion is false, do not run `publish`; report the unmet granularity or coverage gap. Do not publish before validation. Before the root Agent invokes `publish`, treat `requestedDeliveryDir` as opaque: 不得对其执行 `mkdir`、`ls`、`find`、写入、删除、清空、移动或复制，不得做存在性或空目录检查，也不得要求被委派 Agent 执行这些操作。目标是否为空以及冲突目录如何选择只能由 `publish` 判定。
   In the first final response after a successful publish, report `delivery.actualDirectory` and echo the exact `deliveryInput` object in a JSON block; do not report only a path and defer `deliveryInput` to a later turn. Never claim success from an inferred path.

Before `publish`, every artifact for one collection task must remain beneath that task's initialized session directory. If a delegated tool needs a staging path, use the session's `raw/` subtree; then register or materialize the result into `markdown/items/` and `sanitized/items/`. When an approved source record contains article media, preserve the source response as raw evidence. Only an approved source executor may create local media copies. Media failure is reported independently and must not turn a successfully materialized body into a failed article; Markdown may reference only media that actually reached the article's local `assets/` directory. Never insert remote or fictitious local links. Do not manually create a sibling delivery directory such as `<topic>-fulltext/` or `<topic>-articles/`; an explicit user destination is handled only by `publish`. Duplicate records, partial materialization, or a delegated-tool failure do not waive this requirement: retain the raw evidence and mark the affected inventory item `pending` or `failed` in the same session.

Use `node scripts/knowledge-collection.mjs command-schema` for the machine-readable collection command contract. For a command marked `delegated-command`, read the executor schema named in `delegatedTo.schemaCommand`; `command --help` is the readable companion.

## 4. Safety and completion rules

- Preserve provenance. HTTP(S) duplicates share a normalized duplicate group but retain all source records; non-HTTP enterprise URIs are never guessed to be duplicates.
- Do not bypass authorization, expand the source scope without user intent or policy, fabricate a result, or hide an unavailable source.
- `DISCOVERY_RELEVANCE_MIGRATION_REQUIRED` 表示旧公共发现会话只能只读检查，或复用完全未变化的既有发布回执；不得原地补写 `matched`。创建新的内部 run 并重新发现、采集和校验。
- Treat `all` as complete only when `status.collection.deliveryComplete=true`; pending/failed crawl entries, fetched-but-unmaterialized pages, over-cap URLs, pending bodies, and failed bodies must remain visible.
- When `status.collection.deliveryComplete=false`, 不得执行 `publish`，也不得以已生成摘要、节选或空数组为依据宣称采集成功。
- A research report must contain exactly these named sections: `## 采集范围`, `## 采集成果`, `## 来源与追溯`, and `## 覆盖缺口与局限`.

## 5. 完成交付并停止

采集完成后停止。向主 Agent 或下游 Agent 返回有效来源范围、采集目录、来源记录数、重复组数、已物化/待处理/失败数量、来源链接、覆盖缺口，以及 `status.downstreamInput`。最终交付必须报告 `contentGranularity` 四态计数；必须报告 `mediaCovers` 四态计数；公共采集还必须报告发现调用次数与 query、候选类型计数、抓取次数、物化次数，以及发现、抓取、物化、collect/status、云盘 check/upload/list 和总阶段耗时。只要 `excerpt`、`abstract` 或 `unknown` 大于 0，对应记录不得称为完整文章正文，必须按实际粒度说明。

未指定保存路径时，下游 Agent 的输入只能是本次会话中已经校验、确实存在的 `sanitized/items/*.md` 文件。指定保存路径并成功发布后，下游输入改为 `publish` 返回的 `deliveryInput.files`；根 Agent 必须把原样的 `deliveryInput` 传给下游 Agent，并在首次最终答复中原样回显 `deliveryInput`，不得只报告路径。不得把 `raw/`、`markdown/`、摘要、候选元数据、缺失文件或会话状态文件作为下游正文输入。具体规则见 [delivery.md](references/delivery.md)。

采集流程不得主动询问 `入库 / 知识整理 / 跳过`。采集阶段交付完成后，由根 Agent 根据用户已经表达的意图决定是否调用 `project-cloud-knowledge`、`knowledge-organizer` 或其他下游 Skill，无需为了这三个选项再次询问用户。

所有命令输出均为 JSON。失败时返回结构化错误和实际失败来源、权限限制或覆盖缺口，不得编造替代结果。交付上述信息后结束采集阶段，由根 Agent 继续编排已获用户授权的后续动作。
