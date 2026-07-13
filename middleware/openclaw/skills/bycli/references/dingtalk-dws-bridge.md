# DingTalk Connector Bridge

Use this reference when a bycli collection task targets DingTalk data. bycli remains the single collection entry and owns artifacts, post-collection processing prompts, the internal knowledge-ingest workflow, and knowledge-organizer handoff. dws is the DingTalk backend for product-specific commands, IDs, permissions, and authentication.

## Trigger Conditions

Route through this bridge when the user asks bycli to collect, scrape, crawl, fetch, download, archive, or ingest DingTalk data, including:

| Input | Backend product / capability |
|------|-------------|
| `shanji.dingtalk.com` AI minutes URLs | dws `minutes` |
| `alidocs.dingtalk.com` documents | dws `doc` / `sheet` / `drive` |
| DingTalk AI minutes, meeting transcripts, summaries, todos, speakers | dws `minutes` |
| DingTalk docs, online sheets, cloud drive files, wiki content | dws product capability |
| DingTalk calendar, todo, report, mail, contact, chat data requested as collection input | dws product capability |

Do not use browser driving, curl, HTTP APIs, or generic web scraping for DingTalk collection unless dws is unavailable or explicitly reports that the operation is unsupported.

## Backend Selection

1. Load dws.
2. Follow dws instructions for the DingTalk product or URL.
3. For dws commands, include `--format json` on every command that supports formatted output.
4. Record `metadata.backend` as `dws`.

## Ownership Boundary

| Area | Owner |
|------|-------|
| User-facing collection entry | bycli |
| Determining whether the request is a collection task | bycli |
| DingTalk URL routing and product command correctness | dws |
| DingTalk IDs, taskUuid extraction, permission errors, auth errors | dws |
| Dangerous DingTalk write/delete confirmation | dws |
| Collection output directory | bycli |
| `bycli-output.json`, Markdown files, metadata, raw snapshots | bycli |
| Post-collection processing question, internal knowledge-ingest workflow, and knowledge-organizer handoff | bycli |

If dws returns an error, do not invent replacement data. Report the failed step and preserve any successful partial artifacts.

## Execution Flow

1. Confirm the request is a bycli collection task using the main SKILL.md collection boundary.
2. Detect DingTalk domain or product intent.
3. Load dws and the relevant dws product reference.
4. Use only dws. For dws commands, include `--format json` on every command that supports formatted output.
5. Normalize successful backend results into bycli collection artifacts.
6. Write artifacts under the bycli session directory.
7. Return a concise collection summary.
8. If the result satisfies the bycli collection boundary, ask the standard bycli post-collection processing question: 入库 / 知识整理 / 跳过. 入库 and 知识整理 are mutually exclusive. If the user chooses 入库, enter the bycli internal knowledge-ingest workflow with the selected Markdown / supported document file paths. If the user chooses 知识整理, hand the selected files to knowledge-organizer. If the user asks for both, ask them to choose one.

Do not ask whether to save a reusable adapter for DingTalk bridge runs. DingTalk collection is backed by a DingTalk backend skill, not by browser-driving steps that should become adapters.

## Output Directory

Use the standard bycli path template:

```text
/by/.sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

If `/by` is unavailable or the root filesystem is read-only during local validation, use:

```text
<workspace>/.by-sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

Set `metadata.storageFallback=true` and record the reason. Do not silently switch paths.

For DingTalk bridge runs, set:

```text
collectionRunName=dingtalk-dws-<product>-<operation>
```

Examples:

```text
dingtalk-dws-minutes-transcribe
dingtalk-dws-doc-export
dingtalk-dws-sheet-read
dingtalk-dws-drive-download
```

If the current environment does not expose a stable session ID, use the active thread or workspace session identifier if available; otherwise use `manual` and record the limitation in `metadata.json`.

## Required Artifact Layout

For each DingTalk collection run, write:

```text
bycli-output.json
metadata.json
raw/
  <backend-command>.json
markdown/
  <content>.md
```

For AI minutes, prefer:

```text
bycli-output.json
metadata.json
raw/
  info.json
  summary.json
  keywords.json
  todos.json
  transcription-page-0001.json
  transcription-page-0002.json
markdown/
  summary.md
  todos.md
  transcription.md
```

When DingTalk content is paginated, fetch all pages by default until dws reports no more pages. Write long content to Markdown files and keep the chat response concise; do not paste full transcripts or large documents into the final reply unless the user explicitly asks.

## `bycli-output.json` Contract

Use the normal bycli collection output shape and add DingTalk backend provenance fields. The bycli internal knowledge-ingest workflow uploads selected files, knowledge-organizer organizes selected files, and `bycli-output.json` remains the index and audit record.

```json
{
  "title": "DingTalk collection title",
  "url": "https://shanji.dingtalk.com/app/transcribes/...",
  "source": "dws",
  "backend": "dws",
  "sourceProduct": "minutes",
  "operation": "summary+transcription",
  "items": [
    {
      "title": "AI summary",
      "url": "https://shanji.dingtalk.com/app/transcribes/...",
      "author": "",
      "publish_time": "",
      "markdown": "# ...",
      "fileName": "markdown/summary.md"
    }
  ]
}
```

Rules:

- `items[].fileName` must point to an existing Markdown file.
- Include the Markdown body inline in `items[].markdown` for already-fetched content.
- If pagination fails after some pages were fetched, preserve partial files and set `metadata.partial=true` with the failed cursor or token.
- Keep raw backend JSON in `raw/`; do not treat raw JSON as ingest-ready content unless the user explicitly asks for JSON archival.

## AI Minutes Pattern

For `shanji.dingtalk.com/app/transcribes/<taskUuid>`:

Bare collection requests such as "采集 <shanji URL>" mean a full AI minutes collection by default: info, summary, keywords, todos, and full transcription.

1. Load dws and the relevant minutes instructions.
2. Extract the taskUuid from the URL path segment after `/transcribes/`, excluding query string, unless dws accepts the full URL directly.
3. Run `dws minutes get info --id <taskUuid> --format json`.
4. Run `dws minutes get summary --id <taskUuid> --format json`.
5. Run `dws minutes get keywords --id <taskUuid> --format json`.
6. Run `dws minutes get todos --id <taskUuid> --format json`.
7. Run `dws minutes get transcription --id <taskUuid> --format json`, then continue fetching all pages using the current dws `--help` pagination flag until `hasNext=false`. Current binaries may use `--cursor` instead of older `--next-token`.
8. Write raw JSON and Markdown artifacts.
9. Ask the bycli post-collection processing question when collection artifacts are ready. If the user chooses 入库, enter the bycli internal knowledge-ingest workflow for selected Markdown / supported document files. If the user chooses 知识整理, hand selected files to knowledge-organizer. If the user asks for both, ask them to choose one; do not run both.

If access fails with a backend permission error, report that the DingTalk minutes may not be shared with the current user. Do not retry with browser scraping.

## User-Facing Summary

After a successful DingTalk collection, tell the user:

- what DingTalk object was collected;
- which files were written;
- whether the transcript or document is partial;
- that dws was used;
- whether there were permission, auth, or pagination limits;
- the standard bycli post-collection processing question, when applicable.

Do not expose internal route names unless useful for debugging.
