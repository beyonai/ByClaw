import type {
  CallbackTimeoutDelivery,
  IngressSessionBindingRepository,
  RunExecutionQueue,
} from "@byclaw/by-conductor";
import {
  AgentState,
  EventType,
  GatewayDataEmitter,
  WorkerRegistry,
  WorkerRunner,
} from "@byclaw/by-framework";
import {
  type RedisClient,
  type WorkerLogger,
  type WorkerRunIngress,
  type WorkerRunService,
} from "./by-framework-worker-contracts.js";
import { ByClawSuperGatewayWorker } from "./by-framework-worker.js";
import { defaultWorkerId, delay, toError } from "./by-framework-protocol.js";

export interface ByFrameworkWorkerRuntimeOptions {
  redis: RedisClient;
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  sessionBindings?: IngressSessionBindingRepository;
  timeoutDeliveries?: Pick<
    RunExecutionQueue,
    "claimCallbackTimeoutDeliveries" | "completeCallbackTimeoutDelivery"
  >;
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
  readonly #timeoutDeliveries: ByFrameworkWorkerRuntimeOptions["timeoutDeliveries"];
  readonly #protocolEmitter: GatewayDataEmitter;
  readonly #maxConcurrency: number;
  #runPromise: Promise<void> | undefined;
  #timeoutDeliveryLoop: Promise<void> | undefined;
  #timeoutDeliveryTimer: ReturnType<typeof setInterval> | undefined;
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
    this.#timeoutDeliveries = options.timeoutDeliveries;
    this.#protocolEmitter = new GatewayDataEmitter(options.redis);
    this.#maxConcurrency = options.maxConcurrency;
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
      if (this.#timeoutDeliveries?.claimCallbackTimeoutDeliveries) {
        this.#timeoutDeliveryTimer = setInterval(() => {
          void this.#drainTimeoutDeliveries();
        }, 1_000);
        this.#timeoutDeliveryTimer.unref?.();
        void this.#drainTimeoutDeliveries();
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async poll() {

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
    if (this.#timeoutDeliveryTimer) {
      clearInterval(this.#timeoutDeliveryTimer);
      this.#timeoutDeliveryTimer = undefined;
    }
    this.#runner.stop();
    await this.#runPromise?.catch(() => undefined);
    await this.#timeoutDeliveryLoop?.catch(() => undefined);
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

  /** 领取数据库 Outbox；Redis 发布失败时不确认，租约到期后由任一实例重试。 */
  async #drainTimeoutDeliveries(): Promise<void> {
    const store = this.#timeoutDeliveries;
    if (
      this.#closing ||
      this.#timeoutDeliveryLoop ||
      !store?.claimCallbackTimeoutDeliveries ||
      !store.completeCallbackTimeoutDelivery
    ) {
      return this.#timeoutDeliveryLoop ?? Promise.resolve();
    }
    this.#timeoutDeliveryLoop = store
      .claimCallbackTimeoutDeliveries({
        instanceId: this.workerId,
        leaseMs: 30_000,
        limit: this.#maxConcurrency,
      })
      .then(async (deliveries) => {
        await Promise.allSettled(deliveries.map((delivery) => this.#deliverTimeout(delivery)));
      })
      .catch((error) => {
        this.#logger?.warn(
          { workerId: this.workerId, error: toError(error).message },
          "扫描或投递子 Agent 回调超时结果失败，等待数据库租约后重试",
        );
      })
      .finally(() => {
        this.#timeoutDeliveryLoop = undefined;
      });
    return this.#timeoutDeliveryLoop;
  }

  async #deliverTimeout(delivery: CallbackTimeoutDelivery): Promise<void> {
    if ("routingError" in delivery) {
      this.#logger?.error(
        {
          workerId: this.workerId,
          runId: delivery.runId,
          error: delivery.routingError,
        },
        "子 Agent 回调超时结果缺少外部流路由，保留 Outbox 等待修复",
      );
      throw new Error(delivery.routingError);
    }
    const content =
      delivery.finalAnswer?.trim() ||
      delivery.error?.trim() ||
      "子 Agent 在规定时间内未返回最终结果，本次调度已超时。";
    const options = {
      sourceAgentType: this.agentType,
      messageId: delivery.parentMessageId,
      metadata: { parent_run_id: delivery.runId, callback_timeout: true },
    };
    const metadata = options.metadata;
    if (content) {
      await this.#protocolEmitter.emitChunk(
        delivery.externalSessionId,
        delivery.traceId,
        { content, metadata },
        { ...options, eventType: EventType.ANSWER_DELTA },
      );
      await this.#protocolEmitter.emitChunk(
        delivery.externalSessionId,
        delivery.traceId,
        { content, metadata },
        { ...options, eventType: EventType.FINAL_ANSWER },
      );
    }
    await this.#protocolEmitter.emitChunk(
      delivery.externalSessionId,
      delivery.traceId,
      { content: "", metadata },
      { ...options, eventType: EventType.APP_STREAM_RESPONSE },
    );
    const execution = await this.#registry.getExecutionByMessageId(
      delivery.parentMessageId,
      delivery.externalSessionId,
    );
    if (execution?.execution_id) {
      const frameworkStatus =
        delivery.runStatus === "COMPLETED"
          ? AgentState.COMPLETED
          : delivery.runStatus === "CANCELLED"
            ? AgentState.CANCELLED
            : AgentState.FAILED;
      await this.#registry.markExecutionFinished(
        String(execution.execution_id),
        delivery.externalSessionId,
        frameworkStatus,
      );
    }
    await this.#timeoutDeliveries?.completeCallbackTimeoutDelivery?.({
      runId: delivery.runId,
      instanceId: this.workerId,
    });
  }
}
