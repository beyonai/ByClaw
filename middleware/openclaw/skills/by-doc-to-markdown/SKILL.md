---
name: by-doc-to-markdown
description: "Convert documents to Markdown files through the by-doc-to-markdown CLI. Use when an agent or user needs to turn a local document into Markdown: supports .pdf, .doc, .docx, .xls, .xlsx, .ppt, and .pptx as input, calls the backend fileToMarkdown endpoint via service discovery, and writes the converted Markdown to a local file."
---

# BY Doc To Markdown

Use this skill to convert local documents (PDF/Word/Excel/PowerPoint) into Markdown files.

## Prerequisites

Before running the CLI, install the script dependencies from this skill's `scripts/` directory:

```bash
cd middleware/openclaw/skills/by-doc-to-markdown/scripts && npm install
```

Do this before the first run in a new environment, or any time the runtime reports missing Node dependencies.

## Command Entry Point

Start by loading the live command list:

```bash
node scripts/by-doc-to-markdown.mjs help
```

Use the runtime environment as provided. The CLI expects backend/auth/discovery environment variables to already be available in that environment. If the user provides a different script path, use the user's path.

Base command pattern:

```bash
node scripts/by-doc-to-markdown.mjs <command> [options]
```

For the convert command, pass a local file path that is readable from the runtime environment:

```bash
node scripts/by-doc-to-markdown.mjs convert --file-path /tmp/AOCI.pdf --output /tmp/AOCI.md
```

## Operating Rules

- Only convert supported document types: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`. Directly refuse requests to convert any other file type instead of calling the CLI.
- Confirm the input file exists and is readable from the runtime environment before converting.
- Run `help` first when command syntax might have changed; treat the JSON help as authoritative.
- Use `--dry-run` to preview the resolved input/output paths and target URL before performing the conversion.
- For a single input file, use `--output` to name the Markdown file. For multiple input files (repeated `--file-path`), use `--output-dir` to place each converted file as `<basename>.md`; do not combine `--output` with multiple `--file-path` values.
- When neither `--output` nor `--output-dir` is given, the Markdown is written next to the source file with the same base name and a `.md` extension.
- After a successful conversion, confirm the output file exists and report its path, size in bytes, and character count back to the user in plain language.
- If the CLI returns `{ "ok": false, "error": "..." }`, fix the input path, file type, or auth/env issue and retry only when safe.
- If backend discovery or authentication fails, inspect the runtime environment or the env file supplied by the user for the expected connection variables.

## Common Workflows

### Convert a single document

```bash
node scripts/by-doc-to-markdown.mjs convert --file-path /tmp/AOCI.pdf --output /tmp/AOCI.md
```

### Convert a document in place (Markdown written beside the source)

```bash
node scripts/by-doc-to-markdown.mjs convert --file-path /tmp/AOCI.pdf
```

The output becomes `/tmp/AOCI.md`.

### Convert multiple documents into a directory

```bash
node scripts/by-doc-to-markdown.mjs convert --file-path /tmp/a.pdf --file-path /tmp/b.docx --output-dir /tmp/markdown
```

Each file is written as `<basename>.md` inside `/tmp/markdown`.

### Preview before converting

```bash
node scripts/by-doc-to-markdown.mjs convert --file-path /tmp/AOCI.pdf --output /tmp/AOCI.md --dry-run
```

## Troubleshooting

- If a command returns `{ "ok": false, "error": "不支持的文件类型..." }`, the input extension is not in `.pdf/.doc/.docx/.xls/.xlsx/.ppt/.pptx`; refuse the request rather than retrying with the same file.
- If a command returns `{ "ok": false, "error": "文件不存在..." }`, check whether `--file-path` is readable from the runtime environment and expand `~` paths correctly.
- If backend discovery or authentication fails, inspect the runtime environment or the env file supplied by the user for the expected connection variables (`REDIS_HOST`, `BE_DOMAINNAME`, `Beyond-Token`/session files, etc.).
- If the output file is empty, the backend may have returned an empty result for an unreadable or scanned document; check the source file and retry.
