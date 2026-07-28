# Feishu Connector Bridge

Use this reference when a bycli collection task targets Feishu / Lark data. bycli remains the single collection entry and owns artifacts, post-collection processing prompts, the internal knowledge-ingest workflow, and knowledge-organizer handoff. The `fws` skill and official `lark-cli` are the backend for product routing, commands, identity, scopes, permissions, and authentication.

## Contents

- [Trigger Conditions](#trigger-conditions)
- [Backend Selection](#backend-selection)
- [Authentication and Configuration Recovery](#authentication-and-configuration-recovery)
- [Ownership Boundary](#ownership-boundary)
- [Execution Flow](#execution-flow)
- [Output Directory](#output-directory)
- [Required Artifact Layout](#required-artifact-layout)
- [`bycli-output.json` Contract](#bycli-outputjson-contract)
- [Product Patterns](#product-patterns)
- [User-Facing Summary](#user-facing-summary)

## Trigger Conditions

Route through this bridge when the user asks bycli to collect, scrape, crawl, fetch, download, archive, or ingest Feishu data, including:

| Input | fws product capability |
|------|-------------------------|
| Feishu or Lark document URLs and document content | `docs` / `drive` |
| Feishu 妙记, meeting transcripts, AI notes, chapters, or recording products | `vc` / `minutes` |
| Feishu electronic sheets | `sheets` |
| Feishu Base / bitable records | `base` |
| Feishu Wiki nodes or knowledge-space content | `wiki`, then the resolved content product |
| Feishu Drive files, exports, downloads, comments, or metadata | `drive` |
| Feishu chats, message history, or message resources | `im` |
| Feishu calendar, task, mail, approval, attendance, contact, or slides data requested as collection input | matching fws product capability |

This bridge covers read, search, export, download, and collection operations only. Creating, editing, sending, approving, moving, permission-changing, or deleting Feishu resources remain direct fws write tasks and do not enter the bycli collection workflow.

Do not use browser driving, curl, handwritten HTTP APIs, or generic web scraping for Feishu collection. If fws reports that an operation is unsupported, use its `openapi` reference only when the request is still read-only and the schema has been inspected. If `lark-cli` is unavailable, report the backend result and follow the main SKILL.md exception rule; do not silently fall back. An alternative tool is allowed only after the user confirms it and then runs outside this bridge.

## Backend Selection

1. Load `fws`.
2. Route by URL or product intent and load the matching `references/products/<product>.md`.
3. Prefer `lark-cli <service> +<shortcut>`; use native commands or `lark-cli api` only according to fws discovery rules.
4. Add `--format json` to every business command. Select `--as user` for user-visible personal resources unless fws requires bot identity.
5. Determine success from the process exit code or JSON top-level `ok == true`, not an OpenAPI nested `code` field.
6. Record `metadata.backend` as `fws` and `metadata.backendCli` as `lark-cli`.

## Authentication and Configuration Recovery

Keep these failure classes separate:

| Failure | Required action |
|---------|-----------------|
| Missing OpenClaw Feishu channel / `channels.feishu` | Stop the business command and follow the fws channel-configuration flow; do not run user authorization |
| User identity 401/403, expired login, `missing_scope`, or `permission_violations` | Stop and follow the fws user authorization split-flow |
| Bot scope missing | Do not run `auth login`; return the backend `console_url` for an administrator |
| Resource permission, visibility, invalid token/ID, or not found | Report the backend error; do not retry authentication blindly |

For the user authorization split-flow, start only the exact `lark-cli auth login --scope ... --no-wait --json` or `--domain ...` command prescribed by fws, extract `verification_url` and `device_code` only from that execution, generate the QR-code data URI with the fws script, and end the turn. Do not complete the device-code exchange in the same turn. After the user confirms authorization, finish the device-code command, verify with `lark-cli auth status --json --verify`, and retry the original collection command.

Never expose or persist App Secret, access/refresh tokens, device codes, sessions, cookies, credential files, or raw authorization output in chat or collection artifacts.

## Ownership Boundary

| Area | Owner |
|------|-------|
| User-facing collection entry and collection boundary | bycli |
| Feishu product routing, command/schema correctness, and identity choice | fws |
| Feishu IDs/tokens, permissions, scopes, authentication, and pagination | fws / `lark-cli` |
| Feishu write-operation confirmation | fws; outside this bridge |
| Collection directory, index, Markdown, metadata, raw snapshots, downloads | bycli |
| Post-collection processing question and downstream handoff | bycli |

If fws returns an error, do not invent replacement data. Preserve successful partial artifacts and record the failed page token, cursor, resource token, or product operation in `metadata.json` without storing credentials.

## Execution Flow

1. Confirm the request is a bycli collection task using the main SKILL.md collection boundary.
2. Detect the Feishu URL type or product intent.
3. Load fws and the matching product reference.
4. Resolve real resource tokens or IDs using fws commands; never guess them.
5. Use only read/search/export/download commands and complete pagination unless the user requested a bounded subset.
6. Normalize successful results into bycli collection artifacts and write them under the bycli session directory.
7. Return a concise collection summary.
8. Ask the standard bycli post-collection processing question: 入库 / 知识整理 / 跳过. 入库 and 知识整理 are mutually exclusive.

Do not ask whether to save a reusable adapter. Feishu bridge runs use a product backend skill, not browser-driving steps that should become adapters.

## Output Directory

Use the standard bycli path template:

```text
/by/.sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

If `/by` is unavailable or read-only during local validation, use:

```text
<workspace>/.by-sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

Set `metadata.storageFallback=true` and record the reason. Use:

```text
collectionRunName=feishu-fws-<product>-<operation>
```

Examples: `feishu-fws-minutes-transcript`, `feishu-fws-docs-fetch`, `feishu-fws-base-record-list`, and `feishu-fws-drive-download`.

## Required Artifact Layout

Write at least:

```text
bycli-output.json
metadata.json
raw/
  <backend-command>.json
markdown/
  <content>.md
```

When the collection includes binary files or message resources, also write them under `files/` and reference them from `metadata.json` or the relevant item. Do not place downloads in the repository root.

For a Feishu minutes collection, prefer:

```text
bycli-output.json
metadata.json
raw/
  detail.json
markdown/
  transcript.md
  ai-summary.md
files/
  <recording-or-attachment>
```

Only create files for products actually returned by `lark-cli`; do not invent missing AI summaries, recordings, chapters, or transcripts.

## `bycli-output.json` Contract

Use the normal bycli collection output shape with Feishu provenance:

```json
{
  "title": "Feishu collection title",
  "url": "https://example.feishu.cn/minutes/...",
  "source": "fws",
  "backend": "fws",
  "backendCli": "lark-cli",
  "sourceProduct": "minutes",
  "operation": "transcript",
  "items": [
    {
      "title": "Meeting transcript",
      "url": "https://example.feishu.cn/minutes/...",
      "author": "",
      "publish_time": "",
      "markdown": "# ...",
      "fileName": "markdown/transcript.md"
    }
  ]
}
```

Rules:

- Every `items[].fileName` must point to an existing Markdown file.
- Include already-fetched Markdown inline in `items[].markdown`.
- Keep raw backend JSON in `raw/`; do not treat raw JSON as ingest-ready content by default.
- On partial pagination or export failure, keep successful content and set `metadata.partial=true` with the failed cursor or page token.

## Product Patterns

### Feishu minutes and transcripts

If the user supplies a 妙记 URL or `minute_token`, load the `vc` product reference and use `minutes +detail` with transcript output. A bare request such as “采集这份妙记” means collect available detail, transcript, and AI products; do not fabricate products that are absent. If the request identifies no unique meeting or minute, search with user-provided criteria and present duplicate candidates for selection rather than guessing.

Create the bycli run directory before invoking the backend, then bind the backend's file output to that run:

```bash
lark-cli minutes +detail --minute-tokens <minute_token> --transcript --output-dir "<runDir>/raw/minutes" --as user --format json
```

Capture the command's JSON response as `raw/detail.json`. After a successful response, inspect the files actually created below `<runDir>/raw/minutes`; read the generated transcript file rather than guessing its name. Preserve speaker names or IDs, timestamps, segment order, and text, normalize that returned content into `markdown/transcript.md`, and write or merge a single YAML front matter block containing `bycli_filter` according to the main bycli SKILL.md. Reference the existing Markdown file from `items[].fileName` and include the same content in `items[].markdown`. Only the normalized Markdown or another supported document path may be passed to the bycli `knowledge-ingest` workflow; the raw JSON and backend transcript file are audit inputs, not ingest-ready content.

When the user asks for a new summary or analysis, base it on the returned transcript rather than copying an existing AI summary.

### Documents, Drive, and Wiki

Use `docs +fetch --doc <url-or-token> --doc-format markdown` for document body collection. Use `drive` for file metadata, export, download, comments, or permissions. Resolve `/wiki/` links with `drive +inspect` or the wiki product commands before switching to the underlying product. For embedded sheets or Base content, resolve the token and collect through `sheets` or `base`.

### Sheets and Base

For Sheets, fetch workbook structure before choosing a sheet and range; do not guess `Sheet1`. For Base, resolve the real `base_token`, read table and field structure, and fetch all requested records. If `has_more=true`, continue pagination before making global claims. Prefer server-side aggregate queries for global statistics.

### Messages and files

Resolve real chat/message/resource IDs through fws and use user identity for user-visible history. Follow page tokens or cursors until complete unless the user requested a bounded subset. Put downloaded resources in `files/` and record their source message IDs in metadata.

## User-Facing Summary

After a successful Feishu collection, tell the user what object was collected, which files were written, whether content is partial, that fws / `lark-cli` was used, and whether configuration, identity, scope, permission, pagination, or missing-product limits applied. Then ask the standard post-collection processing question when required. Do not expose internal route names unless useful for debugging.
