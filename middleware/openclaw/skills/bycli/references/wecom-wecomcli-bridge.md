# WeCom Connector Bridge

Use this reference when a bycli collection task targets WeCom / 企业微信 data. bycli remains the single collection entry and owns artifacts, post-collection processing prompts, the internal knowledge-ingest workflow, and knowledge-organizer handoff. The `wecom` skill and `wecom-cli` are the backend for product routing, commands, IDs, permissions, asynchronous exports, and authentication.

## Contents

- [Trigger Conditions](#trigger-conditions)
- [Backend Selection](#backend-selection)
- [Authentication Recovery](#authentication-recovery)
- [Ownership Boundary](#ownership-boundary)
- [Execution Flow](#execution-flow)
- [Output Directory](#output-directory)
- [Required Artifact Layout](#required-artifact-layout)
- [`bycli-output.json` Contract](#bycli-outputjson-contract)
- [Product Patterns](#product-patterns)
- [User-Facing Summary](#user-facing-summary)

## Trigger Conditions

Route through this bridge when the user asks bycli to collect, scrape, crawl, fetch, download, archive, or ingest WeCom data, including:

| Input | Backend child skill / capability |
|------|----------------------------------|
| `doc.weixin.qq.com/doc/*` | `wecomcli-doc` |
| `doc.weixin.qq.com/sheet/*` | `wecomcli-sheet` |
| `doc.weixin.qq.com/smartsheet/*` | `wecomcli-smartsheet` |
| `doc.weixin.qq.com/smartpage/*` | `wecomcli-smartpage` |
| WeCom conversations, message history, or message attachments | `wecomcli-msg` |
| WeCom contacts used as collection input or ID resolution | `wecomcli-contact` |
| WeCom meeting, schedule, or todo data requested as collection input | matching `wecomcli-*` child skill |

This bridge covers read, export, download, and collection operations only. Sending messages and creating, editing, cancelling, or deleting WeCom resources remain direct `wecom` write tasks and do not enter the bycli collection workflow.

Treat contacts and conversations as the current bot-visible scope established by `wecom-cli init`. This is not a personal WeCom chat archive, not a company-wide conversation archive, and not the full company directory. State this boundary in collection metadata and the user-facing summary; never describe bot-visible results as the user's or company's complete data.

Do not use browser driving, curl, HTTP APIs, or generic web scraping for WeCom collection. If `wecom-cli` is unavailable or explicitly reports that the operation is unsupported, report the backend result and follow the main SKILL.md exception rule; do not silently fall back. An alternative tool is allowed only after the user confirms it and then runs outside this bridge.

## Backend Selection

1. Load the parent `wecom` skill.
2. Route by URL path or product intent and load the matching child `SKILL.md` before constructing a command.
3. Follow the child skill's exact command, parameter, polling, pagination, attachment, and safety rules. Do not invent a `--format` flag when the documented `wecom-cli` command already returns JSON.
4. Parse the actual CLI shape before deciding success. `wecom-cli` 0.1.9 can return a JSON-RPC envelope whose business payload is a JSON string in `result.content[].text`. Parse the outer response first, select the business text content, and parse the nested text as JSON before reading the business `errcode`. Preserve the unmodified outer response in `raw/`; do not mistake JSON-RPC `isError=false` for business success.
5. Treat business `errcode == 0` as success unless the selected child skill documents a different contract.
6. Record `metadata.backend` as `wecom-cli` and `metadata.backendCliVersion` when known.

## Authentication Recovery

Only enter authorization recovery when the failed `wecom-cli` command returns a non-zero exit or explicit error indicating initialization, login, authorization, or missing MCP configuration. Do not route permission denial, invalid ID, incompatible document type, or missing data through this flow.

1. Preserve the original failed command and all parameters exactly.
2. Start `wecom-cli init --noninteractive --no-open` in a long-running process and retain that process for polling.
3. Extract the first HTTP(S) authorization URL and return only `[打开企业微信授权链接](URL)` plus a request for the user to complete authorization in WeCom. Do not expose raw terminal or ANSI output.
4. Continue polling the same initialization process until it succeeds, times out, or exits abnormally. Returning a link is not authorization success.
5. After success, retry the original command unchanged. If the init process was interrupted, retry the original command once before deciding authorization is still missing.
6. Perform at most two complete authorization rounds. If no URL can be extracted, ask the user to run `wecom-cli init --noninteractive --no-open` and provide the authorization URL.

The authorization URL can expire. Keep polling the process that created it; when the polling process reports timeout, discard the expired URL, start a new initialization process for the next allowed round, and return only the new URL. Never present an old URL as reusable or report authorization success before the retained process succeeds.

Never expose or persist tokens, sessions, cookies, secrets, authorization cache contents, or raw credential output in chat or collection artifacts.

## Ownership Boundary

| Area | Owner |
|------|-------|
| User-facing collection entry and collection boundary | bycli |
| WeCom URL/product routing and command correctness | wecom parent and child skills |
| WeCom IDs, permissions, authentication, polling, pagination | wecom / `wecom-cli` |
| WeCom write-operation confirmation | wecom child skill; outside this bridge |
| Collection directory, index, Markdown, metadata, and raw snapshots | bycli |
| Post-collection processing question and downstream handoff | bycli |

If `wecom-cli` returns an error, do not invent replacement data. Preserve successful partial artifacts and record the failed command, cursor, task ID, or media ID in `metadata.json` without storing credentials.

## Execution Flow

1. Confirm the request is a bycli collection task using the main SKILL.md collection boundary.
2. Detect the WeCom URL type or product intent.
3. Load `wecom` and the matching child skill.
4. Use only the read/export/download commands documented by that child skill.
5. Complete every documented asynchronous export or pagination sequence unless the user requested a bounded subset.
6. Normalize successful backend results into bycli collection artifacts and write them under the bycli session directory.
7. Return a concise collection summary.
8. Ask the standard bycli post-collection processing question: 入库 / 知识整理 / 跳过. 入库 and 知识整理 are mutually exclusive.

Do not ask whether to save a reusable adapter. WeCom bridge runs use a product backend skill, not browser-driving steps that should become adapters.

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
collectionRunName=wecom-wecomcli-<product>-<operation>
```

Examples: `wecom-wecomcli-doc-export`, `wecom-wecomcli-smartpage-export`, `wecom-wecomcli-smartsheet-record-list`, and `wecom-wecomcli-msg-history`.

Treat every collection directory as private because it can contain contacts, conversations, files, and identifiers. Create the run directory with directory mode `0700` and collection files with file mode `0600`. Before using the workspace fallback, verify that `.by-sessions/` is ignored by version control; if it is not ignored, warn explicitly and prefer a private path outside the repository. In all cases, never stage or commit collection artifacts, even when they appear as untracked files.

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

When attachments are explicitly included in the collection, also write them under `files/` and reference those paths from `metadata.json` or the relevant item. Backend temporary downloads are not ingest-ready artifacts until copied into this run directory. Never use a chat media-send directive for historical message attachments.

For contact and message-history collection, prefer:

```text
bycli-output.json
metadata.json
raw/
  contact-get-userlist.json
  msg-chat-list.json
  get-message-<chat>.json
markdown/
  contacts.md
  chat-records.md
files/
  <confirmed-message-attachment>
```

The corresponding paths are `raw/contact-get-userlist.json`, `raw/msg-chat-list.json`, `raw/get-message-<chat>.json`, `markdown/contacts.md`, and `markdown/chat-records.md`. Keep the original JSON-RPC response auditable; if normalized business JSON is stored separately, identify both files in `metadata.json`.

## `bycli-output.json` Contract

Use the normal bycli collection output shape with WeCom provenance:

```json
{
  "title": "WeCom collection title",
  "url": "https://doc.weixin.qq.com/smartpage/...",
  "source": "wecom-cli",
  "backend": "wecom-cli",
  "sourceProduct": "smartpage",
  "operation": "export",
  "items": [
    {
      "title": "Document title",
      "url": "https://doc.weixin.qq.com/smartpage/...",
      "author": "",
      "publish_time": "",
      "markdown": "# ...",
      "fileName": "markdown/document.md"
    }
  ]
}
```

Rules:

- Every `items[].fileName` must point to an existing Markdown file.
- Include already-fetched Markdown inline in `items[].markdown`.
- Keep raw backend JSON in `raw/`; do not treat raw JSON as ingest-ready content by default.
- On partial pagination or export failure, keep successful content and set `metadata.partial=true` with the failed cursor or task ID.

## Product Patterns

### Documents and online sheets

For `/doc/*` and `/sheet/*`, call `wecom-cli doc get_doc_content` with the URL and Markdown type required by the child skill. The first call omits `task_id`; while `task_done=false`, call it again with the returned `task_id`. Write content only after `task_done=true`. For sheet structure or targeted data, use `sheet_get_info` and the child skill's read commands rather than guessing a `sheet_id`.

### Smart documents

For `/smartpage/*`, start with `wecom-cli doc smartpage_export_task --json '<parameters>'`, retain its `task_id`, then poll `wecom-cli doc smartpage_get_export_result --json '{"task_id":"<task_id>"}'` until `task_done=true`. Do not busy-loop; follow the child skill and runner's polling behavior, and preserve the `task_id` as partial-state metadata if the run times out. Store each response in `raw/` when it is needed for audit. After success, extract the returned `content` exactly as backend data, normalize it into `markdown/document.md`, and write or merge a single YAML front matter block containing `bycli_filter` according to the main bycli SKILL.md. Set `items[].fileName` to that existing Markdown path and include the same content in `items[].markdown`. Pass the Markdown path, not raw export JSON, to the bycli `knowledge-ingest` workflow.

### Smart sheets

For `/smartsheet/*`, first fetch the sheet list and real `sheet_id`, then fetch fields when needed to interpret typed values, and finally fetch records. Do not call add, update, or delete commands through this bridge.

### Message history

Resolve the conversation using the child skill instead of guessing `chatid` or `chat_type`. Determine `chat_type` only from explicit user intent, a backend-returned type, or a documented ID format in the selected child skill. If none provides evidence, mark the conversation unresolved and partial instead of calling `get_message`; never default to `chat_type=1`. Preserve a missing `chat_name` as an unnamed conversation with its real `chat_id` rather than inventing a name.

Respect the seven-day query limit. If the requested range is wider, do not silently clamp it: record `metadata.requestedWindow`, the supported `metadata.effectiveWindow`, and `metadata.partial=true`, then tell the user which interval could not be collected. When authorization interrupts a relative range such as “through now,” preserve the start and recompute the end time after authorization, or run an incremental catch-up from the old end to the new end. Because this API returns no stable `message_id`, record that deduplication is best-effort and do not claim lossless merging across overlapping windows.

Fetch every page of `get_msg_chat_list` while `has_more=true`, then fetch every resolved conversation until `next_cursor` is missing or empty. For each chat, compare its reported `msg_count` with the retrieved message count before claiming completeness. If counts differ, a cursor fails, or a type remains unresolved, preserve successful messages and record the chat ID and discrepancy under `metadata.partialDetails`. A missing or empty `next_cursor` means pagination is complete only for that conversation and effective time window.

Normalize returned messages into `markdown/chat-records.md`, retaining `chat_id`, returned `chat_name`, `userid`, `send_time`, `msgtype`, and message content. Download non-text media only when the user explicitly includes attachments or confirms the child skill's download prompt; copy retained files into `files/` and report their paths.

### Contacts

Use `contact get_userlist '{}'` only for the current bot-visible scope. The contact child skill has a 10-person child-skill limit: if the response reaches 10 members, record `metadata.contacts.atSkillLimit=true` and do not infer that the company directory is complete; if it exceeds the supported limit or returns an error, preserve the backend result and mark the contact collection partial. Write the normalized display list to `markdown/contacts.md` and keep `userid` values in the private raw audit artifact unless the user needs them displayed.

## User-Facing Summary

After a successful WeCom collection, tell the user what object was collected, which files were written, whether content is partial, that `wecom-cli` was used, and whether authorization, permission, polling, pagination, or attachment limits applied. Then ask the standard post-collection processing question when required. Do not expose internal route names unless useful for debugging.
