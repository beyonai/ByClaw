import { hostname } from "node:os";
import type { RedisConnectionConfig } from "@byclaw/connector-openclaw-by-framework";
import { APP_CONFIG_DEFAULTS } from "./config-defaults.js";
import {
  booleanValue,
  commaSeparated,
  discoveryProtocol,
  integer,
  nonEmpty,
  pathPrefix,
  redisClusterNodes,
  redisConnectionMode,
  requiredEnv,
  requiredEnvEither,
} from "./env-parsers.js";
import type { PostgresDatabaseConfig } from "@byclaw/storage-postgres";

/** Beyond-Token 验签配置（publicKey 为 base64 DER 或 PEM）。 */
export interface AuthConfig {
  publicKey: string;
}

/** 与 ByClaw BE 对接的根地址与超时；服务发现等运行期参数在装配时另行注入。 */
export interface ByClawBeClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface AppConfig {
  host: string;
  port: number;
  corsOrigin: string | boolean;
  logLevel: string;
  delegationTimeouts: {
    firstActivityMs: number;
    idleMs: number;
    callbackMs: number;
  };
  openClaw: {
    cancelConfirmationTimeoutMs: number;
  };
  redis: RedisConnectionConfig;
  auth: AuthConfig;
  byClawBe: ByClawBeClientConfig;
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
  runUserInteractionTimeoutMs: number;
  runCredentialMaxTtlMs: number;
  runCredentialCleanupIntervalMs: number;
  piSessionCacheDirectory?: string;
  piSessionCacheMaxEntries: number;
  piSessionCacheIdleTtlMs: number;
  piProvider?: string;
  piModel?: string;
  arkBaseUrl?: string;
  arkApiKey?: string;
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
  const databaseType = (
    env.DB_TYPE ?? defaults.database.type
  ).toLowerCase();
  if (!["postgresql", "opengauss"].includes(databaseType)) {
    throw new Error("DB_TYPE must be postgresql or opengauss");
  }
  const port = integer(
    env.PORT ?? String(defaults.http.port),
    "PORT",
    1,
    65_535,
  );
  const delegationFirstActivityMs = integer(
    env.DELEGATION_FIRST_ACTIVITY_TIMEOUT_MS ??
      env.OPENCLAW_FIRST_EVENT_TIMEOUT_MS ??
      String(defaults.delegationTimeouts.firstActivityMs),
    "DELEGATION_FIRST_ACTIVITY_TIMEOUT_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const delegationIdleMs = integer(
    env.DELEGATION_IDLE_TIMEOUT_MS ??
      env.DELEGATION_TIMEOUT_MS ??
      String(defaults.delegationTimeouts.idleMs),
    "DELEGATION_IDLE_TIMEOUT_MS",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const delegationCallbackMs = integer(
    env.DELEGATION_CALLBACK_TIMEOUT_MS ??
      String(defaults.delegationTimeouts.callbackMs),
    "DELEGATION_CALLBACK_TIMEOUT_MS",
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
    delegationTimeouts: {
      firstActivityMs: delegationFirstActivityMs,
      idleMs: delegationIdleMs,
      callbackMs: delegationCallbackMs,
    },
    openClaw: {
      cancelConfirmationTimeoutMs: integer(
        env.OPENCLAW_CANCEL_CONFIRM_TIMEOUT_MS ??
          String(defaults.openClaw.cancelConfirmationTimeoutMs),
        "OPENCLAW_CANCEL_CONFIRM_TIMEOUT_MS",
        1,
        300_000,
      ),
    },
    redis,
    auth: {
      publicKey: env.LOGIN_JWT_PUBLIC_KEY ?? defaults.auth.loginJwtPublicKey,
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
    runUserInteractionTimeoutMs: integer(
      env.RUN_USER_INTERACTION_TIMEOUT_MS ??
        String(defaults.run.userInteractionTimeoutMs),
      "RUN_USER_INTERACTION_TIMEOUT_MS",
      1_000,
      86_400_000,
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
    arkBaseUrl: nonEmpty(
      env.ARK_BASE_URL ?? defaults.pi.arkBaseUrl,
      "ARK_BASE_URL",
    ),
    ...(env.ARK_API_KEY?.trim() ? { arkApiKey: env.ARK_API_KEY.trim() } : {}),
  };
}
