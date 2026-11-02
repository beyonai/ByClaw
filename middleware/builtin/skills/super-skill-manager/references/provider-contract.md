# Provider Contract

Each provider returns one structured envelope. Success and failure use these exact shapes:

```js
{ ok: true, source: 'skills-sh', data: [], warnings: [], elapsedMs: 12 }
{
  ok: false,
  source: 'glama',
  data: [],
  error: { code: 'SOURCE_TIMEOUT', message: 'glama exceeded 8000 ms' },
  elapsedMs: 8001
}
```

Adapters retrieve and normalize source records into the shared data model. Providers own inventory and lifecycle operations for `openclaw`, `builtin-repo`, and `byclaw-workspace`. A provider must not mix path, authentication, or deletion semantics with another provider.
