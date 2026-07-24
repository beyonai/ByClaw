import { hostname } from "node:os";
import type { RedisConnectionConfig } from "@byclaw/connector-openclaw-by-framework";
import {
  DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
  type BeyondTokenVerifierOptions,
} from "./auth/beyond-token.js";
import type { ByClawBeAgentCatalogOptions } from "./byclaw-be-agent-catalog.js";
import type { PostgresDatabaseConfig } from "@byclaw/storage-postgres";

export interface AppConfig {
  host: string;
  port: number;
  corsOrigin: string | boolean;
  logLevel: string;
  delegationTimeoutMs: number;
  redis: RedisConnectionConfig;
  auth: BeyondTokenVerifierOptions;
  byClawBe: Omit<ByClawBeAgentCatalogOptions, "fetchImpl">;
  worker: ByFrameworkWorkerConfig;
  database: PostgresDatabaseConfig & { migrateOnStart: boolean };
  instanceId: string;
  runLeaseMs: number;
  runQueuePollMs: number;
  runCredentialMaxTtlMs: number;
  runCredentialCleanupIntervalMs: number;
  piSessionCacheDirectory?: string;
  piSessionCacheMaxEntries: number;
  piSessionCacheIdleTtlMs: number;
  kms: {
    adapterModule: string;
    keyId: string;
  };
  piProvider?: string;
  piModel?: string;
  openAiBaseUrl?: string;
}

/** by-framework 入站 Worker 的业务层配置。 */
export interface ByFrameworkWorkerConfig {
  enabled: boolean;
  agentType: string;
  workerId?: string;
  maxConcurrency: number;
}

/** 从环境变量加载并校验应用配置，避免无效端口或半配置模型进入运行期。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if ((env.DB_TYPE ?? "postgresql").toLowerCase() !== "postgresql") {
    throw new Error("DB_TYPE must be postgresql");
  }
  const port = integer(env.PORT ?? "3000", "PORT", 1, 65_535);
  const delegationTimeoutMs = integer(
    env.DELEGATION_TIMEOUT_MS ?? "1800000",
    "DELEGATION_TIMEOUT_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if ((env.PI_PROVIDER && !env.PI_MODEL) || (!env.PI_PROVIDER && env.PI_MODEL)) {
    throw new Error("PI_PROVIDER and PI_MODEL must be configured together");
  }
  const redis: RedisConnectionConfig = {
    host: env.REDIS_HOST ?? "127.0.0.1",
    port: integer(env.REDIS_PORT ?? "6379", "REDIS_PORT", 1, 65_535),
    db: integer(env.REDIS_DATABASE ?? env.REDIS_DB ?? "0", "REDIS_DATABASE", 0, 15),
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  };
  const workerId = env.BYCLAW_WORKER_ID
    ? nonEmpty(env.BYCLAW_WORKER_ID, "BYCLAW_WORKER_ID")
    : undefined;
  return {
    host: env.HOST ?? "0.0.0.0",
    port,
    corsOrigin: !env.CORS_ORIGIN || env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    logLevel: env.LOG_LEVEL ?? "info",
    delegationTimeoutMs,
    redis,
    auth: {
      publicKey: env.LOGIN_JWT_PUBLIC_KEY ?? DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
    },
    byClawBe: {
      baseUrl: env.BYCLAW_BE_BASE_URL ?? "http://127.0.0.1:8086",
      timeoutMs: integer(env.BYCLAW_BE_TIMEOUT_MS ?? "10000", "BYCLAW_BE_TIMEOUT_MS", 1, 300_000),
    },
    worker: {
      enabled: booleanValue(env.BYCLAW_WORKER_ENABLED ?? "true", "BYCLAW_WORKER_ENABLED"),
      agentType: nonEmpty(env.BYCLAW_WORKER_AGENT_TYPE ?? "BY_SUPER", "BYCLAW_WORKER_AGENT_TYPE"),
      ...(workerId ? { workerId } : {}),
      maxConcurrency: integer(
        env.BYCLAW_WORKER_MAX_CONCURRENCY ?? "10",
        "BYCLAW_WORKER_MAX_CONCURRENCY",
        1,
        1_000,
      ),
    },
    database: {
      host: nonEmpty(env.DB_HOST ?? "127.0.0.1", "DB_HOST"),
      port: integer(env.DB_PORT ?? "5432", "DB_PORT", 1, 65_535),
      database: nonEmpty(env.DB_DATABASE ?? "postgres", "DB_DATABASE"),
      schema: nonEmpty(env.DB_SCHEMA ?? "byai", "DB_SCHEMA"),
      user: nonEmpty(env.DB_USER ?? "", "DB_USER"),
      password: nonEmpty(env.DB_PASS ?? "", "DB_PASS"),
      maxConnections: integer(
        env.DB_POOL_MAX ?? "20",
        "DB_POOL_MAX",
        1,
        1_000,
      ),
      connectionTimeoutMs: integer(
        env.DB_CONNECTION_TIMEOUT_MS ?? "5000",
        "DB_CONNECTION_TIMEOUT_MS",
        1,
        300_000,
      ),
      idleTimeoutMs: integer(
        env.DB_IDLE_TIMEOUT_MS ?? "30000",
        "DB_IDLE_TIMEOUT_MS",
        1_000,
        3_600_000,
      ),
      statementTimeoutMs: integer(
        env.DB_STATEMENT_TIMEOUT_MS ?? "30000",
        "DB_STATEMENT_TIMEOUT_MS",
        1,
        3_600_000,
      ),
      ssl: booleanValue(env.DB_SSL ?? "false", "DB_SSL"),
      eventListenEnabled: booleanValue(
        env.DB_EVENT_LISTEN_ENABLED ?? "true",
        "DB_EVENT_LISTEN_ENABLED",
      ),
      piEntryMaxBytes: integer(
        env.PI_ENTRY_MAX_BYTES ?? "1048576",
        "PI_ENTRY_MAX_BYTES",
        1_024,
        16_777_216,
      ),
      piSessionMaxBytes: integer(
        env.PI_SESSION_MAX_BYTES ?? "16777216",
        "PI_SESSION_MAX_BYTES",
        1_024,
        1_073_741_824,
      ),
      piSessionMaxEntries: integer(
        env.PI_SESSION_MAX_ENTRIES ?? "20000",
        "PI_SESSION_MAX_ENTRIES",
        1,
        1_000_000,
      ),
      migrateOnStart: booleanValue(
        env.DB_MIGRATE_ON_START ?? "false",
        "DB_MIGRATE_ON_START",
      ),
    },
    instanceId: nonEmpty(
      env.BYCLAW_INSTANCE_ID ??
        workerId ??
        `byclaw-super-${hostname()}-${process.pid}`,
      "BYCLAW_INSTANCE_ID",
    ),
    runLeaseMs: integer(
      env.RUN_LEASE_MS ?? "30000",
      "RUN_LEASE_MS",
      5_000,
      3_600_000,
    ),
    runQueuePollMs: integer(
      env.RUN_QUEUE_POLL_MS ?? "500",
      "RUN_QUEUE_POLL_MS",
      50,
      60_000,
    ),
    runCredentialMaxTtlMs: integer(
      env.RUN_CREDENTIAL_MAX_TTL_MS ?? "7200000",
      "RUN_CREDENTIAL_MAX_TTL_MS",
      1_000,
      86_400_000,
    ),
    runCredentialCleanupIntervalMs: integer(
      env.RUN_CREDENTIAL_CLEANUP_INTERVAL_MS ?? "60000",
      "RUN_CREDENTIAL_CLEANUP_INTERVAL_MS",
      1_000,
      3_600_000,
    ),
    ...(env.PI_SESSION_CACHE_DIR
      ? { piSessionCacheDirectory: nonEmpty(env.PI_SESSION_CACHE_DIR, "PI_SESSION_CACHE_DIR") }
      : {}),
    piSessionCacheMaxEntries: integer(
      env.PI_SESSION_CACHE_MAX_ENTRIES ?? "100",
      "PI_SESSION_CACHE_MAX_ENTRIES",
      1,
      10_000,
    ),
    piSessionCacheIdleTtlMs: integer(
      env.PI_SESSION_CACHE_IDLE_TTL_MS ?? "1800000",
      "PI_SESSION_CACHE_IDLE_TTL_MS",
      1_000,
      86_400_000,
    ),
    kms: {
      adapterModule: nonEmpty(env.KMS_ADAPTER_MODULE ?? "", "KMS_ADAPTER_MODULE"),
      keyId: nonEmpty(env.KMS_KEY_ID ?? "", "KMS_KEY_ID"),
    },
    ...(env.PI_PROVIDER ? { piProvider: env.PI_PROVIDER } : {}),
    ...(env.PI_MODEL ? { piModel: env.PI_MODEL } : {}),
    ...(env.OPENAI_BASE_URL ? { openAiBaseUrl: env.OPENAI_BASE_URL } : {}),
  };
}

/** 解析显式布尔环境变量，避免任意非空字符串被误判为开启。 */
function booleanValue(raw: string, name: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1 or 0, received: ${raw}`);
}

/** 校验必须存在的文本环境变量，并返回去除首尾空白后的值。 */
function nonEmpty(raw: string, name: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

/** 解析带上下界的整数环境变量，并在启动阶段给出明确错误。 */
function integer(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
  }
  return value;
}
