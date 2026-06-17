# BYAI Diagnostics OpenTelemetry (bundled `diagnostics-otel` slot)

BYAI fork of the OpenClaw diagnostics OTLP exporter. It registers as **`diagnostics-otel`** (not `byai_diagnostics-otel`) so the stock core grants `internalDiagnostics` without openclaw source changes.

## Langfuse / BYAI behavior

- `langfuse.session.id` from `sessionKey` / `sessionId`
- `langfuse.user.id` from BYAI inbound `userId` (per-`sessionKey` cache, fallback `USER_CODE`)
- byai-channel inbound parent spans linked to agent runs
- forced model/tool input/output capture when content is available
- tool I/O mapped to `input.value` / `output.value` for Langfuse

Use the same top-level `diagnostics.otel` config as stock `diagnostics-otel`.

## Plan 1 deploy (recommended, no openclaw repo edits)

Replace the **bundled** `diagnostics-otel` artifact in your openclaw install:

```bash
cd byclaw-exe/extensions/byai_diagnostics-otel
npm install
OPENCLAW_ROOT=/path/to/openclaw npm run deploy:openclaw-bundled
```

This writes to:

- `$OPENCLAW_ROOT/dist/extensions/diagnostics-otel`
- `$OPENCLAW_ROOT/dist-runtime/extensions/diagnostics-otel`

### `openclaw.json`

```json
"plugins": {
  "entries": {
    "diagnostics-otel": { "enabled": true }
  }
}
```

- **Do not** put `diagnostics-otel` in `plugins.load.paths`
- **Do not** enable `byai_diagnostics-otel` (legacy id; no `internalDiagnostics`)

Restart gateway and confirm logs **do not** contain `internal diagnostics capability unavailable`.

## Build only

```bash
npm run build
```

## Tool input/output

Full tool I/O on spans needs core `privateData.toolContent` on diagnostic events. Without it, tool spans may only show `paramsSummary` metadata.
