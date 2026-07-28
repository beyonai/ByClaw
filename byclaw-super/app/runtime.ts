import { randomUUID } from "node:crypto";
import {
  AgentCapabilityCompileError,
  ConnectorRegistry,
  DelegationService,
  PiLeaderSessionFactory,
  RunService,
  type AgentCapabilityCompileInput,
  type AgentCapabilityCompileResult,
  type AgentCapabilityCompiler,
  type LeaderSession,
  type LeaderSessionFactory,
  type PiRuntimeConfig,
} from "@byclaw/by-conductor";
import { createRedis } from "@byclaw/by-framework";
import { OpenClawByFrameworkConnector } from "@byclaw/connector-openclaw-by-framework";
import { ThirdPartyA2aConnector } from "@byclaw/connector-third-party-a2a";
import { ExecutionDescriptorClient } from "@byclaw/connector-third-party-common";
import { ThirdPartyInterfaceSseConnector } from "@byclaw/connector-third-party-interface-sse";
import { ThirdPartyPageConnector } from "@byclaw/connector-third-party-page";
import { PostgresDatabase } from "@byclaw/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createBeyondTokenVerifier } from "./auth/beyond-token.js";
import { ByClawBeAgentCatalog } from "./business/agent-catalog.js";
import { ByClawBeGroupChatContextProvider } from "./business/group-chat-context.js";
import { ByAiAttachmentResolver } from "./business/byai-attachment-resolver.js";
import { loadConfig, type AppConfig } from "./config/index.js";
import { RedisByClawBeEndpointResolver } from "./business/endpoint-resolver.js";
import { RunIngressService } from "./ingress/run-ingress-service.js";
import { buildHttpApp } from "./server/app.js";
import { ByFrameworkWorkerRuntime } from "./worker/by-framework-worker.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pi Leader 工厂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 延迟初始化 Pi，允许 HTTP 服务暴露 /ready 说明模型配置问题，
 * 而不是在 Composition Root 创建阶段直接丢失诊断上下文。
 */
class LazyPiLeaderFactory implements LeaderSessionFactory, AgentCapabilityCompiler {
  readonly #factory: Promise<
    { factory: PiLeaderSessionFactory; error?: never } | { factory?: never; error: Error }
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

  /** 复用已初始化的 Pi 模型执行无状态能力卡编译。 */
  async compile(input: AgentCapabilityCompileInput): Promise<AgentCapabilityCompileResult> {
    const initialized = await this.#factory;
    if (initialized.error) {
      throw new AgentCapabilityCompileError("Capability model is unavailable", 503, {
        cause: initialized.error,
      });
    }
    return initialized.factory.compile(input);
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

// ─────────────────────────────────────────────────────────────────────────────
// 公共契约
// ─────────────────────────────────────────────────────────────────────────────

export interface Application {
  app: FastifyInstance;
  runService: RunService;
  config: AppConfig;
  /** 开始监听配置的 HTTP 地址。 */
  start(): Promise<void>;
  /** 幂等释放 Run、Fastify 和 Connector 资源。 */
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 组装辅助：把 createApplication 里自成一块的配置/选项/健康聚合抽离出来
// ─────────────────────────────────────────────────────────────────────────────

/** 收敛 Pi 模型运行时配置：provider/model/baseUrl 按是否配置条件展开。 */
function buildPiRuntimeConfig(config: AppConfig, database: PostgresDatabase): PiRuntimeConfig {
  return {
    ...(config.piProvider ? { provider: config.piProvider } : {}),
    ...(config.piModel ? { model: config.piModel } : {}),
    ...(config.openAiBaseUrl ? { openAiBaseUrl: config.openAiBaseUrl } : {}),
    checkpointStore: database.checkpoints,
    instanceId: config.instanceId,
    ...(config.piSessionCacheDirectory
      ? { sessionCacheDirectory: config.piSessionCacheDirectory }
      : {}),
  };
}

/** 组装 RunService 的可观测/队列/凭证运行期参数。 */
function buildRunServiceOptions(config: AppConfig, database: PostgresDatabase) {
  return {
    executionQueue: database.queue,
    checkpoints: database.checkpoints,
    credentials: database.credentials,
    instanceId: config.instanceId,
    leaseMs: config.runLeaseMs,
    queuePollMs: config.runQueuePollMs,
    maxConcurrentRuns: config.worker.maxConcurrency,
    leaderCacheMaxEntries: config.piSessionCacheMaxEntries,
    leaderCacheIdleTtlMs: config.piSessionCacheIdleTtlMs,
    credentialCleanupIntervalMs: config.runCredentialCleanupIntervalMs,
  };
}

/** 聚合 /ready 需要的健康信号：数据库、Pi、连接器与 Worker。 */
async function collectReadiness(input: {
  runService: RunService;
  connectors: ConnectorRegistry;
  database: PostgresDatabase;
  worker: { enabled: boolean; runtime?: ByFrameworkWorkerRuntime };
}) {
  const { runService, connectors, database, worker } = input;
  const [pi, connectorHealth, workerHealth] = await Promise.all([
    runService.health(),
    connectors.health(),
    worker.runtime?.health() ??
      Promise.resolve<{ healthy: boolean; message?: string }>({ healthy: true }),
  ]);
  const schemaHealth = await database.health();
  const listenerHealth = database.events.listenerHealth();
  const databaseHealth = {
    ...schemaHealth,
    healthy: schemaHealth.healthy && listenerHealth.healthy,
    listener: listenerHealth,
  };
  const workerReport = {
    enabled: worker.enabled,
    healthy: workerHealth.healthy,
    ...(worker.runtime
      ? { workerId: worker.runtime.workerId, agentType: worker.runtime.agentType }
      : {}),
    ...(workerHealth.message ? { message: workerHealth.message } : {}),
  };
  return {
    ready:
      databaseHealth.healthy &&
      pi.healthy &&
      Object.values(connectorHealth).every((health) => health.healthy) &&
      workerReport.healthy,
    pi,
    database: databaseHealth,
    connectors: connectorHealth,
    worker: workerReport,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition Root
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 应用 Composition Root：创建 Port 实现、注册 Connector、组装编排服务和 HTTP 层。
 * 具体 Connector 在这里注入，因此 by-conductor 不依赖任何传输实现。
 */
export async function createApplication(config = loadConfig()): Promise<Application> {
  function initByWorker() {
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
  }

  function initService(endpointResolver: RedisByClawBeEndpointResolver) {
    // 附件读取边界：按 fileId 经 BE 下载，凭 Run 短期凭证鉴权；契约见 .dev/attachments-be-read-contract.md。
    const attachmentResolver = new ByAiAttachmentResolver({
      ...config.byClawBe,
      endpointResolver,
      ...(config.attachments.tempDir ? { tempDir: config.attachments.tempDir } : {}),
      maxFileBytes: config.attachments.maxFileBytes,
      maxTextChars: config.attachments.maxTextChars,
      maxStructureChars: config.attachments.maxStructureChars,
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
        ...buildRunServiceOptions(config, database),
        attachmentResolver,
      },
    );
    const runIngress = new RunIngressService(
      runService,
      createBeyondTokenVerifier(config.auth),
      agentCatalog,
      config.runCredentialMaxTtlMs,
      groupChatContexts,
    );
    return { runService, runIngress };
  }

  function initPi(endpointResolver: RedisByClawBeEndpointResolver) {
    const delegationService = new DelegationService(
      connectors,
      delegationRepository,
      eventStore,
      config.delegationTimeoutMs,
    );
    // 后续模型配置改为由业务系统读取；此处仍按 AppConfig 构造 Pi 运行时。
    const leaders = new LazyPiLeaderFactory(buildPiRuntimeConfig(config, database));
    // 数字员工授权列表由 ByClaw BE 实时提供，外部调用方不再传入 agentList。
    const agentCatalog = new ByClawBeAgentCatalog({
      ...config.byClawBe,
      endpointResolver,
      thirdPartyDirect: {
        mode: config.thirdPartyAgents.directMode,
        allowlist: config.thirdPartyAgents.allowlist,
      },
    });
    const groupChatContexts = new ByClawBeGroupChatContextProvider({
      ...config.byClawBe,
      endpointResolver,
    });
    return { delegationService, leaders, agentCatalog, groupChatContexts };
  }

  function initConnector() {
    const connectors = new ConnectorRegistry();
    const redis = createRedis(config.redis);
    const endpointResolver = new RedisByClawBeEndpointResolver(redis);
    // 初始化 openclaw 连接器，目前使用 ByFramework 来连接。
    // Connector 回调的 sourceAgentType 必须与入站 Worker 的逻辑路由名一致。
    const openClaw = new OpenClawByFrameworkConnector({
      redis,
      sourceAgentType: config.worker.agentType,
    });
    connectors.register(openClaw);
    const descriptors = new ExecutionDescriptorClient({
      ...config.byClawBe,
      pathPrefix: config.thirdPartyAgents.descriptorPath,
      ...(config.thirdPartyAgents.serviceCredential
        ? {
            serviceCredential:
              config.thirdPartyAgents.serviceCredential,
          }
        : {}),
      resolveBaseUrl: () => endpointResolver.resolve(),
      allowInsecureExternalHttp:
        config.thirdPartyAgents.allowInsecureExternalHttp,
      allowedExternalHosts:
        config.thirdPartyAgents.allowedExternalHosts,
    });
    connectors.register(
      new ThirdPartyInterfaceSseConnector({
        descriptors,
        requestTimeoutMs:
          config.thirdPartyAgents.requestTimeoutMs,
      }),
    );
    connectors.register(
      new ThirdPartyA2aConnector({
        descriptors,
        requestTimeoutMs:
          config.thirdPartyAgents.requestTimeoutMs,
        allowInsecureExternalHttp:
          config.thirdPartyAgents.allowInsecureExternalHttp,
        allowedExternalHosts:
          config.thirdPartyAgents.allowedExternalHosts,
      }),
    );
    connectors.register(new ThirdPartyPageConnector({ descriptors }));
    return {
      connectors,
      redis,
      openClaw,
      endpointResolver,
    };
  }

  async function initDatabase() {
    const database = new PostgresDatabase(config.database);
    if (config.database.migrateOnStart) {
      await database.migrate();
    }
    const sessionRepository = database.sessions;
    const runRepository = database.runs;
    const delegationRepository = database.delegations;
    const eventStore = database.events;
    return { delegationRepository, eventStore, database, sessionRepository, runRepository };
  }

  // 1) 持久化层：Postgres + 仓储（按配置在启动时迁移 schema）。
  const { delegationRepository, eventStore, database, sessionRepository, runRepository } =
    await initDatabase();

  // 2) 出站传输：Connector 与 ByClaw BE 服务发现共用同一个 Redis 连接。
  const {
    connectors,
    redis,
    openClaw,
    endpointResolver,
  } = initConnector();

  // 3) 编排核心：委派服务 + Pi Leader + 数字员工授权目录。
  const {
    delegationService,
    leaders,
    agentCatalog,
    groupChatContexts,
  } = initPi(endpointResolver);

  // 4) Run 流水线：RunService（快照授权、调度 Leader）+ 入站鉴权与 Run 创建。
  const { runService, runIngress } = initService(endpointResolver);

  // 5) HTTP 入口：/ready 同时要求 Pi、全部已注册 Connector、数据库与 Worker 健康。
  let workerRuntime: ByFrameworkWorkerRuntime | undefined;
  const app = await buildHttpApp({
    capabilityCards: database.capabilityCards,
    capabilityCompiler: leaders,
    runService,
    corsOrigin: config.corsOrigin,
    logger: { level: config.logLevel },
    runIngress,
    // workerRuntime 在第 7 步按需赋值；闭包在调用时读取，保证读到最终实例。
    readiness: async () =>
      collectReadiness({
        runService,
        connectors,
        database,
        worker: {
          enabled: config.worker.enabled,
          ...(workerRuntime ? { runtime: workerRuntime } : {}),
        },
      }),
  });

  // 6) by-framework 入站 Worker：业务入口，由 Composition Root 按需注册。
  //    Connector 只承担 OpenClaw 出站传输，二者职责分离。
  initByWorker();

  // 7) 生命周期：先注册 Worker 再监听端口；关闭时逆序释放。
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
        throw new Error(databaseHealth.message ?? "PostgreSQL persistence is not ready");
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
