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
  auth: {
    /** 与 ByClaw 后端登录公钥一致的 RS256 公钥（可用 LOGIN_JWT_PUBLIC_KEY 考察）。 */
    loginJwtPublicKey:
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7wg45uUnUgPB2/uE/hpto6pSoviXi7JzS9ip6J1+CbB/bRYydF+6XnVJ5ddw5AAXSNo51beMKUEWguKg5QVzfrYPw063ojTy/36plFmTpNs7u+2fd4fvy7SrS64NRIfahp7scp6NMMXbgDrFLFXs6KJEsG7ThlA4XS4h5BS+oJ6nSnjYz6iC8PXt4wXSoyf61uWSloihQL9fO0RuAHQtHEuwuT8oHG20sg/ylSwV1/8zF4A0MdlOtbSq5UvvDWyVoOKfmEXt8V8h7ZLFAFABW2vVref5ltY0aTTqv/sM5niCa5JLB0w0beCd8FtiWljk7AF0j1W22YqtSDy2xP58IwIDAQAB",
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
  delegationTimeouts: {
    firstActivityMs: 300_000,
    idleMs: 900_000,
    callbackMs: 300_000,
  },
  openClaw: {
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
