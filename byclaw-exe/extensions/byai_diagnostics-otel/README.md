# BYAI Diagnostics OpenTelemetry (bundled `diagnostics-otel` slot)

BYAI fork of the OpenClaw diagnostics OTLP exporter. It registers as **`diagnostics-otel`** (not `byai_diagnostics-otel`) so the stock core grants `internalDiagnostics` without openclaw source changes.

## Langfuse / BYAI behavior

- `langfuse.session.id` from `sessionKey` / `sessionId`
- `langfuse.user.id` from BYAI inbound `userId` (per-`sessionKey` cache, fallback `USER_CODE`)
- byai-channel inbound parent spans linked to agent runs
- forced model/tool input/output capture when content is available
- tool I/O mapped to `input.value` / `output.value` for Langfuse

Use the same top-level `diagnostics.otel` config as stock `diagnostics-otel`.

Content attribute limits can be configured under
`plugins.entries.diagnostics-otel.config.contentLimits`. The exporter also reads
`diagnostics.otel.contentLimits` for hosts whose diagnostics config schema
allows it. When omitted, this fork follows the stock defaults: 128 KiB per
content attribute and 200 items per content array.

```json
{
  "plugins": {
    "entries": {
      "diagnostics-otel": {
        "config": {
          "contentLimits": {
            "maxAttributeChars": 131072,
            "maxArrayItems": 200
          }
        }
      }
    }
  }
}
```

Alternative host-level form when accepted by the OpenClaw config schema:

```json
{
  "diagnostics": {
    "otel": {
      "contentLimits": {
        "maxAttributeChars": 131072,
        "maxArrayItems": 200
      }
    }
  }
}
```

## Enable inbound spans for native channels

By default this build treats **`byai-channel`** and **`webchat`** as
"inbound-owning" channels — they get the outer `openclaw.message.inbound`
SERVER span that parents `run`, `model.call`, and `tool.execution` spans under
a single trace tree (this is what Langfuse consumes as the top-level trace).

To enable it for another native channel without touching openclaw source, pass
`inboundChannels` when registering the service:

```ts
createDiagnosticsOtelService({
  // ...other options...
  inboundChannels: {
    channels: ["byai-channel", "webchat", "your-channel-id"],
    sources: ["byai-channel-sdk"],
  },
});
```

`inboundChannels` accepts either a bare `string[]` (channels only; sources
fall back to the BYAI SDK default) or the `{ channels, sources }` object form.
Any channel not on the list still emits every metric — only the outer
`message.inbound` span is skipped for it.

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
