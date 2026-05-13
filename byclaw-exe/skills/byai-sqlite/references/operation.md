# ByAI SQLite Operation Reference

## CLI

```bash
node byai-sqlite/scripts/sql-execute.mjs --sql <sql> [options]
```

Options:

- `--db <path>`: SQLite database file path. Optional override; default is `$BYAI_SQLITE_DB/byclaw.sqlite`.
- `--sql <sql>`: single SQL statement to execute.
- `--params <json>`: JSON array for positional parameters or JSON object for named parameters.
- `--mode <mode>`: `auto`, `all`, `get`, or `run`. Default `auto`.
- `--max-rows <n>`: maximum rows returned by read queries. Default `200`.
- `--busy-timeout-ms <n>`: SQLite busy timeout. Default `5000`.
- `--allow-write`: allow write statements. Default is read-only.
- `--no-create`: fail if the database file does not exist.
- `--pretty`: pretty-print JSON.
- `--help`: show help.

Environment variables:

- `BYAI_SQLITE_DB`: directory containing the default `byclaw.sqlite`.
- `BYAI_SQLITE_MAX_ROWS`
- `BYAI_SQLITE_BUSY_TIMEOUT_MS`
- `BYAI_SQLITE_ALLOW_WRITE`
- `BYAI_SQLITE_NO_CREATE`

## Modes

- `auto`: read statements use `all`; write statements use `run`.
- `all`: return rows.
- `get`: return one row.
- `run`: return `changes` and `lastInsertRowid`.

## Safety Defaults

Writes are disabled unless `--allow-write` is present or `BYAI_SQLITE_ALLOW_WRITE=true`.

Use `--no-create` when the target database should exist. Without it, SQLite may create a new empty database for a misspelled path.

The read/write classifier treats `SELECT`, `WITH` selects, and `EXPLAIN` as reads. It treats suspicious or assignment-style `PRAGMA` statements as writes.
