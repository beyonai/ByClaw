---
name: by-knowledge-manager
description: "Manage knowledge base content through the by-knowledge-manager CLI. Use when an agent or user needs to operate a knowledge base: list/create/rename/delete directories, check upload conflicts, upload or overwrite files, trigger or inspect builds, download files or directory archives, read file line ranges, remove files, or run semantic chunk/file search across one or more knowledge base resource IDs."
---

# BY Knowledge Manager

Use this skill to manage knowledge base files and directories, and to search indexed chunks or files semantically.

## Prerequisites

Before running the CLI, install the script dependencies from this skill's `scripts/` directory:

```bash
cd middleware/openclaw/skills/by-knowledge-manager/scripts && npm install
```

Do this before the first run in a new environment, or any time the runtime reports missing Node dependencies.

## Command Entry Point

Start by loading the live command list:

```bash
node scripts/by-knowledge-manager.mjs help
```

Use the runtime environment as provided. The CLI expects backend/auth/discovery environment variables to already be available in that environment. If the user provides a different script path, use the user's path.

Base command pattern:

```bash
node scripts/by-knowledge-manager.mjs <command> [options]
```

For commands that need local files, pass a file path that is readable from the runtime environment:

```bash
node scripts/by-knowledge-manager.mjs upload \
  --resource-id RESOURCE_ID \
  --directory-path /目标目录 \
  --file-path /tmp/local-file.md
```

## Operating Rules

- Determine the target knowledge base before operating. If the user has not specified which knowledge base to access, ask them to provide the target `--resource-id` first.
- For `search` and `search-file`, ask whether to search one knowledge base or multiple knowledge bases when the target is unclear; pass multiple IDs by repeating `--resource-id`.
- Run `help` first when command syntax might have changed; treat the JSON help as authoritative.
- Prefer read-only commands (`list`, `read-file`, `search`, `search-file`, `build-status`, `download`) while exploring.
- Use `--dry-run` on mutating commands when validating paths or payloads before changing the knowledge base.
- Ask before destructive or irreversible operations unless the user explicitly requested them: `delete-dir`, `remove-file`, and overwriting via `update-file`.
- After any file or directory operation that changes knowledge base contents (`mkdir`, `rename-dir`, `delete-dir`, `upload`, `update-file`, `remove-file`), run `list` on the target parent directory to verify the expected result.
- Only upload or update supported knowledge base file types: `.md`, `.markdown`, `.txt`, `.pdf`, `.docx`, `.doc`, `.pptx`, `.ppt`, `.xlsx`, `.xls`, `.csv`. Directly refuse requests to ingest any other file type.
- Preserve knowledge base paths exactly. Paths are absolute inside the knowledge base, such as `/`, `/产品资料`, or `/产品资料/a.md`.
- Report the CLI JSON result back to the user in plain language, especially `ok`, `action`, created/renamed paths, build status, conflict paths, downloaded output path, and search hits.

## Common Workflows

### Inspect a directory

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /
```

Use this before uploading, deleting, or renaming so the current tree shape is known.

### Create or rename directories

Create:

```bash
node scripts/by-knowledge-manager.mjs mkdir --resource-id RESOURCE_ID --directory-path / --directory-name 产品资料
```

Then list the parent directory and confirm the new directory appears:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /
```

Rename:

```bash
node scripts/by-knowledge-manager.mjs rename-dir --resource-id RESOURCE_ID --directory-path /产品资料 --directory-name 产品手册
```

Then list the parent directory and confirm the old name is gone and the new name appears:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /
```

### Upload new files

Only proceed when every target file has one of these extensions: `.md`, `.markdown`, `.txt`, `.pdf`, `.docx`, `.doc`, `.pptx`, `.ppt`, `.xlsx`, `.xls`, `.csv`. If any file has another extension, refuse the upload request instead of calling the CLI.

Check conflicts first when the user does not explicitly want overwrite behavior:

```bash
node scripts/by-knowledge-manager.mjs check-conflicts --resource-id RESOURCE_ID --directory-path /产品资料 --file-name a.md
```

Upload can accept repeated `--file-path` values. Successful upload automatically triggers build for the returned files.

```bash
node scripts/by-knowledge-manager.mjs upload --resource-id RESOURCE_ID --directory-path /产品资料 --file-path /tmp/a.md --check-conflicts
```

Then list the upload directory and confirm the uploaded file appears:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /产品资料
```

Use `--process-front-matter false` only when front matter should be preserved as normal content instead of processed by the backend.

### Overwrite existing files

Only proceed when every replacement file has one of the supported upload extensions: `.md`, `.markdown`, `.txt`, `.pdf`, `.docx`, `.doc`, `.pptx`, `.ppt`, `.xlsx`, `.xls`, `.csv`. If any file has another extension, refuse the update request instead of calling the CLI.

Use `update-file` only when overwrite is intended. It checks conflicts by default and uploads with overwrite enabled.

```bash
node scripts/by-knowledge-manager.mjs update-file --resource-id RESOURCE_ID --directory-path /产品资料 --file-path /tmp/a.md
```

Then list the target directory and confirm the file still exists:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /产品资料
```

Use `--skip-conflict-check` only when the user has already confirmed the target.

### Build and inspect build status

Trigger build for a knowledge base file path:

```bash
node scripts/by-knowledge-manager.mjs build --resource-id RESOURCE_ID --file-path /产品资料/a.md
```

Check status:

```bash
node scripts/by-knowledge-manager.mjs build-status --resource-id RESOURCE_ID --file-path /产品资料/a.md
```

After upload or update, query build status if the user cares about search readiness.

### Download or read files

Download a file:

```bash
node scripts/by-knowledge-manager.mjs download --resource-id RESOURCE_ID --file-path /产品资料/a.md --output /tmp/a.md
```

Download a directory archive:

```bash
node scripts/by-knowledge-manager.mjs download --resource-id RESOURCE_ID --directory-path /产品资料 --output /tmp/产品资料.zip
```

Read file content by line range:

```bash
node scripts/by-knowledge-manager.mjs read-file --resource-id RESOURCE_ID --file-path /产品资料/a.md --start-line 1 --end-line 80
```

Use `read-file` after search hits to inspect surrounding context.

### Semantic chunk search

Search one knowledge base:

```bash
node scripts/by-knowledge-manager.mjs search --resource-id RESOURCE_ID --query "员工请假流程是什么" --top-k 5
```

Search multiple knowledge bases by repeating `--resource-id`:

```bash
node scripts/by-knowledge-manager.mjs search --resource-id RESOURCE_ID_A --resource-id RESOURCE_ID_B --query "员工请假流程是什么" --top-k 10
```

Interpret each search item as a chunk hit with `resourceId`, `filePath`, `chunkNo`, `chunkText`, `score`, and optional `startLine`/`endLine`/`imagePath`. Cite or summarize results by file path and line range when present. When a chunk looks relevant, run `read-file` on the same `filePath` with a slightly wider line range.

### Semantic file search

Use `search-file` when the user wants relevant files first instead of chunk snippets:

```bash
node scripts/by-knowledge-manager.mjs search-file --resource-id RESOURCE_ID --query "故障" --top-k 10
```

Search multiple knowledge bases by repeating `--resource-id`:

```bash
node scripts/by-knowledge-manager.mjs search-file --resource-id RESOURCE_ID_A --resource-id RESOURCE_ID_B --query "故障" --top-k 10
```

Interpret each search item as a file hit with `resourceId`, `filePath`, `score`, and optional `metadata`. When a file looks relevant, run `read-file` on the same `filePath` or `download` it for deeper inspection.

### Delete content

Delete a file:

```bash
node scripts/by-knowledge-manager.mjs remove-file --resource-id RESOURCE_ID --file-path /产品资料/a.md
```

Then list the parent directory and confirm the file is gone:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /产品资料
```

Delete a directory:

```bash
node scripts/by-knowledge-manager.mjs delete-dir --resource-id RESOURCE_ID --directory-path /产品资料
```

Before deletion, list the parent directory and tell the user what will be removed. After deletion, list the parent directory again and confirm the directory is gone:

```bash
node scripts/by-knowledge-manager.mjs list --resource-id RESOURCE_ID --directory-path /
```

## Troubleshooting

- If a command returns `{ "ok": false, "error": "..." }`, fix the path, resource ID, local file path, or auth/env issue and retry only when safe.
- If upload says the local file does not exist, check whether `--file-path` is readable from the runtime environment.
- If search returns no items after upload/update, check `build-status`; the file may not be fully indexed yet.
- If backend discovery or authentication fails, inspect the runtime environment or the env file supplied by the user for the expected connection variables.
