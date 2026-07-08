import path from "node:path";
import { ACP_CLIENT_TYPES, DEFAULTS, ENV, HTTP, PATHS, PLUGIN, SQLITE, TOOL_NAMES } from "./constants.js";
import type { ResolvedByclawAcpAdapterConfig, RedisConnectionConfig } from "./types.js";

export const byclawAcpAdapterConfigSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    defaultAcpAgentId: { type: "string", default: DEFAULTS.acpAgentId },
    defaultAcpClientType: { type: "string", default: ACP_CLIENT_TYPES.claudeCode },
    defaultCwd: { type: "string" },
    sqlitePath: { type: "string" },
    httpPathPrefix: { type: "string", default: HTTP.pathPrefix },
    redis: {
      type: "object",
      additionalProperties: true,
      properties: {
        host: { type: "string" },
        port: { type: "number" },
        username: { type: "string" },
        password: { type: "string" },
        database: { type: "number" },
        keyPrefix: { type: "string" },
        connectTimeoutMs: { type: "number" },
      },
    },
    toolNames: {
      type: "object",
      additionalProperties: true,
      properties: {
        plan: { type: "string", default: TOOL_NAMES.plan },
        run: { type: "string", default: TOOL_NAMES.run },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function defaultStateDir(): string {
  return process.env[ENV.openclawStateDir] || path.join(process.cwd(), PATHS.openclawStateDir);
}

function resolvePath(value: unknown, fallback: string): string {
  const raw = readString(value, fallback);
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function resolveRedisConfig(value: unknown): RedisConnectionConfig {
  const redis = isRecord(value) ? value : {};
  return {
    host: readString(redis.host, process.env[ENV.redisHost] || DEFAULTS.redisHost),
    port: readInteger(redis.port, readInteger(process.env[ENV.redisPort], DEFAULTS.redisPort)),
    username: readString(redis.username, process.env[ENV.redisUsername] || ""),
    password: readString(redis.password, process.env[ENV.redisPassword] || ""),
    database: readInteger(
      redis.database,
      readInteger(process.env[ENV.redisDatabase], DEFAULTS.redisDatabase),
    ),
    keyPrefix: readString(redis.keyPrefix, ""),
    connectTimeoutMs: Math.max(
      DEFAULTS.minRedisConnectTimeoutMs,
      readInteger(
        redis.connectTimeoutMs,
        readInteger(process.env[ENV.redisConnectTimeoutMs], DEFAULTS.redisConnectTimeoutMs),
      ),
    ),
  };
}

export function resolveByclawAcpAdapterConfig(raw: unknown): ResolvedByclawAcpAdapterConfig {
  const config = isRecord(raw) ? raw : {};
  const toolNames = isRecord(config.toolNames) ? config.toolNames : {};
  const sqliteFallback = path.join(
    defaultStateDir(),
    PLUGIN.id,
    SQLITE.fileName,
  );
  const defaultCwd = process.env[ENV.byclawAcpDefaultCwd] || process.cwd();
  return {
    defaultAcpAgentId: readString(config.defaultAcpAgentId, DEFAULTS.acpAgentId),
    defaultAcpClientType: readString(config.defaultAcpClientType, ACP_CLIENT_TYPES.claudeCode),
    defaultCwd: resolvePath(config.defaultCwd, defaultCwd),
    sqlitePath: resolvePath(config.sqlitePath, sqliteFallback),
    httpPathPrefix: readString(config.httpPathPrefix, HTTP.pathPrefix),
    redis: resolveRedisConfig(config.redis),
    toolNames: {
      plan: readString(toolNames.plan, TOOL_NAMES.plan),
      run: readString(toolNames.run, TOOL_NAMES.run),
    },
  };
}
