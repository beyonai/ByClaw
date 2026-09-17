---
name: byai-knowledge-agent
description: Use when an Agent needs to create, inspect, search, upload, update, move, download, or delete content in an authorized ByAI knowledge base from a runtime session.
---

# ByAI Knowledge Agent

Use `kbcli` as the only knowledge-base access path. Never call Controller URLs directly.

## Workflow

1. Obtain `session_id` only from the current Skill runtime input.
2. Identify the exact knowledge base and remote paths. Never guess a `resource_id`.
3. Run `kbcli describe <group> <command> --format json` before coding against an unfamiliar output.
4. Run the smallest matching `kbcli` command.
5. Parse stdout as JSON and require exit code `0` plus `ok: true`.
6. For multi-step writes, stop on the first failure and report completed steps.

Do not pass endpoint, host, port, token, service name, or Redis configuration. Service discovery and
authentication belong to `kbcli` and the platform runtime.

Modification and deletion execute once without a CLI confirmation flag. Use them only when the user's
request clearly authorizes that exact mutation. Do not invent `--confirm`, `--yes`, or `--endpoint`.

Run `kbcli <group> <command> --help` for syntax. Read
[`references/commands.md`](references/commands.md) for request schemas and examples.

`describe` is local and needs no session or service connection:

```bash
kbcli describe base get --format json
kbcli describe --all --format json
```

Use its `output.dataType`, envelope, notes, and errors as the contract. Do not execute a live request merely
to discover request or response fields, and do not infer fields from an opaque DTO name. Do not inspect the
installed package source or batch-probe alternative field names. If `describe` or `--help` is incomplete,
stop and report the CLI contract gap.

For file content, use the explicit command directly:

```bash
kbcli file read --session-id "$session_id" --resource-id RESOURCE_ID --path /docs/file.md
```

Add `--start-line` and `--end-line` only for pagination. A parameter error is not a service outage: do not
retry it or try alternate names such as `directoryPath`, `path`, and `filePath` through live requests.

For an authorized upload, verify that the local path exists and execute the requested upload once:

```bash
kbcli file upload --session-id "$session_id" --resource-id RESOURCE_ID \
  --directory /target --file /absolute/local/file.xls
```

Do not create a dummy file, inspect file magic, or repeat the upload to diagnose the transport. The file name
extension is not a reason to skip an explicitly requested upload. If the command fails, use its structured error
once and stop; a write can have an uncertain remote result even when the CLI reports a transport failure.

After uploading or updating a file, build it only when the user requests searchable content:

```bash
kbcli build start --session-id "$session_id" --resource-id RESOURCE_ID --path /target/file.md
kbcli build status --session-id "$session_id" --resource-id RESOURCE_ID --path /target/file.md
kbcli build result --session-id "$session_id" --resource-id RESOURCE_ID --path /target/file.md
```

Use `build convert` when the requested output is a local Markdown file only. Use `build from-doc --doc-file`
when Markdown must be uploaded and built in one operation. Never substitute `file upload` for conversion or
claim that upload alone makes a document searchable. Treat `build start` and `build from-doc` as mutations:
execute once, then inspect with `build status` or `build result` rather than submitting them again.

## Output handling

Return useful fields from `data`; do not expose session IDs or runtime credentials. Treat any nonzero exit
or `ok: false` as failure. Do not use `|| true`, and do not retry mutations automatically. Only retry a read
once when the CLI explicitly returns `retryable: true`; never retry `INVALID_ARGUMENT`.

For downloads, report success only after `data.size` is positive and the output exists. `EMPTY_DOWNLOAD`
means no final output was installed; do not retry automatically, delete unrelated files, or diagnose the backend
without independent evidence. Keep any pre-existing destination unchanged unless the user explicitly used force.
