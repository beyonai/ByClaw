/**
 * 可被环境变量覆盖的稳定默认值。
 * 安全凭证和数据库账号不允许放在这里。
 */
export const APP_CONFIG_DEFAULTS = {
  http: {
    host: "0.0.0.0",
    port: 3_000,
    corsOrigin: "*",
    logLevel: "info",
  },
  database: {
    type: "postgresql",
    host: "127.0.0.1",
    port: 5_432,
    database: "postgres",
    schema: "byai",
    ssl: false,
    eventListenEnabled: true,
    maxConnections: 20,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    statementTimeoutMs: 30_000,
    migrateOnStart: false,
  },
  redis: {
    host: "127.0.0.1",
    port: 6_379,
    database: 0,
  },
  delegationTimeoutMs: 1_800_000,
  worker: {
    enabled: true,
    agentType: "BY_SUPER",
    maxConcurrency: 10,
  },
  byClawBe: {
    baseUrl: "http://127.0.0.1:8086",
    timeoutMs: 10_000,
  },
  run: {
    leaseMs: 30_000,
    queuePollMs: 500,
    credentialMaxTtlMs: 7_200_000,
    credentialCleanupIntervalMs: 60_000,
  },
  piSession: {
    cacheMaxEntries: 100,
    cacheIdleTtlMs: 1_800_000,
    entryMaxBytes: 1_048_576,
    sessionMaxBytes: 16_777_216,
    sessionMaxEntries: 20_000,
  },
  pi: {
    provider: "zhipu",
    model: "glm-5.2",
    openAiBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  },
} as const;
