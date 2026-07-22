import {
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  PiLeaderSessionFactory,
  RunService,
  type LeaderSession,
  type LeaderSessionFactory,
  type PiRuntimeConfig,
} from "@byclaw/by-conductor";
import { OpenClawByFrameworkConnector } from "@byclaw/connector-openclaw-by-framework";
import type { FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "./config.js";
import { buildHttpApp } from "./server/app.js";

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

  /** 使用已经初始化的 Pi 工厂创建 Thread Session；初始化失败时复用原始异常。 */
  async create(threadId: string): Promise<LeaderSession> {
    const initialized = await this.#factory;
    if (initialized.error) {
      throw initialized.error;
    }
    return initialized.factory.create(threadId);
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

/**
 * 应用 Composition Root：创建 Port 实现、注册 Connector、组装编排服务和 HTTP 层。
 * 具体 Connector 在这里注入，因此 by-conductor 不依赖任何传输实现。
 */
export async function createApplication(config = loadConfig()): Promise<Application> {
  const threadRepository = new InMemoryThreadRepository();
  const runRepository = new InMemoryRunRepository();
  const delegationRepository = new InMemoryDelegationRepository();
  const eventStore = new InMemoryRunEventStore();
  const connectors = new ConnectorRegistry();
  const openClaw = new OpenClawByFrameworkConnector({ redisOptions: config.redis });
  connectors.register(openClaw);
  const delegationService = new DelegationService(
    connectors,
    delegationRepository,
    eventStore,
    config.delegationTimeoutMs,
  );
  const piConfig: PiRuntimeConfig = {
    ...(config.piProvider ? { provider: config.piProvider } : {}),
    ...(config.piModel ? { model: config.piModel } : {}),
    ...(config.openAiBaseUrl ? { openAiBaseUrl: config.openAiBaseUrl } : {}),
  };
  const leaders = new LazyPiLeaderFactory(piConfig);
  const runService = new RunService(
    threadRepository,
    runRepository,
    delegationRepository,
    eventStore,
    delegationService,
    leaders,
  );
  const app = await buildHttpApp({
    runService,
    corsOrigin: config.corsOrigin,
    logger: { level: config.logLevel },
    // /ready 同时要求 Pi 与全部已注册 Connector 健康。
    readiness: async () => {
      const [pi, connectorHealth] = await Promise.all([runService.health(), connectors.health()]);
      return {
        ready: pi.healthy && Object.values(connectorHealth).every((health) => health.healthy),
        pi,
        connectors: connectorHealth,
      };
    },
  });
  let closed = false;

  return {
    app,
    runService,
    config,
    /** 绑定端口并启动 Fastify。 */
    async start() {
      await app.listen({ host: config.host, port: config.port });
    },
    /** 按编排层、HTTP 层、外部连接的顺序执行幂等关闭。 */
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await runService.dispose();
      await app.close();
      await openClaw.close();
    },
  };
}
