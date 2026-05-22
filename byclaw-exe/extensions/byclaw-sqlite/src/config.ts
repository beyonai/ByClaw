import type { ByclawSqlitePluginConfig, ResolvedByclawSqliteConfig } from "./types.js";
import { resolveDefaultDbPath, resolvePluginPath } from "./paths.js";

export const byclawSqliteConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dbPath: {
      type: "string",
      description:
        "SQLite database file path. Relative paths resolve from the plugin directory. Defaults to OPENCLAW_STATE_DIR/memory/byclaw.sqlite.",
    },
    toolName: {
      type: "string",
      description: "Registered OpenClaw tool name.",
      default: "sqlExecute",
    },
    httpPath: {
      type: "string",
      description: "Gateway HTTP route path used for direct external invocation.",
      default: "/plugins/byclaw-sqlite/sqlExecute",
    },
    busyTimeoutMs: {
      type: "number",
      description: "SQLite busy timeout in milliseconds.",
      default: 5000,
    },
    maxRows: {
      type: "number",
      description: "Maximum number of result rows returned by read queries.",
      default: 200,
    },
    allowWrite: {
      type: "boolean",
      description: "Whether write statements are allowed.",
      default: true,
    },
  },
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
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

function resolveDbPath(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return resolvePluginPath(value.trim());
  }
  return resolveDefaultDbPath();
}

export function resolveByclawSqliteConfig(raw: unknown): ResolvedByclawSqliteConfig {
  const config = isPlainRecord(raw) ? (raw as ByclawSqlitePluginConfig) : {};
  return {
    dbPath: resolveDbPath(config.dbPath),
    toolName: readString(config.toolName, "sqlExecute"),
    httpPath: readString(config.httpPath, "/plugins/byclaw-sqlite/sqlExecute"),
    busyTimeoutMs: readPositiveInteger(config.busyTimeoutMs, 5000),
    maxRows: readPositiveInteger(config.maxRows, 200),
    allowWrite: config.allowWrite !== false,
  };
}
