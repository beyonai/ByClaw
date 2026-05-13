#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function printHelp() {
  console.log(`Usage: node sql-execute.mjs --db <path> --sql <sql> [options]

Options:
  --db <path>               SQLite database path. Defaults to $BYAI_SQLITE_DB/byclaw.sqlite
  --sql <sql>               SQL statement to execute
  --params <json>           Positional array or named object parameters
  --mode <mode>             auto, all, get, or run. Default: auto
  --max-rows <n>            Maximum rows returned for read queries. Default: 200
  --busy-timeout-ms <n>     SQLite busy timeout. Default: 5000
  --allow-write             Allow INSERT/UPDATE/DELETE/DDL statements
  --no-create               Fail if the database file does not exist
  --pretty                  Pretty-print JSON
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--allow-write") {
      args.allowWrite = true;
    } else if (arg === "--no-create") {
      args.noCreate = true;
    } else if (arg === "--pretty") {
      args.pretty = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readPositiveInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function readBooleanEnv(value) {
  if (value == null) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function resolveConfig(args) {
  const rawDbPath = args.db || defaultDbPath();
  if (!rawDbPath) {
    throw new Error("Missing --db or BYAI_SQLITE_DB. Default database is $BYAI_SQLITE_DB/byclaw.sqlite.");
  }
  const sql = typeof args.sql === "string" ? args.sql.trim() : "";
  if (!sql) {
    throw new Error("Missing --sql.");
  }
  return {
    dbPath: path.resolve(String(rawDbPath)),
    sql,
    params: parseParams(args.params),
    mode: readMode(args.mode),
    maxRows: readPositiveInteger(args.maxRows || process.env.BYAI_SQLITE_MAX_ROWS, 200),
    busyTimeoutMs: readPositiveInteger(
      args.busyTimeoutMs || process.env.BYAI_SQLITE_BUSY_TIMEOUT_MS,
      5000,
    ),
    allowWrite: args.allowWrite === true || readBooleanEnv(process.env.BYAI_SQLITE_ALLOW_WRITE),
    noCreate: args.noCreate === true || readBooleanEnv(process.env.BYAI_SQLITE_NO_CREATE),
    pretty: args.pretty === true,
  };
}

function defaultDbPath() {
  const baseDir = process.env.BYAI_SQLITE_DB?.trim();
  return baseDir ? path.join(baseDir, "byclaw.sqlite") : "";
}

function parseParams(value) {
  if (value == null || value === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) && (!parsed || typeof parsed !== "object")) {
      throw new Error("params must be a JSON array or object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid --params JSON: ${error.message}`);
    }
    throw error;
  }
}

function loadSqlite() {
  try {
    return require("node:sqlite");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`node:sqlite is unavailable in this runtime: ${message}`);
  }
}

function openDatabase(config) {
  if (config.noCreate && !fs.existsSync(config.dbPath)) {
    throw new Error(`Database does not exist: ${config.dbPath}`);
  }
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${config.busyTimeoutMs}`);
  return db;
}

function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toJsonSafe(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return {
      type: "bytes",
      encoding: "base64",
      data: Buffer.from(value).toString("base64"),
      byteLength: value.byteLength,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafe(entry));
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonSafe(entry)]));
  }
  return value;
}

function normalizeRows(rows) {
  return rows.map((row) => (isPlainRecord(row) ? toJsonSafe(row) : {}));
}

function readMode(value) {
  return value === "all" || value === "get" || value === "run" || value === "auto" ? value : "auto";
}

function stripLeadingSqlComments(sql) {
  return sql
    .trim()
    .replace(/^(?:\s*--.*(?:\n|$)|\s*\/\*[\s\S]*?\*\/\s*)+/g, "")
    .trim();
}

function detectStatementType(sql) {
  const normalized = stripLeadingSqlComments(sql);
  const first = normalized.match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  if (!first) {
    return "UNKNOWN";
  }
  if (first !== "WITH") {
    return first;
  }
  if (/\bINSERT\b/i.test(normalized)) return "INSERT";
  if (/\bUPDATE\b/i.test(normalized)) return "UPDATE";
  if (/\bDELETE\b/i.test(normalized)) return "DELETE";
  if (/\bREPLACE\b/i.test(normalized)) return "REPLACE";
  if (/\bSELECT\b/i.test(normalized)) return "SELECT";
  return "WITH";
}

function isReadStatementType(statementType, sql) {
  if (["EXPLAIN", "SELECT", "WITH"].includes(statementType)) {
    return true;
  }
  if (statementType !== "PRAGMA") {
    return false;
  }
  const normalized = stripLeadingSqlComments(sql);
  if (normalized.includes("=")) {
    return false;
  }
  return !/\b(?:journal_mode|foreign_keys|user_version|application_id|schema_version|writable_schema|locking_mode|synchronous|temp_store)\b\s*\(/i.test(
    normalized,
  );
}

function resolveEffectiveMode(statementType, mode, sql) {
  if (mode !== "auto") {
    return mode;
  }
  return isReadStatementType(statementType, sql) ? "all" : "run";
}

function resolveStatementArgs(params) {
  if (Array.isArray(params)) {
    return params;
  }
  if (isPlainRecord(params)) {
    return [params];
  }
  return [];
}

function runStatement(statement, method, params) {
  return statement[method](...resolveStatementArgs(params));
}

function resolveColumns(rows) {
  return rows[0] ? Object.keys(rows[0]) : undefined;
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function executeSql(db, config) {
  const statementType = detectStatementType(config.sql);
  const effectiveMode = resolveEffectiveMode(statementType, config.mode, config.sql);

  if (!config.allowWrite && (!isReadStatementType(statementType, config.sql) || effectiveMode === "run")) {
    return failure("write_disabled", `Write statements are disabled: ${statementType}.`);
  }

  const startedAt = Date.now();
  try {
    const statement = db.prepare(config.sql);
    if (effectiveMode === "run") {
      const result = runStatement(statement, "run", config.params);
      return {
        ok: true,
        data: {
          dbPath: path.basename(config.dbPath),
          mode: effectiveMode,
          statementType,
          durationMs: Date.now() - startedAt,
          maxRowsApplied: config.maxRows,
          truncated: false,
          changes: typeof result?.changes === "number" ? result.changes : 0,
          lastInsertRowid: result?.lastInsertRowid == null ? null : toJsonSafe(result.lastInsertRowid),
        },
      };
    }

    if (effectiveMode === "get") {
      const rawRow = runStatement(statement, "get", config.params);
      const row = rawRow && isPlainRecord(rawRow) ? toJsonSafe(rawRow) : null;
      return {
        ok: true,
        data: {
          dbPath: path.basename(config.dbPath),
          mode: effectiveMode,
          statementType,
          durationMs: Date.now() - startedAt,
          maxRowsApplied: config.maxRows,
          truncated: false,
          rowCount: row ? 1 : 0,
          columns: row ? Object.keys(row) : undefined,
          row,
        },
      };
    }

    const rows = normalizeRows(runStatement(statement, "all", config.params));
    const truncated = rows.length > config.maxRows;
    const limitedRows = truncated ? rows.slice(0, config.maxRows) : rows;
    return {
      ok: true,
      data: {
        dbPath: path.basename(config.dbPath),
        mode: effectiveMode,
        statementType,
        durationMs: Date.now() - startedAt,
        maxRowsApplied: config.maxRows,
        truncated,
        rowCount: limitedRows.length,
        columns: resolveColumns(limitedRows),
        rows: limitedRows,
      },
    };
  } catch (error) {
    return failure("sqlite_error", error instanceof Error ? error.message : String(error));
  }
}

function printResult(result, pretty) {
  console.log(JSON.stringify(result, null, pretty ? 2 : 0));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let db;
  const config = resolveConfig(args);
  try {
    db = openDatabase(config);
    const result = executeSql(db, config);
    printResult(result, config.pretty);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    db?.close();
  }
}

try {
  main();
} catch (error) {
  printResult(failure("runtime_error", error instanceof Error ? error.message : String(error)), true);
  process.exit(1);
}
