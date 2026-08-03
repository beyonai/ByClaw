import {
  type CallerPrincipal,
  type IngressSessionBindingRepository,
  type RunEvent,
  type RunService,
} from "@byclaw/by-conductor";
import {
  AgentState,
  AgentTaskResult,
  AskAgentCommand,
  CancelTaskCommand,
  EventType,
  GatewayDataEmitter,
  GatewayWorker,
  ResumeCommand,
  SseReasonMessageType,
  WorkerRegistry,
  WorkerRunner,
  type AgentContext,
  type GatewayCommand,
  createRedis,
} from "@byclaw/by-framework";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import type { RunIngressService } from "../ingress/run-ingress-service.js";
import {
  commandGroupChatRef,
  commandLogFields,
  commandSessionContext,
  commandSourceAgentId,
  commandString,
  commandThinkingLevel,
  defaultWorkerId,
  delay,
  externalSessionBindingKey,
  extractMessage,
  extractUserInput,
  isDelegationReasoningEvent,
  progressMessage,
  protocolMessage,
  recordString,
  recordValue,
  stringData,
  toError,
} from "./by-framework-protocol.js";
import { truncateForLog } from "../log-format.js";

type RedisClient = ReturnType<typeof createRedis>;
type WorkerRunService = Pick<
  RunService,
  "streamEvents" | "cancelRun" | "respondToInteraction"
>;
type WorkerProtocolEmitter = Pick<GatewayDataEmitter, "emitChunk" | "emitEvent">;
type WorkerRunIngress = Pick<
  RunIngressService,
  "createSessionRun" | "createRun" | "resolvePrincipal" | "authorizeRun"
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
  protocolEmitter?: WorkerProtocolEmitter;
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
  readonly #protocolEmitter: WorkerProtocolEmitter;
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
    this.#protocolEmitter =
      options.protocolEmitter ?? new GatewayDataEmitter(options.redis);
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
      const interactionId = recordString(command.header.metadata, "interaction_id");
      const runId = recordString(command.header.metadata, "parent_run_id");
      if (interactionId && runId) {
        const beyondToken = commandString(command, "Beyond-Token");
        if (!beyondToken) {
          throw new BeyondTokenAuthError("Beyond-Token metadata is required");
        }
        const systemCode = commandString(command, "System-Code");
        const authorized = await this.#runIngress.authorizeRun(runId, {
          beyondToken,
          ...(systemCode ? { systemCode } : {}),
        });
        if (authorized.run.id !== runId) {
          throw new Error(`Authorized Run does not match Resume target: ${runId}`);
        }
        await this.#runService.respondToInteraction(runId, interactionId, {
          action: "submit",
          text: extractMessage(command.content),
        });
        // 这是对既有 Run 的辅助输入，不是一个新的聊天终态。标记当前 Resume
        // context 已收尾，避免 by-framework 自动发送 APP_STREAM_RESPONSE 提前关闭共享流。
        context.setStreamFinished(true);
        this.#logger?.info(
          { ...commandLogFields(command), runId, interactionId },
          "已恢复用户交互",
        );
        return new AgentTaskResult({
          status: AgentState.COMPLETED,
          content: "",
          replyData: null,
        });
      }
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

    const { message, attachments } = extractUserInput(command.content);
    const beyondToken = commandString(command, "Beyond-Token");
    if (!beyondToken) {
      throw new BeyondTokenAuthError("Beyond-Token metadata is required");
    }
    const systemCode = commandString(command, "System-Code");
    const thinkingLevel = commandThinkingLevel(command);
    const groupChatRef = commandGroupChatRef(command);
    const sessionContext = commandSessionContext(command);

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
    const sourceAgentId = commandSourceAgentId(command);
    const run = sessionId
      ? await this.#runIngress.createRun({
          sessionId,
          message,
          thinkingLevel,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(sourceAgentId ? { sourceAgentId } : {}),
          ...(command.header.sessionId
            ? { externalSessionId: command.header.sessionId }
            : {}),
          ...(groupChatRef ? { groupChatRef } : {}),
          ...auth,
        })
      : await this.#runIngress.createSessionRun({
          message,
          thinkingLevel,
          ...(sessionContext ? { context: sessionContext } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(sourceAgentId ? { sourceAgentId } : {}),
          ...(command.header.sessionId
            ? { externalSessionId: command.header.sessionId }
            : {}),
          ...(groupChatRef ? { groupChatRef } : {}),
          ...auth,
        });
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
      return await this.#forwardRunEvents(run, principal, context);
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

  /** 订阅内部事件流，并只输出简化进度与 Leader 最终回答；终态时记录一条业务返回日志。 */
  async #forwardRunEvents(
    run: { id: string; sessionId: string; createdAt: number },
    principal: CallerPrincipal,
    context: AgentContext,
  ): Promise<AgentTaskResult> {
    let reasoningStarted = false;
    let reasoningEnded = false;
    let answer = "";
    const reasoningMessageId = `${run.id}:reasoning`;

    for await (const event of this.#runService.streamEvents(run.id)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }

      if (
        isDelegationReasoningEvent(event) &&
        (!reasoningStarted || reasoningEnded)
      ) {
        await this.#emitReasoning(
          run.id,
          context,
          reasoningMessageId,
          "",
          EventType.REASONING_LOG_START,
        );
        reasoningStarted = true;
        reasoningEnded = false;
      }
      await this.#forwardDelegationEvent(event, context);
      await this.#forwardInteractionEvent(event, context);

      const progress = progressMessage(event);
      if (progress) {
        if (!reasoningStarted || reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_START,
          );
          reasoningStarted = true;
          reasoningEnded = false;
        }
        await this.#emitReasoning(
          run.id,
          context,
          reasoningMessageId,
          progress,
          EventType.REASONING_LOG_DELTA,
        );
      }

      if (event.type === "leader.delta") {
        if (reasoningStarted && !reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
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
        if (reasoningStarted && !reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
        }
        this.#logRunFinished(principal, run, "completed", run.createdAt, finalAnswer);
        return new AgentTaskResult({
          status: AgentState.COMPLETED,
          content: answer || finalAnswer,
          replyData: { runId: run.id },
        });
      }

      if (event.type === "run.cancelled") {
        if (reasoningStarted && !reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
        }
        await context.checkCancelled();
        const reason = stringData(event.data.reason) || "run cancelled";
        this.#logRunFinished(principal, run, "cancelled", run.createdAt, reason);
        return new AgentTaskResult({
          status: AgentState.CANCELLED,
          content: "",
          replyData: { runId: run.id, reason },
        });
      }

      if (event.type === "run.failed") {
        if (reasoningStarted && !reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
        }
        const error = stringData(event.data.error) || "Run failed";
        this.#logRunFinished(principal, run, "failed", run.createdAt, error);
        throw new Error(error);
      }
    }

    throw new Error(`Run event stream ended without a terminal event: ${run.id}`);
  }

  /** 按 byai-channel 的协议把普通文本放入前端思考区，而不是作为 3003 标题原样展示。 */
  async #emitReasoning(
    runId: string,
    context: AgentContext,
    messageId: string,
    content: string,
    eventType: EventType,
  ): Promise<void> {
    await this.#protocolEmitter.emitChunk(
      context.sessionId,
      context.traceId,
      content,
      {
        eventType,
        contentType: SseReasonMessageType.think_text,
        sourceAgentType: this.#agentType,
        messageId,
        parentMessageId: "-1",
        metadata: { parent_run_id: runId },
      },
    );
  }

  /** 记录 Run 终态，便于在日志中追踪“谁、返回什么、会话维度”。不记录 Token 与凭证。 */
  #logRunFinished(
    principal: CallerPrincipal,
    run: { id: string; sessionId: string },
    status: "completed" | "cancelled" | "failed",
    startedAt: number,
    payload: string,
  ): void {
    const detailField =
      status === "completed"
        ? { finalAnswer: truncateForLog(payload, 200) }
        : status === "failed"
          ? { error: truncateForLog(payload, 200) }
          : { reason: truncateForLog(payload, 200) };
    this.#logger?.info(
      {
        userCode: principal.userCode,
        ...(principal.userName ? { userName: principal.userName } : {}),
        sessionId: run.sessionId,
        runId: run.id,
        status,
        durationMs: Date.now() - startedAt,
        ...detailField,
      },
      "Run 结束",
    );
  }

  /**
   * 把已持久化的 Delegation 事件映射为前端现有的思考树协议：
   * Agent 调用是 3009 状态节点，子 Agent 正文是挂在该节点下的 1002 文本。
   */
  async #forwardDelegationEvent(
    event: RunEvent,
    context: AgentContext,
  ): Promise<void> {
    if (event.type === "delegation.started") {
      await this.#emitDelegationStatus(event, context, "_START_");
      return;
    }
    if (event.type === "delegation.output.delta") {
      const text = stringData(event.data.text);
      if (text) {
        await this.#emitDelegationOutput(event, context, text);
      }
      return;
    }
    if (event.type === "delegation.completed") {
      await this.#emitDelegationStatus(event, context, "_DONE_");
      return;
    }
    if (event.type === "delegation.failed") {
      await this.#emitDelegationStatus(event, context, "_ERROR_");
    }
  }

  /** 将统一交互事件输出为 3013 表单或 2010 PAGE 数字员工卡片。 */
  async #forwardInteractionEvent(
    event: RunEvent,
    context: AgentContext,
  ): Promise<void> {
    if (event.type !== "interaction.requested") {
      return;
    }
    const interactionId = stringData(event.data.interactionId);
    const request = recordValue(event.data.request);
    const externalPage = stringData(request?.kind) === "external_page";
    const uiPayload =
      recordValue(request?.uiPayload) ?? {
        formStatus: 0,
        pluginMachineFields: [],
      };
    const delegationId = stringData(event.data.delegationId);
    const content = JSON.stringify(uiPayload);
    const eventType = externalPage
      ? EventType.ANSWER_DELTA
      : EventType.REASONING_LOG_DELTA;
    const contentType = externalPage ? "2010" : "3013";
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType,
      sourceAgentType: this.#agentType,
      messageId: interactionId,
      parentMessageId: delegationId || "-1",
      data: protocolMessage({
        event: eventType,
        content,
        contentType,
        orderId: interactionId,
        parentOrderId: delegationId || "-1",
        agentId: externalPage
          ? stringData(uiPayload.agentId)
          : "",
        agentName: externalPage
          ? stringData(uiPayload.agentName)
          : "",
      }),
      metadata: {
        parent_run_id: event.runId,
        interaction_id: interactionId,
        ...(delegationId ? { delegation_id: delegationId } : {}),
      },
    });
  }

  /** 输出可由前端按同一 orderId 原位更新的 Agent 调用状态节点。 */
  async #emitDelegationStatus(
    event: RunEvent,
    context: AgentContext,
    status: "_START_" | "_DONE_" | "_ERROR_",
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const agentId = stringData(event.data.agentId);
    const agentName = stringData(event.data.agentName);
    const content = `正在调用 Agent：${agentName || agentId || "Agent"}`;
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: delegationId,
      parentMessageId: "-1",
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content,
        contentType: "3009",
        orderId: delegationId,
        parentOrderId: "-1",
        agentId,
        agentName,
        objectType: "tool_call",
        status,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
      },
    });
  }

  /** 原样输出子 Agent 正文，并用 parentOrderId 挂到对应 Agent 调用节点。 */
  async #emitDelegationOutput(
    event: RunEvent,
    context: AgentContext,
    text: string,
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const agentId = stringData(event.data.agentId);
    const agentName = stringData(event.data.agentName);
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: `${delegationId}:output`,
      parentMessageId: delegationId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: text,
        contentType: "1002",
        orderId: `${delegationId}:output`,
        parentOrderId: delegationId,
        agentId,
        agentName,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
      },
    });
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
