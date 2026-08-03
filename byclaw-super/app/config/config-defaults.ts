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
    eventListenEnabled: true,
    maxConnections: 20,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
    statementTimeoutMs: 30_000,
    migrateOnStart: false,
  },
  delegationTimeoutMs: 900_000,
  openClaw: {
    firstEventTimeoutMs: 300_000,
    cancelConfirmationTimeoutMs: 30_000,
  },
  worker: {
    enabled: true,
    agentType: "BY_SUPER",
    maxConcurrency: 10,
  },
  byClawBe: {
    baseUrl: "http://127.0.0.1:8086",
    timeoutMs: 10_000,
  },
  serviceDiscovery: {
    enabled: true,
    serviceName: "ByclawSuperService",
    protocol: "http",
    host: "byclaw-super.by-service.svc.cluster.local",
    pathPrefix: "/byclawSuper",
    weight: 1,
    heartbeatIntervalMs: 5_000,
  },
  thirdPartyAgents: {
    directMode: "off",
    allowlist: "",
    descriptorPath:
      "/byaiService/api/internal/v1/digital-employees",
    requestTimeoutMs: 300_000,
    allowInsecureExternalHttp: false,
    allowedExternalHosts: "",
  },
  attachments: {
    maxFileBytes: 10_485_760,
    maxTextChars: 8_000,
    maxStructureChars: 4_000,
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
    provider: "volcengine-ark",
    model: "deepseek-v4-pro-260425",
    arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
} as const;
