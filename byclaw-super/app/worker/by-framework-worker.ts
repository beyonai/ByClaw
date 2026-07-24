import { hostname } from "node:os";
import type {
  CallerPrincipal,
  IngressSessionBindingRepository,
  RunEvent,
  RunService,
} from "@byclaw/by-conductor";
import {
  AgentState,
  AgentTaskResult,
  AskAgentCommand,
  CancelTaskCommand,
  EventType,
  GatewayWorker,
  ResumeCommand,
  WorkerRegistry,
  WorkerRunner,
  type AgentContext,
  type GatewayCommand,
  createRedis,
} from "@byclaw/by-framework";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import type { RunIngressService } from "../run-ingress-service.js";

type RedisClient = ReturnType<typeof createRedis>;
type WorkerRunService = Pick<RunService, "streamEvents" | "cancelRun">;
type WorkerRunIngress = Pick<
  RunIngressService,
  "createSessionRun" | "createRun" | "resolvePrincipal"
>;

export interface WorkerLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface ByClawSuperWorkerOptions {
  workerId: string;
  agentType: string;
  redis: RedisClient;
  registry?: WorkerRegistry;
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  sessionBindings?: IngressSessionBindingRepository;
  logger?: WorkerLogger;
}

/**
 * byclaw-super 的 by-framework 入站 Worker。
 * 它把 AskAgent 转为内部 Run，并把 Run 事件映射回 by-framework 流式协议。
 */
export class ByClawSuperGatewayWorker extends GatewayWorker {
  readonly #agentType: string;
  readonly #runService: WorkerRunService;
  readonly #runIngress: WorkerRunIngress;
  readonly #logger: WorkerLogger | undefined;
  readonly #sessionBindings: IngressSessionBindingRepository | undefined;
  readonly #activeRuns = new Map<string, string>();
  readonly #externalSessionBindings = new Map<string, string>();

  /** 注入共享 Redis、业务 Run 入口和日志实现。 */
  constructor(options: ByClawSuperWorkerOptions) {
    const registry = options.registry ?? new WorkerRegistry(options.redis);
    super(options.workerId, registry, options.redis);
    this.#agentType = options.agentType;
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#logger = options.logger;
    this.#sessionBindings = options.sessionBindings;
  }

  /** 声明当前 Worker 可处理的逻辑 Agent 类型，供 by-framework 注册和路由。 */
  getAgentTypes(): ReadonlyArray<string> {
    return [this.#agentType];
  }

  /**
   * 处理 AskAgent 与子 Agent 回调 Resume。
   * Resume 不创建新 Run，只完成回调会话，让 Connector 能收到终止事件。
   */
  async processCommand(command: GatewayCommand, context: AgentContext): Promise<AgentTaskResult> {
    if (command instanceof ResumeCommand) {
      this.#logger?.info(
        commandLogFields(command),
        "收到子 Agent Resume 回调",
      );
      return new AgentTaskResult({
        status: AgentState.COMPLETED,
        content: "",
        replyData: null,
      });
    }
    if (!(command instanceof AskAgentCommand)) {
      throw new Error(`Unsupported by-framework command: ${command.actionType}`);
    }

    const message = extractMessage(command.content);
    if (!message) {
      throw new Error("AskAgent content must contain a non-empty message");
    }
    const beyondToken = commandString(command, "Beyond-Token");
    if (!beyondToken) {
      throw new BeyondTokenAuthError("Beyond-Token metadata is required");
    }
    const systemCode = commandString(command, "System-Code");

    await context.checkCancelled();
    this.#logger?.info(commandLogFields(command), "开始处理 by-framework 入站任务");
    const auth = {
      beyondToken,
      ...(systemCode ? { systemCode } : {}),
    };
    const principal = await this.#runIngress.resolvePrincipal(auth);
    const bindingKey = externalSessionBindingKey(principal, command.header.sessionId);
    const sessionId = this.#sessionBindings
      ? await this.#sessionBindings.get({
          source: "by-framework",
          userCode: principal.userCode,
          externalSessionId: command.header.sessionId,
        })
      : this.#externalSessionBindings.get(bindingKey);
    const run = sessionId
      ? await this.#runIngress.createRun({ sessionId, message, ...auth })
      : await this.#runIngress.createSessionRun({ message, ...auth });
    if (this.#sessionBindings) {
      await this.#sessionBindings.bind({
        source: "by-framework",
        userCode: principal.userCode,
        externalSessionId: command.header.sessionId,
        sessionId: run.sessionId,
        now: Date.now(),
      });
    } else {
      this.#externalSessionBindings.set(bindingKey, run.sessionId);
    }
    this.#activeRuns.set(command.header.messageId, run.id);
    this.#logger?.info(
      { ...commandLogFields(command), runId: run.id },
      "by-framework 入站任务已创建 Run",
    );

    try {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }
      return await this.#forwardRunEvents(run.id, context);
    } finally {
      this.#activeRuns.delete(command.header.messageId);
    }
  }

  /** 将 by-framework 的取消控制消息映射到正在执行的内部 Run。 */
  async onCancelTask(command: unknown): Promise<void> {
    if (!(command instanceof CancelTaskCommand)) {
      return;
    }
    const runId = this.#activeRuns.get(command.targetMessageId);
    if (!runId) {
      this.#logger?.warn(
        { targetMessageId: command.targetMessageId },
        "取消请求未找到活动 Run",
      );
      return;
    }
    this.#logger?.info(
      { targetMessageId: command.targetMessageId, runId },
      "正在取消 by-framework 入站 Run",
    );
    await this.#runService.cancelRun(runId, command.reason || "by-framework task cancelled");
  }

  /** 订阅内部事件流，并只输出简化进度与 Leader 最终回答。 */
  async #forwardRunEvents(runId: string, context: AgentContext): Promise<AgentTaskResult> {
    let reasoningStarted = false;
    let reasoningEnded = false;
    let answer = "";

    for await (const event of this.#runService.streamEvents(runId)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(runId, "by-framework task cancelled");
        await context.checkCancelled();
      }

      const progress = progressMessage(event);
      if (progress) {
        if (!reasoningStarted || reasoningEnded) {
          await context.emitState("", EventType.REASONING_LOG_START);
          reasoningStarted = true;
          reasoningEnded = false;
        }
        await context.emitState(progress, EventType.REASONING_LOG_DELTA);
      }

      if (event.type === "leader.delta") {
        if (reasoningStarted && !reasoningEnded) {
          await context.emitState("", EventType.REASONING_LOG_END);
          reasoningEnded = true;
        }
        const delta = stringData(event.data.text);
        if (delta) {
          answer += delta;
          await context.emitChunk(delta, EventType.ANSWER_DELTA);
        }
      }

      if (event.type === "run.completed") {
        const finalAnswer = stringData(event.data.finalAnswer);
        if (!answer && finalAnswer) {
          answer = finalAnswer;
          await context.emitChunk(finalAnswer, EventType.ANSWER_DELTA);
        }
        await closeReasoning(context, reasoningStarted, reasoningEnded);
        return new AgentTaskResult({
          status: AgentState.COMPLETED,
          content: answer || finalAnswer,
          replyData: { runId },
        });
      }

      if (event.type === "run.cancelled") {
        await closeReasoning(context, reasoningStarted, reasoningEnded);
        await context.checkCancelled();
        return new AgentTaskResult({
          status: AgentState.CANCELLED,
          content: "",
          replyData: { runId, reason: stringData(event.data.reason) || "run cancelled" },
        });
      }

      if (event.type === "run.failed") {
        await closeReasoning(context, reasoningStarted, reasoningEnded);
        throw new Error(stringData(event.data.error) || "Run failed");
      }
    }

    throw new Error(`Run event stream ended without a terminal event: ${runId}`);
  }
}

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

  /** 查询当前 Worker 是否仍持有在线租约，供 /ready 聚合。 */
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

/** 从 AskAgent 的多种内容表示中提取最后一条非空用户文本。 */
function extractMessage(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const message = extractMessage(content[index]);
      if (message) {
        return message;
      }
    }
    return "";
  }
  if (!isRecord(content)) {
    return "";
  }
  if (typeof content.text === "string") {
    return content.text.trim();
  }
  return extractMessage(content.content);
}

/** 按大小写不敏感方式从 command metadata 或 extraPayload 读取字符串字段。 */
function commandString(command: AskAgentCommand, key: string): string {
  return (
    recordString(command.header.metadata, key) ||
    recordString(command.extraPayload, key)
  );
}

/** 从记录中读取大小写不敏感的非空字符串值。 */
function recordString(record: Readonly<Record<string, unknown>>, key: string): string {
  const expected = key.toLowerCase();
  for (const [candidate, value] of Object.entries(record)) {
    if (candidate.toLowerCase() === expected && typeof value === "string") {
      return value.trim();
    }
  }
  return "";
}

/** 关闭尚未结束的简化思考阶段，且不透传 Pi 或 OpenClaw 原始 reasoning。 */
async function closeReasoning(
  context: AgentContext,
  started: boolean,
  ended: boolean,
): Promise<void> {
  if (started && !ended) {
    await context.emitState("", EventType.REASONING_LOG_END);
  }
}

/** 将内部事件转换为对调用方安全、稳定的中文执行进度。 */
function progressMessage(event: RunEvent): string {
  if (event.type === "run.created") {
    return "任务已创建";
  }
  if (event.type === "run.attempt") {
    return Number(event.data.attemptNo) > 1
      ? "任务已由其他实例恢复执行"
      : "任务开始执行";
  }
  if (event.type === "run.status") {
    return runStatusMessage(stringData(event.data.status));
  }
  if (event.type === "delegation.started") {
    return `正在调用 ${stringData(event.data.agentName) || stringData(event.data.agentId) || "Agent"}`;
  }
  if (event.type === "delegation.progress") {
    return stringData(event.data.message);
  }
  if (event.type === "delegation.completed") {
    return `Agent ${stringData(event.data.agentId) || ""} 已完成`.trim();
  }
  if (event.type === "delegation.failed") {
    return `Agent ${stringData(event.data.agentId) || ""} 执行失败`.trim();
  }
  return "";
}

/** 将内部 Run 状态映射为面向用户的进度描述。 */
function runStatusMessage(status: string): string {
  switch (status) {
    case "QUEUED":
      return "任务已进入队列";
    case "RUNNING":
      return "正在理解任务";
    case "WAITING_AGENT":
      return "正在等待 Agent 执行";
    case "SYNTHESIZING":
      return "正在汇总 Agent 结果";
    case "CANCELLING":
      return "正在取消任务";
    default:
      return "";
  }
}

/** 从 RunEvent JSON 字段中安全读取字符串。 */
function stringData(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 生成同一主机内稳定且便于定位的默认 Worker 实例 ID。 */
function defaultWorkerId(): string {
  const host = hostname().trim().replace(/[^a-zA-Z0-9_.-]/g, "-") || "unknown-host";
  return `byclaw-super-${host}`;
}

/** 构造不包含消息正文和凭证的结构化日志字段。 */
function commandLogFields(command: GatewayCommand): Record<string, unknown> {
  return {
    messageId: command.header.messageId,
    sessionId: command.header.sessionId,
    traceId: command.header.traceId,
    sourceAgentType: command.header.sourceAgentType,
  };
}

/** 外部 sessionId 在验签 userCode 内绑定，避免不同用户发生碰撞。 */
function externalSessionBindingKey(
  principal: CallerPrincipal,
  externalSessionId: string,
): string {
  return JSON.stringify([
    principal.userCode,
    externalSessionId,
  ]);
}

/** 判断未知值是否为可安全读取字段的对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把未知异常统一转换为 Error，便于日志和健康检查使用。 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 非阻塞等待一次短轮询间隔。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
