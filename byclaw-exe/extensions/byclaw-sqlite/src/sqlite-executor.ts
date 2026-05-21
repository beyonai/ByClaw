import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type {
  ResolvedByclawSqliteConfig,
  SqlExecuteMode,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlExecuteSuccess,
} from "./types.js";
import { requireNodeSqlite } from "./sqlite-runtime.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function openDatabase(config: ResolvedByclawSqliteConfig): DatabaseSync {
  ensureParentDir(config.dbPath);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA busy_timeout = ${config.busyTimeoutMs}`);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function toJsonSafe(value: unknown): unknown {
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
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonSafe(entry)]),
    );
  }
  return value;
}

function stringifyForLog(value: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "bigint") {
      return entry.toString();
    }
    if (entry instanceof Uint8Array) {
      return {
        type: "bytes",
        encoding: "base64",
        data: Buffer.from(entry).toString("base64"),
        byteLength: entry.byteLength,
      };
    }
    if (typeof entry === "function") {
      return "[Function]";
    }
    if (typeof entry === "symbol") {
      return entry.toString();
    }
    if (entry && typeof entry === "object") {
      if (seen.has(entry)) {
        return "[Circular]";
      }
      seen.add(entry);
    }
    return entry;
  });
  return json ?? String(value);
}

function describeRequest(input: Record<string, unknown>): string {
  return stringifyForLog({
    sql: typeof input.sql === "string" ? input.sql.trim() : input.sql,
    params: input.params,
    mode: input.mode,
    maxRows: input.maxRows,
  });
}

function normalizeRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row) => (isPlainRecord(row) ? (toJsonSafe(row) as Record<string, unknown>) : {}));
}

function readMode(value: unknown): SqlExecuteMode {
  if (value === "all" || value === "get" || value === "run" || value === "auto") {
    return value;
  }
  return "auto";
}

function readMaxRows(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function detectStatementType(sql: string): string {
  const normalized = sql.trim().replace(/^\s*--.*$/gm, "").trim();
  const first = normalized.match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  if (!first) {
    return "UNKNOWN";
  }
  if (first !== "WITH") {
    return first;
  }
  if (/\bINSERT\b/i.test(normalized)) {
    return "INSERT";
  }
  if (/\bUPDATE\b/i.test(normalized)) {
    return "UPDATE";
  }
  if (/\bDELETE\b/i.test(normalized)) {
    return "DELETE";
  }
  if (/\bREPLACE\b/i.test(normalized)) {
    return "REPLACE";
  }
  if (/\bSELECT\b/i.test(normalized)) {
    return "SELECT";
  }
  return "WITH";
}

function isReadStatementType(statementType: string): boolean {
  return ["EXPLAIN", "PRAGMA", "SELECT", "WITH"].includes(statementType);
}

function resolveEffectiveMode(statementType: string, mode: SqlExecuteMode): Exclude<SqlExecuteMode, "auto"> {
  if (mode !== "auto") {
    return mode;
  }
  return isReadStatementType(statementType) ? "all" : "run";
}

function resolveStatementArgs(params: unknown): unknown[] {
  if (Array.isArray(params)) {
    return params;
  }
  if (isPlainRecord(params)) {
    return [params];
  }
  return [];
}

function runStatement<T>(statement: StatementSync, method: "all" | "get" | "run", params: unknown): T {
  const handler = statement[method] as (...args: unknown[]) => T;
  return handler.call(statement, ...resolveStatementArgs(params));
}

function resolveColumns(rows: Array<Record<string, unknown>>): string[] | undefined {
  const first = rows[0];
  return first ? Object.keys(first) : undefined;
}

function createFailure(code: string, message: string): SqlExecuteResponse {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function displayDbPath(filePath: string): string {
  return path.basename(filePath);
}

export class SqliteExecutor {
  private db: DatabaseSync | undefined;

  constructor(
    private readonly params: {
      config: ResolvedByclawSqliteConfig;
      logger: PluginLogger;
    },
  ) {}

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private ensureDb(): DatabaseSync {
    this.db ??= openDatabase(this.params.config);
    return this.db;
  }

  execute(input: unknown): SqlExecuteResponse {
    if (!isPlainRecord(input)) {
      return createFailure("invalid_request", "Request body must be an object.");
    }

    const requestLog = describeRequest(input);
    this.params.logger.info(`byclaw-sqlite: request received ${requestLog}`);

    const sql = typeof input.sql === "string" ? input.sql.trim() : "";
    if (!sql) {
      return createFailure("invalid_request", "sql is required.");
    }

    const mode = readMode(input.mode);
    const statementType = detectStatementType(sql);
    const effectiveMode = resolveEffectiveMode(statementType, mode);
    const maxRowsApplied = Math.min(
      readMaxRows(input.maxRows, this.params.config.maxRows),
      this.params.config.maxRows,
    );

    if (!this.params.config.allowWrite && !isReadStatementType(statementType)) {
      return createFailure("write_disabled", `Write statements are disabled: ${statementType}.`);
    }

    const startedAt = Date.now();

    try {
      const statement = this.ensureDb().prepare(sql);

      if (effectiveMode === "run") {
        const result = runStatement<{ changes?: number; lastInsertRowid?: number | bigint }>(
          statement,
          "run",
          input.params,
        );
        return {
          ok: true,
          data: {
            dbPath: displayDbPath(this.params.config.dbPath),
            mode: effectiveMode,
            statementType,
            durationMs: Date.now() - startedAt,
            maxRowsApplied,
            truncated: false,
            changes: typeof result?.changes === "number" ? result.changes : 0,
            lastInsertRowid:
              result?.lastInsertRowid == null
                ? null
                : (toJsonSafe(result.lastInsertRowid) as string | number | null),
          },
        };
      }

      if (effectiveMode === "get") {
        const rawRow = runStatement<Record<string, unknown> | undefined>(statement, "get", input.params);
        const row = rawRow && isPlainRecord(rawRow) ? (toJsonSafe(rawRow) as Record<string, unknown>) : null;
        return {
          ok: true,
          data: {
            dbPath: displayDbPath(this.params.config.dbPath),
            mode: effectiveMode,
            statementType,
            durationMs: Date.now() - startedAt,
            maxRowsApplied,
            truncated: false,
            rowCount: row ? 1 : 0,
            columns: row ? Object.keys(row) : undefined,
            row,
          },
        };
      }

      const rawRows = runStatement<unknown[]>(statement, "all", input.params);
      const rows = normalizeRows(rawRows);
      const truncated = rows.length > maxRowsApplied;
      const limitedRows = truncated ? rows.slice(0, maxRowsApplied) : rows;

      return {
        ok: true,
        data: {
          dbPath: displayDbPath(this.params.config.dbPath),
          mode: effectiveMode,
          statementType,
          durationMs: Date.now() - startedAt,
          maxRowsApplied,
          truncated,
          rowCount: limitedRows.length,
          columns: resolveColumns(limitedRows),
          rows: limitedRows,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.params.logger.warn(`byclaw-sqlite: execution failed for ${statementType}: ${message}`);
      this.params.logger.error(`byclaw-sqlite: request failed ${requestLog}: ${message}`);
      return createFailure("sqlite_error", message);
    }
  }
}
