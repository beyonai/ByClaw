# bycli Knowledge Ingest

Use this reference when a bycli collection run has already written artifacts and the user chooses "入库". This is an internal bycli workflow, not a handoff to a separate `bycli-ingest` skill.

## Ownership

| Area | Owner |
|------|-------|
| Collection, DingTalk/backend routing, and artifact writing | bycli |
| Post-collection question | bycli |
| Reading `bycli-output.json` and selected Markdown/doc files | bycli knowledge-ingest workflow |
| Normalization, knowledge-base selection, missing-body supplement, summary confirmation, and cleanup state | bycli knowledge-ingest workflow |
| Low-level knowledge-base upload/build/list/check operations | by-knowledge-manager |
| Knowledge organization | knowledge-organizer |

入库 and 知识整理 are mutually exclusive. If the user asks for both, ask them to choose one. Do not order or combine them.

## Inputs

The workflow accepts a bycli session timestamp directory:

```text
/by/.sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
  bycli-output.json
  <fileName>.md
```

Local validation may use:

```text
<workspace>/.by-sessions/<sessionId>/<collectionRunName>/<YYYYMMDD_HHMMSS>/
```

Minimum handoff data:

- session timestamp directory path;
- `bycli-output.json`;
- selected item range: all / specified items / first N;
- already written Markdown or supported document file paths;
- optional target knowledge-base `resource-id`;
- optional `directory-path`, defaulting to `/`.

## Flow

1. Read the selected bycli session directory and `bycli-output.json`.
2. Resolve the selected item range.
3. For already written Markdown files, reuse local files and do not recollect.
4. For selected items beyond the first 10 prewritten bodies, supplement each body first, append Markdown files to the same session directory, then continue.
5. If the target knowledge base is unknown, run `list-kb` and ask the user to choose.
6. Run `normalize` as a dry preview and show source, file count, selected file names, target knowledge base, and target directory.
7. Only after user confirmation, run `ingest`.
8. On success, clean the timestamp directory unless `audit_required=true` or the user asked to keep artifacts.
9. On failure or skip, keep artifacts for audit and retry.

## Commands

Run commands from the repository root unless another working directory is explicitly needed:

```bash
node bycli/scripts/bycli-markdown-ingest.mjs list-kb --keyword "默认" --page-num 1 --page-size 20
```

```bash
node bycli/scripts/bycli-markdown-ingest.mjs normalize \
  --bycli-json-file "$SESSION_DIR/bycli-output.json" \
  --knowledge-base-resource-id <resourceId> \
  --directory-path /
```

```bash
node bycli/scripts/bycli-markdown-ingest.mjs ingest \
  --bycli-json-file "$SESSION_DIR/bycli-output.json" \
  --knowledge-base-resource-id <resourceId> \
  --directory-path /
```

The `ingest` command prefers existing Markdown files in the bycli session directory. Only inline Markdown without a readable local file is written to a temporary file before upload. It then calls:

```bash
node by-knowledge-manager/scripts/by-knowledge-manager.mjs upload \
  --resource-id <resourceId> \
  --directory-path / \
  --file-path <temp-md-file>
```

`BY_KNOWLEDGE_MANAGER_SCRIPT` or `--knowledge-manager-script` may override the manager script path.

Existing file resolution order:

1. `--markdown-file` local path;
2. `items[].fileName` under `--session-dir`;
3. `items[].fileName` under `bycli-output.json` directory;
4. `items[].fileName` under `collectionResult.outputDir`;
5. temporary Markdown file under `/tmp/bycli-knowledge-ingest-*` as fallback.

## File Type Rules

- Markdown / plain text: normalize and ingest.
- Supported documents (`pdf/docx/pptx/xlsx/csv/txt/md`): use `upload-doc` when directly ingesting original files.
- Images/audio/video: upload to chat files only; they do not enter the knowledge base.
- Unsupported binary files: do not coerce into Markdown.

## Cleanup

| Result | Artifact policy |
|--------|-----------------|
| Ingest success | clean timestamp directory contents unless protected |
| Ingest failure | keep artifacts |
| User skips ingest | keep artifacts |
| `audit_required=true` | never delete automatically |
| User says keep | keep artifacts |

## Never

- Do not call the old `bycli-ingest` skill or scripts.
- Do not use ecosystemCollection `artifacts/store` or `knowledge/import`.
- Do not ask about knowledge organization after the user has chosen ingest; the two options are mutually exclusive.
- Do not delete artifacts after failure.
