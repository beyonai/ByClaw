# Normalized Record

Every normalized candidate uses this stable JSON shape:

```json
{
  "kind": "skill",
  "name": "example",
  "description": null,
  "author": null,
  "repository": null,
  "path": null,
  "version": null,
  "sources": [],
  "metrics": {},
  "updatedAt": null,
  "installCommands": {},
  "security": { "status": "unknown", "reasons": [] },
  "provenance": {
    "provider": "skills-sh",
    "retrievedAt": "2026-08-11T00:00:00.000Z",
    "rawId": "skills-sh:example"
  }
}
```

- `kind` is only `skill` or `mcp`.
- `name` identifies the candidate; `description` and `author` are source-supplied text when available.
- Every absent source-provided optional value remains `null`; never synthesize an empty string.
- `sources` records source-specific discovery details. `metrics` holds platform metrics per source and they are never summed across platforms.
- `installCommands` contains source-provided installation commands keyed by their applicable context; it does not infer credentials.
- `security.status` is the assessed status and `security.reasons` explains it. Unknown remains `unknown`.
- `provenance` is mandatory: `provider` identifies the adapter, `retrievedAt` is its retrieval timestamp, and `rawId` is the provider's unmodified identifier. For every normalized external record, all three are non-empty strings and `retrievedAt` is a valid ISO 8601 timestamp.
