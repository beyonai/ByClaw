---
name: req-bug-ingest
version: 1.0.0
description: |
  从会议记录、PRD、PDF、Word 等来源识别需求与缺陷，像 people/ 一样为每条
  创建独立 brain page（requirements/、bugs/），并回链到源文档、项目与人。
  支持 PDF/DOC 先入库再拆分，也支持对已存在的 meetings/ 或 sources/ 页拆分。
triggers:
  - "extract requirements and bugs"
  - "split requirements from"
  - "split bugs from"
  - "req bug ingest"
  - "从会议提需求"
  - "从文档拆需求"
  - "拆 bug"
  - "拆需求"
  - "PRD 提需求"
  - "导入 PRD 并拆需求"
  - "meeting requirements bugs"
tools:
  - search
  - query
  - get_page
  - put_page
  - add_link
  - add_timeline_entry
  - file_upload
mutating: true
writes_pages: true
writes_to:
  - sources/
  - meetings/
  - requirements/
  - bugs/
  - projects/
  - people/
---

# Req & Bug Ingest — 需求与缺陷独立成页

从 **会议 transcript、PRD、PDF、DOC/DOCX、已 import 的 markdown** 中识别
**需求（requirement）** 与 **缺陷（bug）**，为每条创建独立 slug（与
`people/` 实体页同一思路），并维护源文档索引与交叉链接。

> **Filing rule:** Read `skills/_brain-filing-rules.md` before creating any new page.

> **Notability Gate:** 模糊讨论、TBD、无结论闲聊 — 不建独立页，留在源文档即可。

> **Convention:** See `skills/conventions/quality.md` for Iron Law back-linking.

## Contract

This skill guarantees:
- Every tracked requirement lands under `requirements/{project}-{kebab}`
- Every tracked bug lands under `bugs/{project}-{kebab}`
- A **source hub page** exists (`sources/…` or `meetings/…`) with index sections linking all items
- Binary PDF/DOC: text extracted + original preserved via `upload-raw` before splitting
- Dedup via `search` / `query` before creating duplicate slugs
- Report: requirements/bugs created, updated, skipped

## Phases

### Phase 1: Resolve input → source hub page

Pick **one** path:

| Input | Action |
|-------|--------|
| **Existing brain slug** (`meetings/…`, `sources/…`, imported md) | `gbrain get <slug>` — skip to Phase 2 |
| **PDF / DOC / DOCX file** | Extract text (below), `upload-raw`, `put_page` → `sources/{project}-{basename}` |
| **Raw meeting text** (paste / file) | Structure + `put_page` → `meetings/{YYYY-MM-DD}-{title-kebab}` (or user slug) |

**PDF:** `pdftotext -layout` (OCR if scan — note quality in frontmatter)

**DOCX:** Python zip + `word/document.xml` (see `skills/archive-crawler/SKILL.md`)

**DOC:** `antiword` / `catdoc`

**Reject:** `gbrain capture --file *.pdf` (binary guard). Empty extract → fail loudly.

Source hub frontmatter (minimal):

```yaml
---
title: "{Title}"
type: source          # or meeting for transcripts
format: pdf           # pdf | docx | doc | markdown | transcript
project: projects/myapp
tags: ['req-bug-source']
---
```

Hub body sections (create empty indexes if new):

```markdown
## Summary
{What this document/meeting is}

## Key Decisions
{Decisions only — no separate slug}

## Requirements Index
{Filled in Phase 4}

## Bugs Index
{Filled in Phase 4}
```

Before creating a new hub: `gbrain search "{title}"` — update existing slug if duplicate.

### Phase 2: Extract and classify

Scan hub `compiled_truth` + `timeline`. **Do NOT use conversation-parser** on PRD/PDF —
only for native chat/speaker exports if you already have a parsed meeting page.

| Class | Signals | Action |
|-------|---------|--------|
| **Requirement** | 必须/需要/应/shall/should/功能/用户能够/feature | → `requirements/` |
| **Bug** | bug/缺陷/报错/500/复现/regression/无法/crash | → `bugs/` |
| **Decision** | 决定/方案/ agreed | → hub `## Key Decisions` only |
| **Action item** | 跟进/下周/{人}负责 | → hub or `ops/tasks` — not REQ slug unless user asks |
| **Noise** | TBD/待定/闲聊 | Skip |

Per item capture: **title**, **description**, **source_quote**, **source_section**,
**owner** / **reporter** (`people/…`), **priority** / **severity**.

Attendees / stakeholders: enrich `people/` when notability passes (delegate to
`skills/enrich/SKILL.md` if thin). This skill does **not** replace full
`meeting-ingestion` attendee protocol — chain meeting-ingestion first when the
user needs full meeting + people enrichment, then run this skill for REQ/BUG split.

### Phase 3: Dedup (mandatory)

For each item:

```bash
gbrain search "{keywords} {project}"
gbrain query "{description}" --limit 5
```

Strong match on existing `requirements/` or `bugs/` → **UPDATE** (timeline + source link), do not duplicate.

### Phase 4: Create or update item pages

Slug patterns:

```
requirements/{project}-{short-kebab}
bugs/{project}-{short-kebab}
```

**Requirement page** (abbreviated):

```markdown
---
title: "{title}"
type: note
status: proposed
priority: P1
owner: people/alice-example
project: projects/myapp
source_document: sources/myapp-prd-v2
source_section: "3.2"
tags: ['requirement', 'myapp']
---

# {title}

## Description
{Testable need / acceptance criteria}

## Source
> {source_quote}
From [{hub title}]({source_document}).

## Acceptance Criteria
- [ ] …

## See Also
- [{hub}]({source_document})
- [Project](projects/myapp)
```

**Bug page** (abbreviated):

```markdown
---
title: "{title}"
type: note
status: open
severity: high
reporter: people/bob-example
owner: people/alice-example
project: projects/myapp
source_document: meetings/2026-06-11-standup
tags: ['bug', 'myapp']
---

# {title}

## Description
{Impact}

## Steps to Reproduce
1. …

## Source
> {source_quote}
From [{hub}]({source_document}).

## See Also
- [{hub}]({source_document})
- [Project](projects/myapp)
```

Use `put_page` for each item. Refresh hub **Requirements Index** / **Bugs Index** with markdown links.

On `projects/{project}`: timeline + optional Open Threads listing open items.

### Phase 5: Report

```
Req-bug ingest from {source_slug}:
  hub:          sources/myapp-prd-v2
  requirements: {created} created, {updated} updated, {skipped} skipped
  bugs:         {created} created, {updated} updated, {skipped} skipped
  project:      projects/myapp
```

List new slugs. Suggest: `gbrain search "open bugs myapp"`.

## Output Format

Structured summary as Phase 5. User verifies with `gbrain get requirements/…`.

## Anti-Patterns

- One bullet = one page (merge related items)
- Skip dedup search
- Dump 200-page PDF verbatim into hub (summarize; raw in upload-raw)
- `gbrain capture` on PDF/DOC binary
- conversation-parser on PRD prose
- Bug page without repro or clear failure mode
- Orphan REQ/BUG with no link to source_document or project
- Replacing `meeting-ingestion` when user only asked for attendee enrichment — chain both

## Tools Used

- `get_page` — load hub and existing items
- `search` / `query` — dedup
- `put_page` — hub, requirements, bugs
- `file_upload` / `gbrain files upload-raw` — PDF/DOC provenance
- `add_link` / `add_timeline_entry` — graph when auto-link insufficient (remote MCP)

## Chaining

| When | Do |
|------|-----|
| Full meeting + all attendees enriched | `meeting-ingestion` first, then this skill on `meetings/…` |
| Video/PDF book summary only | `media-ingest` if user wants analysis without REQ/BUG split |
| Already imported markdown | This skill only — pass the imported slug |
