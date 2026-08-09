import type { IngressSessionBindingRepository } from "@byclaw/by-conductor";
import { WorkerRegistry, WorkerRunner } from "@byclaw/by-framework";
import {
  ByClawSuperGatewayWorker,
  type RedisClient,
  type WorkerLogger,
  type WorkerRunIngress,
  type WorkerRunService,
} from "./by-framework-worker.js";
import { defaultWorkerId, delay, toError } from "./by-framework-protocol.js";

export interface ByFrameworkWorkerRuntimeOptions {
  redis: RedisClient;
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  sessionBindings?: IngressSessionBindingRepository;
  agentType: string;
  workerId?: string;
  maxConcurrency: number;
  startupTimeoutMs?: number;
  logger?: WorkerLogger;
}

/** 管理 WorkerRunner 的后台循环、在线确认和优雅停止。 */
export class ByFrameworkWorkerRuntime {
  readonly workerId: string;
  readonly agentType: string;
  readonly #registry: WorkerRegistry;
  readonly #runner: WorkerRunner;
  readonly #startupTimeoutMs: number;
  readonly #logger: WorkerLogger | undefined;
  #runPromise: Promise<void> | undefined;
  #runFailure: Error | undefined;
  #runnerStopped = false;
  #closing = false;

  /** 创建 Worker 和 Runner，但在 start 调用前不抢占 Worker ID 或消费消息。 */
  constructor(options: ByFrameworkWorkerRuntimeOptions) {
    this.workerId = options.workerId ?? defaultWorkerId();
    this.agentType = options.agentType;
    this.#registry = new WorkerRegistry(options.redis);
    const worker = new ByClawSuperGatewayWorker({
      workerId: this.workerId,
      agentType: this.agentType,
      redis: options.redis,
      registry: this.#registry,
      runService: options.runService,
      runIngress: options.runIngress,
      ...(options.sessionBindings ? { sessionBindings: options.sessionBindings } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
    });
    this.#runner = new WorkerRunner(worker, {
      redisClient: options.redis,
      maxConcurrency: options.maxConcurrency,
    });
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.#logger = options.logger;
  }

  /** 在后台启动消费循环，并等待注册中心确认 Worker 已在线。 */
  async start(): Promise<void> {
    if (this.#runPromise) {
      return;
    }
    this.#logger?.info(
      { workerId: this.workerId, agentType: this.agentType },
      "正在注册 by-framework Worker",
    );
    const runPromise = this.#runner.start({ handleSignals: false });
    this.#runPromise = runPromise;
    void runPromise.then(
      () => {
        this.#runnerStopped = true;
      },
      (error: unknown) => {
        this.#runFailure = toError(error);
        this.#logger?.error(
          { workerId: this.workerId, error: this.#runFailure.message },
          "by-framework Worker 运行失败",
        );
      },
    );

    try {
      await this.#waitUntilOnline();
      this.#logger?.info(
        { workerId: this.workerId, agentType: this.agentType },
        "by-framework Worker 已注册并在线",
      );
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /** 查询当前 Worker 是否仍持有在线租约，供 /byclawSuper/ready 聚合。 */
  async health(): Promise<{ healthy: boolean; message?: string }> {
    if (this.#runFailure) {
      return { healthy: false, message: this.#runFailure.message };
    }
    if (!this.#runPromise || this.#runnerStopped) {
      return { healthy: false, message: "by-framework Worker is not running" };
    }
    try {
      const online = await this.#registry.isWorkerOnline(this.workerId);
      return {
        healthy: online,
        ...(online ? {} : { message: "by-framework Worker lease is offline" }),
      };
    } catch (error) {
      return { healthy: false, message: toError(error).message };
    }
  }

  /** 幂等停止消费循环，并等待 WorkerRunner 释放心跳和 Worker ID 锁。 */
  async close(): Promise<void> {
    if (this.#closing) {
      return;
    }
    this.#closing = true;
    this.#runner.stop();
    await this.#runPromise?.catch(() => undefined);
    this.#logger?.info(
      { workerId: this.workerId, agentType: this.agentType },
      "by-framework Worker 已停止",
    );
  }

  /** 在限定时间内轮询 Worker 租约，同时提前暴露 Runner 启动异常。 */
  async #waitUntilOnline(): Promise<void> {
    const deadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < deadline) {
      if (this.#runFailure) {
        throw this.#runFailure;
      }
      if (this.#runnerStopped) {
        throw new Error("by-framework Worker stopped during startup");
      }
      if (await this.#registry.isWorkerOnline(this.workerId)) {
        return;
      }
      await delay(50);
    }
    throw new Error(
      `Timed out waiting for by-framework Worker to become online: ${this.workerId}`,
    );
  }
}
