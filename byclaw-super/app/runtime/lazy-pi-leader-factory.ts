import {
  AgentCapabilityCompileError,
  PiLeaderSessionFactory,
  type AgentCapabilityCompileInput,
  type AgentCapabilityCompileResult,
  type AgentCapabilityCompiler,
  type LeaderSession,
  type LeaderSessionFactory,
  type LeaderModelSelection,
  type PiRuntimeConfig,
} from "@byclaw/by-conductor";

/**
 * 延迟初始化 Pi，允许 HTTP 服务暴露 /byclawSuper/ready 说明模型配置问题，
 * 而不是在 Composition Root 创建阶段直接丢失诊断上下文。
 */
export class LazyPiLeaderFactory implements LeaderSessionFactory, AgentCapabilityCompiler {
  readonly #defaultFactory: Promise<
    { factory: PiLeaderSessionFactory; error?: never } | { factory?: never; error: Error }
  >;
  readonly #modelFactories = new Map<string, Promise<PiLeaderSessionFactory>>();

  /** 立即启动一次模型运行时初始化，并把成功或异常缓存为稳定结果。 */
  constructor(
    config: PiRuntimeConfig | Promise<PiRuntimeConfig>,
    private readonly modelConfig?: (
      selection: LeaderModelSelection,
    ) => Promise<PiRuntimeConfig>,
  ) {
    this.#defaultFactory = Promise.resolve(config)
      .then(PiLeaderSessionFactory.create)
      .then(
        (factory) => ({ factory }),
        (error: unknown) => ({
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      );
  }

  /** 使用已经初始化的 Pi 工厂创建业务 Session 对应的 Pi 会话。 */
  async create(
    sessionId: string,
    model?: LeaderModelSelection,
  ): Promise<LeaderSession> {
    if (model) {
      return (await this.#factoryForModel(model)).create(sessionId);
    }
    const initialized = await this.#defaultFactory;
    if (initialized.error) {
      throw initialized.error;
    }
    return initialized.factory.create(sessionId);
  }

  /** 复用已初始化的 Pi 模型执行无状态能力卡编译。 */
  async compile(input: AgentCapabilityCompileInput): Promise<AgentCapabilityCompileResult> {
    const initialized = await this.#defaultFactory;
    if (initialized.error) {
      throw new AgentCapabilityCompileError("Capability model is unavailable", 503, {
        cause: initialized.error,
      });
    }
    return initialized.factory.compile(input);
  }

  /** 将 Pi 初始化异常转换为 readiness 可消费的健康状态。 */
  async health(): Promise<{ healthy: boolean; message?: string; model?: string }> {
    const initialized = await this.#defaultFactory;
    if (initialized.error) {
      return {
        healthy: false,
        message: initialized.error.message,
      };
    }
    return initialized.factory.health();
  }

  #factoryForModel(selection: LeaderModelSelection): Promise<PiLeaderSessionFactory> {
    if (!this.modelConfig) {
      return Promise.reject(new Error("Leader model hot switching is not configured"));
    }
    const key = `${selection.modelId}:${selection.fingerprint}`;
    const existing = this.#modelFactories.get(key);
    if (existing) {
      return existing;
    }
    const created = this.modelConfig(selection).then(PiLeaderSessionFactory.create);
    this.#modelFactories.set(key, created);
    void created.catch(() => {
      if (this.#modelFactories.get(key) === created) {
        this.#modelFactories.delete(key);
      }
    });
    return created;
  }
}
