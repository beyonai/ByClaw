import path from "node:path";
import { ACP_CLIENT_TYPES, ACP_MODE, DEFAULTS, ENV, HTTP, PATHS, PLUGIN, SQLITE, TOOL_NAMES } from "./constants.js";
import type { ByclawAcpMode, ResolvedByclawAcpAdapterConfig, RedisConnectionConfig } from "./types.js";
import {
  readRedisConfig,
  type RedisClusterNode,
  type RedisKeySchemaVersion,
  type RedisMode,
} from "../../shared/src/redis-compat.js";

export const byclawAcpAdapterConfigSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    acpMode: {
      type: "string",
      enum: [ACP_MODE.callAgent, ACP_MODE.acp],
      default: ACP_MODE.default,
    },
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
        mode: { type: "string", enum: ["standalone", "cluster"] },
        clusterNodes: { type: "array" },
        keySchemaVersion: { type: "string", enum: ["v1", "v2"] },
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
        callAcpAgent: { type: "string", default: TOOL_NAMES.callAcpAgent },
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

function resolveAcpMode(value: unknown): ByclawAcpMode {
  return value === ACP_MODE.acp ? ACP_MODE.acp : ACP_MODE.callAgent;
}

function readRedisMode(value: unknown, fallback: RedisMode): RedisMode {
  return value === "cluster" || value === "standalone" ? value : fallback;
}

function readRedisKeySchemaVersion(
  value: unknown,
  fallback: RedisKeySchemaVersion,
): RedisKeySchemaVersion {
  return value === "v1" || value === "v2" ? value : fallback;
}

function readClusterNodes(value: unknown, fallback: RedisClusterNode[]): RedisClusterNode[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const out: RedisClusterNode[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const host = readString(item.host, "");
    const port = readInteger(item.port, Number.NaN);
    if (host && Number.isFinite(port)) {
      out.push({ host, port });
    }
  }
  return out.length > 0 ? out : fallback;
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
  const envRedis = readRedisConfig();
  const mode = readRedisMode(redis.mode, envRedis.mode);
  const keySchemaVersion = readRedisKeySchemaVersion(
    redis.keySchemaVersion,
    mode === "cluster" ? "v2" : envRedis.keySchemaVersion,
  );
  return {
    host: readString(redis.host, envRedis.host || process.env[ENV.redisHost] || DEFAULTS.redisHost),
    port: readInteger(redis.port, envRedis.port ?? readInteger(process.env[ENV.redisPort], DEFAULTS.redisPort)),
    username: readString(redis.username, envRedis.username || process.env[ENV.redisUsername] || ""),
    password: readString(redis.password, envRedis.password || process.env[ENV.redisPassword] || ""),
    db: readInteger(redis.database, envRedis.db ?? DEFAULTS.redisDatabase),
    database: readInteger(
      redis.database,
      envRedis.db ?? readInteger(process.env[ENV.redisDatabase], DEFAULTS.redisDatabase),
    ),
    mode,
    clusterNodes: readClusterNodes(redis.clusterNodes, envRedis.clusterNodes),
    keySchemaVersion,
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
    acpMode: resolveAcpMode(config.acpMode),
    defaultAcpAgentId: readString(config.defaultAcpAgentId, DEFAULTS.acpAgentId),
    defaultAcpClientType: readString(config.defaultAcpClientType, ACP_CLIENT_TYPES.claudeCode),
    defaultCwd: resolvePath(config.defaultCwd, defaultCwd),
    sqlitePath: resolvePath(config.sqlitePath, sqliteFallback),
    httpPathPrefix: readString(config.httpPathPrefix, HTTP.pathPrefix),
    redis: resolveRedisConfig(config.redis),
    toolNames: {
      plan: readString(toolNames.plan, TOOL_NAMES.plan),
      run: readString(toolNames.run, TOOL_NAMES.run),
      callAcpAgent: readString(toolNames.callAcpAgent, TOOL_NAMES.callAcpAgent),
    },
  };
}
