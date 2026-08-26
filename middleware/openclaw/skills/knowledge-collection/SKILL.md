---
name: knowledge-collection
description: Use when a user explicitly asks to collect, crawl, batch-search, or archive articles, documents, URLs, or files from public or enterprise sources. Produces traceable collection artifacts and validated sanitized Markdown for handoff; does not perform knowledge-base ingest, knowledge organization, or downstream actions.
---

# Knowledge Collection

Collect traceable source materials and deliver validated, sanitized Markdown. The collection orchestrator `knowledge-collection` chooses authorized sources and delegates retrieval; it never bypasses source executors with direct HTTP clients.

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

1. Create or load a session before discovery. Use `init` with the derived `--source-scope` and `--materialization-target`.
2. For public URL discovery that uses SearXNG, run `public-discover`. When the user explicitly requests a quantity (for example, “采集一篇”), pass that positive integer as `--requested-count`; this runs only SearXNG and uses the requested quantity as its result limit. Without `--requested-count`, it starts the relocated `online-search` and `hot_discovery` channels in parallel and reports unavailable coverage without suppressing successful results.
3. Delegate retrieval to the selected source executor. Do not use `web_fetch`, `curl`, `wget`, `requests`, or another direct HTTP client to bypass it.

   当选用的执行器是 `bycli` 时，初次 `BROWSER_CONNECT` 是桥接恢复信号，不是要求用户操作桌面浏览器的证据。执行器必须先完成托管浏览器恢复阶梯（状态检查、冷启动、`doctor`/`daemon status` 复检，以及最多一次 daemon restart），再报告桥接失败；采集编排器不得直接要求用户打开 Chrome，也不得将这次首次失败归类为认证问题。只有最终 `bridge_unavailable`，或明确的登录、MFA、CAPTCHA、认证结果，才可作为需要用户处理的事项对外说明。
4. Register only actual artifacts through `collect`; do not treat snippets as collected evidence or hand-edit inventory metadata.
5. For research mode, call `report` to generate the requested research report.
6. Use `status` before delivery. It distinguishes source records, duplicate groups, materialized bodies, pending bodies, failed bodies, crawl coverage, and `collection.deliveryComplete`.

Every artifact for one collection task must remain beneath that task's initialized session directory. If a delegated tool needs a staging path, use the session's `raw/` subtree; then register or materialize the result into `markdown/items/` and `sanitized/items/`. Do not create a sibling delivery directory such as `<topic>-fulltext/` or `<topic>-articles/`. Duplicate records, partial materialization, or a delegated-tool failure do not waive this requirement: retain the raw evidence and mark the affected inventory item `pending` or `failed` in the same session.

Use `node scripts/knowledge-collection.mjs command-schema` for the machine-readable collection command contract. For a command marked `delegated-command`, read the executor schema named in `delegatedTo.schemaCommand`; `command --help` is the readable companion.

## 4. Safety and completion rules

- Preserve provenance. HTTP(S) duplicates share a normalized duplicate group but retain all source records; non-HTTP enterprise URIs are never guessed to be duplicates.
- Do not bypass authorization, expand the source scope without user intent or policy, fabricate a result, or hide an unavailable source.
- Treat `all` as complete only when `status.collection.deliveryComplete=true`; pending/failed crawl entries, fetched-but-unmaterialized pages, over-cap URLs, pending bodies, and failed bodies must remain visible.
- A research report must contain exactly these named sections: `## 采集范围`, `## 采集成果`, `## 来源与追溯`, and `## 覆盖缺口与局限`.

## 5. 完成交付并停止

采集完成后停止。向主 Agent 或下游 Agent 返回有效来源范围、采集目录、来源记录数、重复组数、已物化/待处理/失败数量、来源链接、覆盖缺口，以及 `status.downstreamInput`。

下游 Agent 的输入只能是本次会话中已经校验、确实存在的 `sanitized/items/*.md` 文件；不得把 `raw/`、`markdown/`、摘要、候选元数据、缺失文件或会话状态文件作为下游正文输入。具体规则见 [delivery.md](references/delivery.md)。

本技能不拥有也不执行任何后续动作：

- 不得调用 `by-knowledge-manager`。
- 不得调用 `knowledge-organizer`。
- 不得询问 `入库 / 知识整理 / 跳过`。
- 不得替主 Agent 选择或启动其他下游 Skill。

所有命令输出均为 JSON。失败时返回结构化错误和实际失败来源、权限限制或覆盖缺口，不得编造替代结果。交付上述信息后立即结束，由主 Agent 决定是否以及如何委派下一步。
