import { hostname } from "node:os";
import type { RedisConnectionConfig } from "@byclaw/connector-openclaw-by-framework";
import {
  DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
  type BeyondTokenVerifierOptions,
} from "../auth/beyond-token.js";
import type { ByClawBeAgentCatalogOptions } from "../business/agent-catalog.js";
import { APP_CONFIG_DEFAULTS } from "./config-defaults.js";
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
  serviceDiscovery: {
    enabled: boolean;
    serviceName: string;
    protocol: "http" | "https";
    host: string;
    port: number;
    pathPrefix: string;
    weight: number;
    heartbeatIntervalMs: number;
  };
  thirdPartyAgents: {
    directMode: "off" | "allowlist" | "all";
    allowlist: string[];
    descriptorPath: string;
    serviceCredential?: string;
    requestTimeoutMs: number;
    allowInsecureExternalHttp: boolean;
    allowedExternalHosts: string[];
  };
  /** inspectAttachment 附件读取的边界配置（临时目录与各类上限）。 */
  attachments: {
    tempDir?: string;
    maxFileBytes: number;
    maxTextChars: number;
    maxStructureChars: number;
  };
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
  piProvider?: string;
  piModel?: string;
  openAiBaseUrl?: string;
  arkBaseUrl?: string;
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
  const defaults = APP_CONFIG_DEFAULTS;
  if (
    (env.DB_TYPE ?? defaults.database.type).toLowerCase() !==
    defaults.database.type
  ) {
    throw new Error("DB_TYPE must be postgresql");
  }
  const port = integer(
    env.PORT ?? String(defaults.http.port),
    "PORT",
    1,
    65_535,
  );
  const delegationTimeoutMs = integer(
    env.DELEGATION_TIMEOUT_MS ?? String(defaults.delegationTimeoutMs),
    "DELEGATION_TIMEOUT_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if ((env.PI_PROVIDER && !env.PI_MODEL) || (!env.PI_PROVIDER && env.PI_MODEL)) {
    throw new Error("PI_PROVIDER and PI_MODEL must be configured together");
  }
  const redisMode = redisConnectionMode(requiredEnv(env, "REDIS_MODE"));
  const redis: RedisConnectionConfig = {
    mode: redisMode,
    ...(redisMode === "standalone"
      ? {
          host: requiredEnv(env, "REDIS_HOST"),
          port: integer(requiredEnv(env, "REDIS_PORT"), "REDIS_PORT", 1, 65_535),
        }
      : {
          clusterNodes: redisClusterNodes(
            requiredEnvEither(env, ["REDIS_CLUSTER_HOST", "REDIS_CLUSTER_NODES"]),
          ),
        }),
    db: integer(requiredEnv(env, "REDIS_DATABASE"), "REDIS_DATABASE", 0, 15),
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  };
  const workerId = env.BYCLAW_WORKER_ID
    ? nonEmpty(env.BYCLAW_WORKER_ID, "BYCLAW_WORKER_ID")
    : undefined;
  const corsOrigin = env.CORS_ORIGIN?.trim() || defaults.http.corsOrigin;
  return {
    host: env.HOST ?? defaults.http.host,
    port,
    corsOrigin: corsOrigin === "*" ? true : corsOrigin,
    logLevel: env.LOG_LEVEL ?? defaults.http.logLevel,
    delegationTimeoutMs,
    redis,
    auth: {
      publicKey: env.LOGIN_JWT_PUBLIC_KEY ?? DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY,
    },
    byClawBe: {
      baseUrl: env.BYCLAW_BE_BASE_URL ?? defaults.byClawBe.baseUrl,
      timeoutMs: integer(
        env.BYCLAW_BE_TIMEOUT_MS ?? String(defaults.byClawBe.timeoutMs),
        "BYCLAW_BE_TIMEOUT_MS",
        1,
        300_000,
      ),
    },
    serviceDiscovery: {
      enabled: booleanValue(
        env.BYCLAW_SUPER_DISCOVERY_ENABLED ??
          String(defaults.serviceDiscovery.enabled),
        "BYCLAW_SUPER_DISCOVERY_ENABLED",
      ),
      serviceName: nonEmpty(
        env.BYCLAW_SUPER_SERVICE_NAME ??
          defaults.serviceDiscovery.serviceName,
        "BYCLAW_SUPER_SERVICE_NAME",
      ),
      protocol: discoveryProtocol(
        env.BYCLAW_SUPER_DISCOVERY_PROTOCOL ??
          defaults.serviceDiscovery.protocol,
      ),
      host: nonEmpty(
        env.BYCLAW_SUPER_DISCOVERY_HOST ??
          defaults.serviceDiscovery.host,
        "BYCLAW_SUPER_DISCOVERY_HOST",
      ),
      port: integer(
        env.BYCLAW_SUPER_DISCOVERY_PORT ?? String(port),
        "BYCLAW_SUPER_DISCOVERY_PORT",
        1,
        65_535,
      ),
      pathPrefix: pathPrefix(
        env.BYCLAW_SUPER_DISCOVERY_PATH_PREFIX ??
          defaults.serviceDiscovery.pathPrefix,
        "BYCLAW_SUPER_DISCOVERY_PATH_PREFIX",
      ),
      weight: integer(
        env.BYCLAW_SUPER_DISCOVERY_WEIGHT ??
          String(defaults.serviceDiscovery.weight),
        "BYCLAW_SUPER_DISCOVERY_WEIGHT",
        1,
        10_000,
      ),
      heartbeatIntervalMs: integer(
        env.BYCLAW_SUPER_DISCOVERY_HEARTBEAT_MS ??
          String(defaults.serviceDiscovery.heartbeatIntervalMs),
        "BYCLAW_SUPER_DISCOVERY_HEARTBEAT_MS",
        1_000,
        30_000,
      ),
    },
    thirdPartyAgents: {
      directMode: thirdPartyDirectMode(
        env.THIRD_PARTY_AGENT_DIRECT_MODE ??
          defaults.thirdPartyAgents.directMode,
      ),
      allowlist: commaSeparated(
        env.THIRD_PARTY_AGENT_ALLOWLIST ??
          defaults.thirdPartyAgents.allowlist,
      ),
      descriptorPath: nonEmpty(
        env.THIRD_PARTY_AGENT_DESCRIPTOR_PATH ??
          defaults.thirdPartyAgents.descriptorPath,
        "THIRD_PARTY_AGENT_DESCRIPTOR_PATH",
      ),
      ...(env.THIRD_PARTY_AGENT_SERVICE_CREDENTIAL?.trim()
        ? {
            serviceCredential:
              env.THIRD_PARTY_AGENT_SERVICE_CREDENTIAL.trim(),
          }
        : {}),
      requestTimeoutMs: integer(
        env.THIRD_PARTY_AGENT_REQUEST_TIMEOUT_MS ??
          String(defaults.thirdPartyAgents.requestTimeoutMs),
        "THIRD_PARTY_AGENT_REQUEST_TIMEOUT_MS",
        1,
        3_600_000,
      ),
      allowInsecureExternalHttp: booleanValue(
        env.THIRD_PARTY_AGENT_ALLOW_INSECURE_HTTP ??
          String(defaults.thirdPartyAgents.allowInsecureExternalHttp),
        "THIRD_PARTY_AGENT_ALLOW_INSECURE_HTTP",
      ),
      allowedExternalHosts: commaSeparated(
        env.THIRD_PARTY_AGENT_ALLOWED_HOSTS ??
          defaults.thirdPartyAgents.allowedExternalHosts,
      ).map((host) => host.toLowerCase()),
    },
    attachments: {
      ...(env.ATTACHMENT_TEMP_DIR?.trim()
        ? { tempDir: env.ATTACHMENT_TEMP_DIR.trim() }
        : {}),
      maxFileBytes: integer(
        env.ATTACHMENT_MAX_FILE_BYTES ?? String(defaults.attachments.maxFileBytes),
        "ATTACHMENT_MAX_FILE_BYTES",
        1_024,
        1_073_741_824,
      ),
      maxTextChars: integer(
        env.ATTACHMENT_MAX_TEXT_CHARS ?? String(defaults.attachments.maxTextChars),
        "ATTACHMENT_MAX_TEXT_CHARS",
        100,
        1_000_000,
      ),
      maxStructureChars: integer(
        env.ATTACHMENT_MAX_STRUCTURE_CHARS ??
          String(defaults.attachments.maxStructureChars),
        "ATTACHMENT_MAX_STRUCTURE_CHARS",
        100,
        1_000_000,
      ),
    },
    worker: {
      enabled: booleanValue(
        env.BYCLAW_WORKER_ENABLED ?? String(defaults.worker.enabled),
        "BYCLAW_WORKER_ENABLED",
      ),
      agentType: nonEmpty(
        env.BYCLAW_WORKER_AGENT_TYPE ?? defaults.worker.agentType,
        "BYCLAW_WORKER_AGENT_TYPE",
      ),
      ...(workerId ? { workerId } : {}),
      maxConcurrency: integer(
        env.BYCLAW_WORKER_MAX_CONCURRENCY ??
          String(defaults.worker.maxConcurrency),
        "BYCLAW_WORKER_MAX_CONCURRENCY",
        1,
        1_000,
      ),
    },
    database: {
      host: requiredEnv(env, "DB_HOST"),
      port: integer(
        requiredEnv(env, "DB_PORT"),
        "DB_PORT",
        1,
        65_535,
      ),
      database: requiredEnv(env, "DB_DATABASE"),
      schema: requiredEnv(env, "DB_SCHEMA"),
      user: requiredEnv(env, "DB_USER"),
      password: requiredEnv(env, "DB_PASS"),
      maxConnections: integer(
        env.DB_POOL_MAX ?? String(defaults.database.maxConnections),
        "DB_POOL_MAX",
        1,
        1_000,
      ),
      connectionTimeoutMs: integer(
        env.DB_CONNECTION_TIMEOUT_MS ??
          String(defaults.database.connectionTimeoutMs),
        "DB_CONNECTION_TIMEOUT_MS",
        1,
        300_000,
      ),
      idleTimeoutMs: integer(
        env.DB_IDLE_TIMEOUT_MS ?? String(defaults.database.idleTimeoutMs),
        "DB_IDLE_TIMEOUT_MS",
        1_000,
        3_600_000,
      ),
      statementTimeoutMs: integer(
        env.DB_STATEMENT_TIMEOUT_MS ??
          String(defaults.database.statementTimeoutMs),
        "DB_STATEMENT_TIMEOUT_MS",
        1,
        3_600_000,
      ),
      ssl: booleanValue(
        requiredEnv(env, "DB_SSL"),
        "DB_SSL",
      ),
      eventListenEnabled: booleanValue(
        env.DB_EVENT_LISTEN_ENABLED ??
          String(defaults.database.eventListenEnabled),
        "DB_EVENT_LISTEN_ENABLED",
      ),
      piEntryMaxBytes: integer(
        env.PI_ENTRY_MAX_BYTES ??
          String(defaults.piSession.entryMaxBytes),
        "PI_ENTRY_MAX_BYTES",
        1_024,
        16_777_216,
      ),
      piSessionMaxBytes: integer(
        env.PI_SESSION_MAX_BYTES ??
          String(defaults.piSession.sessionMaxBytes),
        "PI_SESSION_MAX_BYTES",
        1_024,
        1_073_741_824,
      ),
      piSessionMaxEntries: integer(
        env.PI_SESSION_MAX_ENTRIES ??
          String(defaults.piSession.sessionMaxEntries),
        "PI_SESSION_MAX_ENTRIES",
        1,
        1_000_000,
      ),
      migrateOnStart: booleanValue(
        env.DB_MIGRATE_ON_START ??
          String(defaults.database.migrateOnStart),
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
      env.RUN_LEASE_MS ?? String(defaults.run.leaseMs),
      "RUN_LEASE_MS",
      5_000,
      3_600_000,
    ),
    runQueuePollMs: integer(
      env.RUN_QUEUE_POLL_MS ?? String(defaults.run.queuePollMs),
      "RUN_QUEUE_POLL_MS",
      50,
      60_000,
    ),
    runCredentialMaxTtlMs: integer(
      env.RUN_CREDENTIAL_MAX_TTL_MS ??
        String(defaults.run.credentialMaxTtlMs),
      "RUN_CREDENTIAL_MAX_TTL_MS",
      1_000,
      86_400_000,
    ),
    runCredentialCleanupIntervalMs: integer(
      env.RUN_CREDENTIAL_CLEANUP_INTERVAL_MS ??
        String(defaults.run.credentialCleanupIntervalMs),
      "RUN_CREDENTIAL_CLEANUP_INTERVAL_MS",
      1_000,
      3_600_000,
    ),
    ...(env.PI_SESSION_CACHE_DIR
      ? { piSessionCacheDirectory: nonEmpty(env.PI_SESSION_CACHE_DIR, "PI_SESSION_CACHE_DIR") }
      : {}),
    piSessionCacheMaxEntries: integer(
      env.PI_SESSION_CACHE_MAX_ENTRIES ??
        String(defaults.piSession.cacheMaxEntries),
      "PI_SESSION_CACHE_MAX_ENTRIES",
      1,
      10_000,
    ),
    piSessionCacheIdleTtlMs: integer(
      env.PI_SESSION_CACHE_IDLE_TTL_MS ??
        String(defaults.piSession.cacheIdleTtlMs),
      "PI_SESSION_CACHE_IDLE_TTL_MS",
      1_000,
      86_400_000,
    ),
    piProvider: nonEmpty(
      env.PI_PROVIDER ?? defaults.pi.provider,
      "PI_PROVIDER",
    ),
    piModel: nonEmpty(env.PI_MODEL ?? defaults.pi.model, "PI_MODEL"),
    openAiBaseUrl: nonEmpty(
      env.OPENAI_BASE_URL ?? defaults.pi.openAiBaseUrl,
      "OPENAI_BASE_URL",
    ),
    arkBaseUrl: nonEmpty(
      env.ARK_BASE_URL ?? defaults.pi.arkBaseUrl,
      "ARK_BASE_URL",
    ),
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

/** 服务注册仅支持 HTTP(S) 协议。 */
function discoveryProtocol(raw: string): "http" | "https" {
  const value = raw.trim().toLowerCase();
  if (value === "http" || value === "https") {
    return value;
  }
  throw new Error(
    `BYCLAW_SUPER_DISCOVERY_PROTOCOL must be http or https, received: ${raw}`,
  );
}

/** 校验并标准化服务发现路径前缀。 */
function pathPrefix(raw: string, name: string): string {
  const value = raw.trim();
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must be an absolute path without query or hash`);
  }
  return value === "/" ? "/" : `/${value.replace(/^\/+|\/+$/g, "")}`;
}

/** 校验必须存在的文本环境变量，并返回去除首尾空白后的值。 */
function nonEmpty(raw: string, name: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  return nonEmpty(env[name] ?? "", name);
}

function requiredEnvEither(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`${names.join(" or ")} must be configured`);
}

function redisConnectionMode(raw: string): "standalone" | "cluster" {
  const value = raw.trim().toLowerCase();
  if (value === "standalone" || value === "cluster") {
    return value;
  }
  throw new Error(
    `REDIS_MODE must be standalone or cluster, received: ${raw}`,
  );
}

function redisClusterNodes(
  raw: string,
): Array<{ host: string; port: number }> {
  return raw.split(",").map((entry) => {
    const value = entry.trim();
    const separator = value.lastIndexOf(":");
    if (separator <= 0) {
      throw new Error(
        `Redis cluster node must use host:port format, received: ${value}`,
      );
    }
    const host = nonEmpty(value.slice(0, separator), "Redis cluster node host");
    const port = integer(
      value.slice(separator + 1),
      "Redis cluster node port",
      1,
      65_535,
    );
    return { host, port };
  });
}

/** 解析带上下界的整数环境变量，并在启动阶段给出明确错误。 */
function integer(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
  }
  return value;
}

function thirdPartyDirectMode(
  raw: string,
): "off" | "allowlist" | "all" {
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "allowlist" || value === "all") {
    return value;
  }
  throw new Error(
    `THIRD_PARTY_AGENT_DIRECT_MODE must be off, allowlist or all, received: ${raw}`,
  );
}

function commaSeparated(raw: string): string[] {
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}
