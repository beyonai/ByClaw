import { randomUUID } from "node:crypto";
import {
  ConnectorRegistry,
  DelegationService,
  RunService,
  type LeaderModelSelection,
  type PiRuntimeConfig,
} from "@byclaw/by-conductor";
import { createRedis } from "@byclaw/by-framework";
import { CodeByFrameworkConnector } from "@byclaw/connector-code-by-framework";
import { OpenClawByFrameworkConnector } from "@byclaw/connector-openclaw-by-framework";
import { ThirdPartyA2aConnector } from "@byclaw/connector-third-party-a2a";
import { ExecutionDescriptorClient } from "@byclaw/connector-third-party-common";
import { ThirdPartyInterfaceSseConnector } from "@byclaw/connector-third-party-interface-sse";
import { ThirdPartyPageConnector } from "@byclaw/connector-third-party-page";
import { PostgresDatabase } from "@byclaw/storage-postgres";
import type { FastifyInstance } from "fastify";
import { createBeyondTokenVerifier } from "../auth/beyond-token.js";
import { ByClawBeAgentCatalog } from "../business/agent-catalog.js";
import { ByAiAttachmentResolver } from "../business/byai-attachment-resolver.js";
import { RedisByClawBeEndpointResolver } from "../business/endpoint-resolver.js";
import { ByClawBeGroupChatContextProvider } from "../business/group-chat-context.js";
import { ByClawBeTaskPlanGateway } from "../business/task-plan.js";
import { ByClawBeOrchestratorRuntimeProvider } from "../business/orchestrator-runtime.js";
import {
  ByClawBeResourceModelResolver,
  fingerprintModelConfig,
} from "../business/resource-model-binding.js";
import { RedisServiceRegistrar } from "../business/service-registrar.js";
import { loadConfig, type AppConfig } from "../config/index.js";
import { RunIngressService } from "../ingress/run-ingress-service.js";
import {
  RedisFirstLlmProvider,
  type LlmProviderResolution,
} from "../llm-provider/index.js";
import { buildHttpApp } from "../server/app.js";
import { ByFrameworkWorkerRuntime } from "../worker/by-framework-runtime.js";
import { LazyPiLeaderFactory } from "./lazy-pi-leader-factory.js";
import { collectReadiness } from "./readiness.js";

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
// 组装辅助：纯函数构建器，输入显式、无闭包前向引用
// ─────────────────────────────────────────────────────────────────────────────

/** 收敛 Pi 运行时配置，并注入 Redis 优先的模型解析结果。 */
function buildPiRuntimeConfig(
  config: AppConfig,
  database: PostgresDatabase,
  llmProvider: Promise<LlmProviderResolution>,
  modelScope?: string,
  logger?: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
    error(bindings: Record<string, unknown>, message: string): void;
  },
): Promise<PiRuntimeConfig> {
  return llmProvider.then((resolved) => ({
    llmProvider: resolved.config,
    checkpointStore: database.checkpoints,
    instanceId: modelScope ? `${config.instanceId}:${modelScope}` : config.instanceId,
    ...(config.piSessionCacheDirectory
      ? { sessionCacheDirectory: config.piSessionCacheDirectory }
      : {}),
    ...(logger ? { logger } : {}),
  }));
}

function createLlmProviderSource(
  config: AppConfig,
  redis: ReturnType<typeof createRedis>,
): RedisFirstLlmProvider {
  return new RedisFirstLlmProvider({
    redis,
    fallback: {
      providerId: config.piProvider ?? "volcengine-ark",
      modelId: config.piModel ?? "deepseek-v4-pro-260425",
      baseUrl: config.arkBaseUrl ?? "https://ark.cn-beijing.volces.com/api/v3",
      ...(config.arkApiKey ? { apiKey: config.arkApiKey } : {}),
    },
    logger: {
      info: (message) => console.info(message),
      warn: (message) => console.warn(message),
    },
  });
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

/** 出站传输：Connector Registry + 共享 Redis + ByClaw BE 服务发现。 */
function createConnectors(
  config: AppConfig,
  logger: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
    error(bindings: Record<string, unknown>, message: string): void;
  },
) {
  const connectors = new ConnectorRegistry();
  const redis = createRedis(config.redis);
  const endpointResolver = new RedisByClawBeEndpointResolver(redis);
  // 初始化 openclaw 连接器，目前使用 ByFramework 来连接。
  // Connector 回调的 sourceAgentType 必须与入站 Worker 的逻辑路由名一致。
  const openClaw = new OpenClawByFrameworkConnector({
    redis,
    sourceAgentType: config.worker.agentType,
    logger,
  });
  connectors.register(openClaw);
  const code = new CodeByFrameworkConnector({
    redis,
    sourceAgentType: config.worker.agentType,
    logger,
  });
  connectors.register(code);
  const descriptors = new ExecutionDescriptorClient({
    ...config.byClawBe,
    pathPrefix: config.thirdPartyAgents.descriptorPath,
    ...(config.thirdPartyAgents.serviceCredential
      ? { serviceCredential: config.thirdPartyAgents.serviceCredential }
      : {}),
    resolveBaseUrl: () => endpointResolver.resolve(),
    allowInsecureExternalHttp: config.thirdPartyAgents.allowInsecureExternalHttp,
    allowedExternalHosts: config.thirdPartyAgents.allowedExternalHosts,
  });
  connectors.register(
    new ThirdPartyInterfaceSseConnector({
      descriptors,
      requestTimeoutMs: config.thirdPartyAgents.requestTimeoutMs,
    }),
  );
  connectors.register(
    new ThirdPartyA2aConnector({
      descriptors,
      requestTimeoutMs: config.thirdPartyAgents.requestTimeoutMs,
      allowInsecureExternalHttp: config.thirdPartyAgents.allowInsecureExternalHttp,
      allowedExternalHosts: config.thirdPartyAgents.allowedExternalHosts,
    }),
  );
  connectors.register(new ThirdPartyPageConnector({ descriptors }));
  return {
    connectors,
    redis,
    byFrameworkConnectors: [openClaw, code],
    endpointResolver,
  };
}

/** 编排核心：委派服务 + Pi Leader + 数字员工授权目录 + 群聊/资源模型提供方。 */
function createOrchestration(input: {
  config: AppConfig;
  database: PostgresDatabase;
  connectors: ConnectorRegistry;
  endpointResolver: RedisByClawBeEndpointResolver;
  redis: ReturnType<typeof createRedis>;
  logger: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
    error(bindings: Record<string, unknown>, message: string): void;
  };
}) {
  const { config, database, connectors, endpointResolver, redis, logger } = input;
  const delegationService = new DelegationService(
    connectors,
    database.delegations,
    database.events,
    config.delegationTimeouts,
    Date.now,
    randomUUID,
    logger,
  );
  const llmProvider = createLlmProviderSource(config, redis);
  const leaders = new LazyPiLeaderFactory(
    buildPiRuntimeConfig(config, database, llmProvider.resolve(), undefined, logger),
    async (selection: LeaderModelSelection) => {
      const modelConfig = await llmProvider.resolveByModelId(selection.modelId);
      if (fingerprintModelConfig(modelConfig) !== selection.fingerprint) {
        throw new Error(
          `Leader model config changed before Run execution: ${selection.modelId}`,
        );
      }
      return buildPiRuntimeConfig(
        config,
        database,
        Promise.resolve({ source: "redis", config: modelConfig }),
        `model:${selection.modelId}:${selection.fingerprint}`,
        logger,
      );
    },
  );
  // 数字员工授权列表由 ByClaw BE 实时提供，外部调用方不再传入 agentList。
  const agentCatalog = new ByClawBeAgentCatalog({
    ...config.byClawBe,
    endpointResolver,
  });
  const groupChatContexts = new ByClawBeGroupChatContextProvider({
    ...config.byClawBe,
    endpointResolver,
  });
  const resourceModels = new ByClawBeResourceModelResolver({
    ...config.byClawBe,
    endpointResolver,
    llmProvider,
  });
  const orchestratorRuntimes = new ByClawBeOrchestratorRuntimeProvider({
    ...config.byClawBe,
    endpointResolver,
    llmProvider,
  });
  return {
    delegationService,
    leaders,
    agentCatalog,
    groupChatContexts,
    resourceModels,
    orchestratorRuntimes,
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
  // Run 入口日志在 app 构造前就需要注入；sink 在 app 就绪后回填，避免循环依赖。
  let ingressInfoSink:
    | ((bindings: Record<string, unknown>, message: string) => void)
    | undefined;
  let ingressWarningSink:
    | ((bindings: Record<string, unknown>, message: string) => void)
    | undefined;
  let ingressErrorSink:
    | ((bindings: Record<string, unknown>, message: string) => void)
    | undefined;
  const ingressLogger = {
    info(bindings: Record<string, unknown>, message: string) {
      ingressInfoSink?.(bindings, message);
    },
    warn(bindings: Record<string, unknown>, message: string) {
      ingressWarningSink?.(bindings, message);
    },
    error(bindings: Record<string, unknown>, message: string) {
      ingressErrorSink?.(bindings, message);
    },
  };

  // 1) 持久化层：Postgres + 仓储（按配置在启动时迁移 schema）。
  const database = new PostgresDatabase(config.database);
  if (config.database.migrateOnStart) {
    await database.migrate();
  }

  // 2) 出站传输：Connector 与 ByClaw BE 服务发现共用同一个 Redis 连接。
  const { connectors, redis, byFrameworkConnectors, endpointResolver } =
    createConnectors(config, ingressLogger);

  // 3) 编排核心：委派服务 + Pi Leader + 数字员工授权目录。
  const {
    delegationService,
    leaders,
    agentCatalog,
    groupChatContexts,
    resourceModels,
    orchestratorRuntimes,
  } = createOrchestration({
    config,
    database,
    connectors,
    endpointResolver,
    redis,
    logger: ingressLogger,
  });

  // 4) Run 流水线：RunService（快照授权、调度 Leader）+ 入站鉴权与 Run 创建。
  //    附件读取边界：按 fileId 经 BE 下载，凭 Run 短期凭证鉴权；契约见 .dev/attachments-be-read-contract.md。
  const attachmentResolver = new ByAiAttachmentResolver({
    ...config.byClawBe,
    endpointResolver,
    ...(config.attachments.tempDir ? { tempDir: config.attachments.tempDir } : {}),
    maxFileBytes: config.attachments.maxFileBytes,
    maxTextChars: config.attachments.maxTextChars,
    maxStructureChars: config.attachments.maxStructureChars,
  });
  const taskPlans = new ByClawBeTaskPlanGateway({
    ...config.byClawBe,
    endpointResolver,
  });
  const runService = new RunService(
    database.sessions,
    database.runs,
    database.delegations,
    database.events,
    delegationService,
    leaders,
    Date.now,
    randomUUID,
    {
      ...buildRunServiceOptions(config, database),
      logger: ingressLogger,
      attachmentResolver,
      taskPlans,
    },
  );
  const runIngress = new RunIngressService(
    runService,
    createBeyondTokenVerifier(config.auth),
    agentCatalog,
    config.runCredentialMaxTtlMs,
    groupChatContexts,
    ingressLogger,
    resourceModels,
    orchestratorRuntimes,
  );

  // 5) HTTP 入口：/ready 同时要求 Pi、全部已注册 Connector、数据库与 Worker 健康。
  //    workerRuntime 在第 7 步按需赋值；闭包在调用时读取，保证读到最终实例。
  let workerRuntime: ByFrameworkWorkerRuntime | undefined;
  const app = await buildHttpApp({
    capabilityCards: database.capabilityCards,
    capabilityCompiler: leaders,
    runService,
    corsOrigin: config.corsOrigin,
    logger: { level: config.logLevel },
    runIngress,
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
  ingressInfoSink = (bindings, message) => app.log.info(bindings, message);
  ingressWarningSink = (bindings, message) => app.log.warn(bindings, message);
  ingressErrorSink = (bindings, message) => app.log.error(bindings, message);
  const serviceRegistrar = new RedisServiceRegistrar(
    redis,
    {
      ...config.serviceDiscovery,
      instanceId: config.instanceId,
      metadata: {
        framework: "node",
        service: "byclaw-super",
      },
    },
    app.log,
  );

  // 6) by-framework 入站 Worker：业务入口，由 Composition Root 按需注册。
  //    Connector 只承担 OpenClaw 出站传输，二者职责分离。
  if (config.worker.enabled) {
    workerRuntime = new ByFrameworkWorkerRuntime({
      redis,
      runService,
      runIngress,
      sessionBindings: database.bindings,
      timeoutDeliveries: database.queue,
      agentType: config.worker.agentType,
      ...(config.worker.workerId ? { workerId: config.worker.workerId } : {}),
      maxConcurrency: config.worker.maxConcurrency,
      logger: app.log,
    });
  }

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
        await serviceRegistrar.start();
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
      await serviceRegistrar.close();
      await app.close();
      await Promise.all(
        byFrameworkConnectors.map((connector) => connector.close()),
      );
      await redis.quit();
      await database.close();
    },
  };
}
