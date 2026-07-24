import { randomUUID } from "node:crypto";
import {
  ConnectorRegistry,
  DelegationService,
  EnvelopeExecutionCredentialCipher,
  PiLeaderSessionFactory,
  RunService,
  type KeyEncryptionService,
  type LeaderSession,
  type LeaderSessionFactory,
  type PiRuntimeConfig,
} from "@byclaw/by-conductor";
import { createRedis } from "@byclaw/by-framework";
import { OpenClawByFrameworkConnector } from "@byclaw/connector-openclaw-by-framework";
import { PostgresDatabase } from "@byclaw/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createBeyondTokenVerifier } from "./auth/beyond-token.js";
import { ByClawBeAgentCatalog } from "./byclaw-be-agent-catalog.js";
import { loadConfig, type AppConfig } from "./config.js";
import { RedisByClawBeEndpointResolver } from "./redis-service-discovery.js";
import { RunIngressService } from "./run-ingress-service.js";
import { buildHttpApp } from "./server/app.js";
import { ByFrameworkWorkerRuntime } from "./worker/by-framework-worker.js";

/**
 * 延迟初始化 Pi，允许 HTTP 服务暴露 /ready 说明模型配置问题，
 * 而不是在 Composition Root 创建阶段直接丢失诊断上下文。
 */
class LazyPiLeaderFactory implements LeaderSessionFactory {
  readonly #factory: Promise<
    | { factory: PiLeaderSessionFactory; error?: never }
    | { factory?: never; error: Error }
  >;

  /** 立即启动一次模型运行时初始化，并把成功或异常缓存为稳定结果。 */
  constructor(config: PiRuntimeConfig) {
    this.#factory = PiLeaderSessionFactory.create(config).then(
      (factory) => ({ factory }),
      (error: unknown) => ({
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    );
  }

  /** 使用已经初始化的 Pi 工厂创建业务 Session 对应的 Pi 会话。 */
  async create(sessionId: string): Promise<LeaderSession> {
    const initialized = await this.#factory;
    if (initialized.error) {
      throw initialized.error;
    }
    return initialized.factory.create(sessionId);
  }

  /** 将 Pi 初始化异常转换为 readiness 可消费的健康状态。 */
  async health(): Promise<{ healthy: boolean; message?: string; model?: string }> {
    const initialized = await this.#factory;
    if (initialized.error) {
      return {
        healthy: false,
        message: initialized.error.message,
      };
    }
    return initialized.factory.health();
  }
}

export interface Application {
  app: FastifyInstance;
  runService: RunService;
  config: AppConfig;
  /** 开始监听配置的 HTTP 地址。 */
  start(): Promise<void>;
  /** 幂等释放 Run、Fastify 和 Connector 资源。 */
  close(): Promise<void>;
}

export interface ApplicationDependencies {
  /**
   * 生产必须注入真实 KMS adapter。此依赖不提供“本地密钥”隐式降级，
   * 防止多实例在配置错误时悄悄失去凭证接管能力。
   */
  keyEncryptionService: KeyEncryptionService;
}

/**
 * 应用 Composition Root：创建 Port 实现、注册 Connector、组装编排服务和 HTTP 层。
 * 具体 Connector 在这里注入，因此 by-conductor 不依赖任何传输实现。
 */
export async function createApplication(
  config = loadConfig(),
  dependencies?: ApplicationDependencies,
): Promise<Application> {
  if (!dependencies?.keyEncryptionService) {
    throw new Error(
      "A production KeyEncryptionService must be injected for KMS envelope encryption",
    );
  }
  const database = new PostgresDatabase(config.database);
  if (config.database.migrateOnStart) {
    await database.migrate();
  }
  const sessionRepository = database.sessions;
  const runRepository = database.runs;
  const delegationRepository = database.delegations;
  const eventStore = database.events;
  
  // 创建连接器
  const connectors = new ConnectorRegistry();
  // Connector 和 ByClaw BE 服务发现共用同一个 Redis 连接。
  const redis = createRedis(config.redis);
  // 初始化 openclaw 连接器，目前使用 ByFramework 来连接
  const openClaw = new OpenClawByFrameworkConnector({
    redis,
    // Connector 回调的 sourceAgentType 必须与入站 Worker 的逻辑路由名一致。
    sourceAgentType: config.worker.agentType,
  });
  connectors.register(openClaw);

  //编排服务
  const delegationService = new DelegationService(
    connectors,
    delegationRepository,
    eventStore,
    config.delegationTimeoutMs,
  );

  //pi agent 初始化，后续模型配置改为由从业务系统中读取 
  const piConfig: PiRuntimeConfig = {
    ...(config.piProvider ? { provider: config.piProvider } : {}),
    ...(config.piModel ? { model: config.piModel } : {}),
    ...(config.openAiBaseUrl ? { openAiBaseUrl: config.openAiBaseUrl } : {}),
    checkpointStore: database.checkpoints,
    instanceId: config.instanceId,
    ...(config.piSessionCacheDirectory
      ? { sessionCacheDirectory: config.piSessionCacheDirectory }
      : {}),
  };

  //懒加载
  const leaders = new LazyPiLeaderFactory(piConfig);
  // 数字员工授权列表由 ByClaw BE 实时提供，外部调用方不再传入 agentList。
  const agentCatalog = new ByClawBeAgentCatalog({
    ...config.byClawBe,
    endpointResolver: new RedisByClawBeEndpointResolver(redis),
  });
  const runService = new RunService(
    sessionRepository,
    runRepository,
    delegationRepository,
    eventStore,
    delegationService,
    leaders,
    Date.now,
    randomUUID,
    {
      executionQueue: database.queue,
      checkpoints: database.checkpoints,
      credentials: database.credentials,
      credentialCipher: new EnvelopeExecutionCredentialCipher(
        dependencies.keyEncryptionService,
      ),
      instanceId: config.instanceId,
      leaseMs: config.runLeaseMs,
      queuePollMs: config.runQueuePollMs,
      maxConcurrentRuns: config.worker.maxConcurrency,
      leaderCacheMaxEntries: config.piSessionCacheMaxEntries,
      leaderCacheIdleTtlMs: config.piSessionCacheIdleTtlMs,
      credentialCleanupIntervalMs: config.runCredentialCleanupIntervalMs,
    },
  );
  const runIngress = new RunIngressService(
    runService,
    createBeyondTokenVerifier(config.auth),
    agentCatalog,
    config.runCredentialMaxTtlMs,
  );
  let workerRuntime: ByFrameworkWorkerRuntime | undefined;

  //启动 http 服务
  const app = await buildHttpApp({
    runService,
    corsOrigin: config.corsOrigin,
    logger: { level: config.logLevel },
    runIngress,
    // /ready 同时要求 Pi 与全部已注册 Connector 健康。
    readiness: async () => {
      const [pi, connectorHealth, workerHealth] = await Promise.all([
        runService.health(),
        connectors.health(),
        workerRuntime?.health() ??
          Promise.resolve<{ healthy: boolean; message?: string }>({ healthy: true }),
      ]);
      const schemaHealth = await database.health();
      const listenerHealth = database.events.listenerHealth();
      const databaseHealth = {
        ...schemaHealth,
        healthy: schemaHealth.healthy && listenerHealth.healthy,
        listener: listenerHealth,
      };
      const worker = {
        enabled: config.worker.enabled,
        healthy: workerHealth.healthy,
        ...(workerRuntime
          ? { workerId: workerRuntime.workerId, agentType: workerRuntime.agentType }
          : {}),
        ...(workerHealth.message ? { message: workerHealth.message } : {}),
      };
      return {
        ready:
          databaseHealth.healthy &&
          pi.healthy &&
          Object.values(connectorHealth).every((health) => health.healthy) &&
          worker.healthy,
        pi,
        database: databaseHealth,
        connectors: connectorHealth,
        worker,
      };
    },
  });
  // Worker 属于业务入口，由 Composition Root 注册；Connector 只承担 OpenClaw 出站传输。
  if (config.worker.enabled) {
    workerRuntime = new ByFrameworkWorkerRuntime({
      redis,
      runService,
      runIngress,
      sessionBindings: database.bindings,
      agentType: config.worker.agentType,
      ...(config.worker.workerId ? { workerId: config.worker.workerId } : {}),
      maxConcurrency: config.worker.maxConcurrency,
      logger: app.log,
    });
  }
  let closed = false;

  return {
    app,
    runService,
    config,
    /** 先注册 by-framework Worker，再绑定 HTTP 端口，避免就绪窗口接到无法消费的任务。 */
    async start() {
      await database.start();
      const databaseHealth = await database.health();
      if (!databaseHealth.healthy) {
        throw new Error(
          databaseHealth.message ?? "PostgreSQL persistence is not ready",
        );
      }
      runService.start();
      await workerRuntime?.start();
      try {
        await app.listen({ host: config.host, port: config.port });
      } catch (error) {
        await workerRuntime?.close();
        throw error;
      }
    },
    /** 先停止两个入站入口，再释放编排层、Connector 与共享 Redis。 */
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await workerRuntime?.close();
      await runService.dispose();
      await app.close();
      await openClaw.close();
      await redis.quit();
      await database.close();
    },
  };
}
