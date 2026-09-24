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
  /** 配置在使用时读取；不同实例均从 Redis 解析相同的当前模型数据。 */
  constructor(
    private readonly config: PiRuntimeConfig | Promise<PiRuntimeConfig> | (() => Promise<PiRuntimeConfig>),
    private readonly modelConfig?: (
      selection: LeaderModelSelection,
    ) => Promise<PiRuntimeConfig>,
  ) {}

  /** 使用已经初始化的 Pi 工厂创建业务 Session 对应的 Pi 会话。 */
  async create(
    sessionId: string,
    model?: LeaderModelSelection,
  ): Promise<LeaderSession> {
    if (model) {
      return (await this.#factoryForModel(model)).create(sessionId);
    }
    return (await this.#createDefaultFactory()).create(sessionId);
  }

  /** 复用已初始化的 Pi 模型执行无状态能力卡编译。 */
  async compile(input: AgentCapabilityCompileInput): Promise<AgentCapabilityCompileResult> {
    let factory: PiLeaderSessionFactory;
    try {
      factory = await this.#createDefaultFactory();
    } catch (error) {
      throw new AgentCapabilityCompileError("Capability model is unavailable", 503, {
        cause: error,
      });
    }
    return factory.compile(input);
  }

  /** 将 Pi 初始化异常转换为 readiness 可消费的健康状态。 */
  async health(): Promise<{ healthy: boolean; message?: string; model?: string }> {
    try {
      return await (await this.#createDefaultFactory()).health();
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #createDefaultFactory(): Promise<PiLeaderSessionFactory> {
    const config = typeof this.config === "function" ? this.config() : this.config;
    return PiLeaderSessionFactory.create(await config);
  }

  #factoryForModel(selection: LeaderModelSelection): Promise<PiLeaderSessionFactory> {
    if (!this.modelConfig) {
      return Promise.reject(new Error("Leader model hot switching is not configured"));
    }
    // 每次恢复从 Redis 读取当前有效配置；模型密钥和参数更新不阻断已有 Run。
    return this.modelConfig(selection).then(PiLeaderSessionFactory.create);
  }
}
