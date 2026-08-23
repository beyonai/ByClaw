---
name: knowledge-collection
description: Use when a user explicitly asks to collect, crawl, batch-search, archive, ingest, or organize articles, documents, URLs, or files from public or enterprise sources. Do not use for a single fact lookup, opening one page, login, or a one-off action unless the user explicitly asks to collect, archive, or ingest it.
---

# Knowledge Collection

Collects traceable knowledge materials and prepares a structured, auditable delivery. The orchestrator chooses authorized sources and delegates content retrieval; it never bypasses source executors with direct HTTP clients.

## 1. Decide whether to use this skill

Use it only for an explicit collection outcome: a batch, crawl, archive, saved source material, knowledge-base ingest, or knowledge organization. A normal question, a single fact lookup, opening one page, or login is not collection work unless the user explicitly asks to retain or process the material.

Before discovery, state the effective source scope and delivery level in ordinary language. Do not make the user choose technical modes.

| User intent | `sourceScope` | `materializationTarget` |
|---|---|---|
| Public information, no internal context | `public-internet` | `selected` by default |
| Names DingTalk, Feishu, WeCom, or IMA | Add only the named platform(s) | Match the requested result |
| Explicit internal-material request | Add only the necessary enterprise source(s) | Match the requested result |
| “Find candidates” | Task-derived scope | `candidates` |
| “Collect these selected items” | Task-derived scope | `selected` |
| “Archive/import all” | Task-derived scope | `all` |

`enterprise search-all` is a low-level batch command: omitting `--sources` intentionally searches all enterprise connectors. In user-facing orchestration, always pass explicit `--sources` for a narrower scope; omit it only for an explicit all-enterprise request or an auditable organization policy.

## 2. Select one workflow

| Situation | Required reference |
|---|---|
| Complex, multi-source, cited research | [research-methodology.md](references/research-methodology.md) |
| Public URL/source routing | [agent-reach.md](references/agent-reach.md) |
| DingTalk, Feishu, WeCom, or IMA | Relevant file in [references/sources/](references/sources/) |
| Product documentation site or multi-page crawl | [site-crawl/SKILL.md](references/site-crawl/SKILL.md) |
| Session state, collection artifacts, duplicate groups | [collection-contract.md](references/collection-contract.md) |
| Preview, re-materialization, post-processing, cleanup | [post-processing.md](references/post-processing.md) |
| Knowledge-base ingest | [knowledge-ingest.md](references/knowledge-ingest.md) |

Read only the reference that matches the chosen workflow, plus `collection-contract.md` for any collection session and `post-processing.md` before any downstream action. The complete reference index is [manifest.json](references/manifest.json).

## 3. Execute through validated commands

1. Create or load a session before discovery. Use `init` with the derived `--source-scope` and `--materialization-target`.
2. Delegate retrieval to the selected source executor. Do not use `web_fetch`, `curl`, `wget`, `requests`, or another direct HTTP client to bypass it.
3. Register only actual artifacts through `collect`; do not treat snippets as collected evidence or hand-edit inventory metadata.
4. Use `status` before delivery. It distinguishes source records, duplicate groups, materialized bodies, pending bodies, failed bodies, and `deliveryComplete`.
5. For research mode, call `report` before cleanup. For downstream processing, record the per-item result with `run` before cleanup.

Use `node scripts/knowledge-collection.mjs command-schema` for the machine-readable command contract. For a command marked `delegated-command`, read the executor schema named in `delegatedTo.schemaCommand`; `command --help` is the readable companion.

## 4. Safety and completion rules

- Preserve provenance. HTTP(S) duplicates share a normalized duplicate group but retain all source records; non-HTTP enterprise URIs are never guessed to be duplicates.
- Do not bypass authorization, expand the source scope without user intent or policy, fabricate a result, or hide an unavailable source.
- Knowledge-base writes, overwrite actions, and other destructive operations require the confirmations defined by [knowledge-ingest.md](references/knowledge-ingest.md).
- Treat `all` as complete only when `status.deliveryComplete=true`; pending or failed bodies must remain visible.
- A research report must contain exactly these named sections: `## 采集范围`, `## 采集成果`, `## 来源与追溯`, and `## 覆盖缺口与局限`.

## 5. Return a stable delivery summary

State the effective scope, delivery level, source-record and duplicate-group counts, materialized/pending/failed counts, provenance links, and coverage gaps. Do not call candidate metadata or partially materialized bodies “fully archived”.

All command output is JSON. On failure, use the command's structured error and report the actual failed source, permission limit, or coverage gap; never invent a substitute result.
