export type SqlExecuteMode = "auto" | "all" | "get" | "run";

export type SqlExecuteParams = Record<string, unknown> | unknown[];

export type SqlExecuteRequest = {
  sql: string;
  params?: SqlExecuteParams;
  mode?: SqlExecuteMode;
  maxRows?: number;
};

export type SqlExecuteSuccess = {
  ok: true;
  data: {
    dbPath: string;
    mode: Exclude<SqlExecuteMode, "auto">;
    statementType: string;
    durationMs: number;
    maxRowsApplied: number;
    truncated: boolean;
    rowCount?: number;
    columns?: string[];
    rows?: Array<Record<string, unknown>>;
    row?: Record<string, unknown> | null;
    changes?: number;
    lastInsertRowid?: string | number | null;
  };
};

export type SqlExecuteFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type SqlExecuteResponse = SqlExecuteSuccess | SqlExecuteFailure;

export type ByclawSqlitePluginConfig = {
  dbPath?: string;
  toolName?: string;
  httpPath?: string;
  busyTimeoutMs?: number;
  maxRows?: number;
  allowWrite?: boolean;
};

export type ResolvedByclawSqliteConfig = {
  dbPath: string;
  toolName: string;
  httpPath: string;
  busyTimeoutMs: number;
  maxRows: number;
  allowWrite: boolean;
};
