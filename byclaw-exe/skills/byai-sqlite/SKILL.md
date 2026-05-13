---
name: byai-sqlite
description: Operate local SQLite database files directly from a standard skill. Use when Codex, OpenClaw, Claude Code, or another skill-capable agent needs to inspect SQLite schemas, run SELECT queries, execute parameterized SQL, or make explicit local SQLite changes without relying on a product-specific plugin, gateway, or HTTP endpoint.
---

# ByAI SQLite

Use this skill to operate a local SQLite database file directly. This skill is independent of `byclaw-sqlite` and does not call or expose any HTTP endpoint.

The reusable capability is implemented by `scripts/sql-execute.mjs`, a dependency-free Node.js script that uses `node:sqlite`.

## Quick Start

Inspect tables:

```bash
node byai-sqlite/scripts/sql-execute.mjs \
  --sql "select name, type from sqlite_master where type in ('table', 'view') order by name" \
  --mode all \
  --pretty \
  --no-create
```

Query with parameters:

```bash
node byai-sqlite/scripts/sql-execute.mjs \
  --sql "select * from users where id = ?" \
  --params '[123]' \
  --mode get \
  --pretty \
  --no-create
```

Write only when the user explicitly requests it:

```bash
node byai-sqlite/scripts/sql-execute.mjs \
  --sql "update users set name = ? where id = ?" \
  --params '["Alice", 123]' \
  --mode run \
  --allow-write \
  --no-create \
  --pretty
```

## Workflow

1. Run examples from the `skills` directory, so the script path is `byai-sqlite/scripts/sql-execute.mjs`.
2. Resolve the database file path. By default the script opens `$BYAI_SQLITE_DB/byclaw.sqlite`; pass `--db` only when targeting another SQLite file.
3. Use `--no-create` when the database should already exist, so a typo or missing `BYAI_SQLITE_DB` does not create an empty database.
4. Inspect schema before writing queries:
   - `select name, type from sqlite_master where type in ('table', 'view') order by name`
   - `pragma table_info(table_name)`
   - `pragma foreign_key_list(table_name)`
5. Run reads first with `--mode all` or `--mode get`.
6. Use `--params` for user-provided values. Pass positional params as JSON arrays and named params as JSON objects.
7. Keep writes disabled by default. Add `--allow-write` only for deliberate `insert`, `update`, `delete`, DDL, migrations, or PRAGMA writes.
8. Prefer explicit transactions for multi-step changes.

## Output Contract

The script prints one JSON object.

Success:

```json
{
  "ok": true,
  "data": {
    "dbPath": "app.sqlite",
    "mode": "all",
    "statementType": "SELECT",
    "durationMs": 2,
    "maxRowsApplied": 200,
    "truncated": false,
    "rowCount": 1,
    "columns": ["id", "name"],
    "rows": [{"id": 123, "name": "Alice"}]
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "sqlite_error",
    "message": "near ...: syntax error"
  }
}
```

## Script Notes

- Run `node byai-sqlite/scripts/sql-execute.mjs --help` from the `skills` directory for the full CLI.
- The script returns nonzero exit status when `ok` is `false`.
- `bigint` values are emitted as strings.
- `Uint8Array`/BLOB values are emitted as base64 objects.
- Read results are capped by `--max-rows`, default `200`.
- The script uses `PRAGMA foreign_keys = ON` and `PRAGMA busy_timeout`.
