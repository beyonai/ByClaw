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
  agentReadyTitle,
  commandAgentName,
  commandGroupChatRef,
  commandLogFields,
  commandOrchestratorRef,
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
  orchestratorBindingSessionId,
  progressMessage,
  protocolMessage,
  recordString,
  recordValue,
  stringData,
  toError,
} from "./by-framework-protocol.js";
import { truncateForLog } from "../log-format.js";

export type RedisClient = ReturnType<typeof createRedis>;
export type WorkerRunService = Pick<
  RunService,
  "streamEvents" | "cancelRun" | "respondToInteraction"
>;
type WorkerProtocolEmitter = Pick<GatewayDataEmitter, "emitChunk" | "emitEvent">;
export type WorkerRunIngress = Pick<
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
 * 2020 的 json 字段本身就是待展示的字符串。对象需要序列化，字符串则应直接输出；
 * 对历史链路中已经 JSON 编码过一到两次的字符串做有限解包，避免前端看到成片反斜杠。
 */
function normalizeDisplayValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? null;
  }

  let current = value;
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const parsed: unknown = JSON.parse(current);
      if (typeof parsed === "string") {
        if (parsed === current) {
          return current;
        }
        current = parsed;
        continue;
      }
      return parsed;
    } catch {
      return current;
    }
  }
  return current;
}

function formatDetailJson(value: unknown): string {
  const normalized = normalizeDisplayValue(value);
  return typeof normalized === "string" ? normalized : JSON.stringify(normalized, null, 2);
}

type DelegationToolCardState = {
  title: string;
  description: string;
  input?: unknown;
  output?: unknown;
};

function toolCardTitle(toolName: string, upstreamTitle: string): string {
  if (/^\s*加载技能\s*[:：]/u.test(upstreamTitle)) {
    return "Skill";
  }
  const stripped = upstreamTitle
    .replace(/^\s*(?:调用工具|工具调用|tool call)\s*[:：]?\s*/iu, "")
    .trim();
  const candidate = toolName !== "工具" ? toolName : stripped || upstreamTitle || "Tool";
  return /^[a-z]/u.test(candidate)
    ? `${candidate.charAt(0).toUpperCase()}${candidate.slice(1)}`
    : candidate;
}

function toolCardDescription(fallback: string, input: unknown, output: unknown): string {
  const inputRecord = recordValue(input);
  for (const key of ["description", "file_path", "path", "command", "skill", "name"]) {
    const value = stringData(inputRecord?.[key]);
    if (value) {
      return value;
    }
  }
  if (typeof output === "string") {
    const skill = output.match(/^Launching skill:\s*(.+)$/imu)?.[1]?.trim();
    if (skill) {
      return skill;
    }
  }
  return fallback;
}

/**
 * byclaw-super 的 by-framework 入站 Worker。
 * 它把 AskAgent 转为内部 Run，并把 Run 事件映射回 by-framework 流式协议。
 */
export class ByClawSuperGatewayWorker extends GatewayWorker {
  readonly #agentType: string;
  readonly #registry: WorkerRegistry;
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
    this.#registry = registry;
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#protocolEmitter = options.protocolEmitter ?? new GatewayDataEmitter(options.redis);
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
    context.callAgent
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
      this.#logger?.info(commandLogFields(command), "收到子 Agent Resume 回调");
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
    const orchestrator = commandOrchestratorRef(command);
    const sessionContext = commandSessionContext(command);
    const agentName = commandAgentName(command) || "超级助手";

    await context.checkCancelled();
    this.#logger?.info(commandLogFields(command), "开始处理 by-framework 入站任务");
    const auth = {
      beyondToken,
      ...(systemCode ? { systemCode } : {}),
    };
    const metadata = { ...command.header.metadata };
    const principal = await this.#runIngress.resolvePrincipal(auth);
    const bindingExternalSessionId = orchestratorBindingSessionId(
      command.header.sessionId,
      orchestrator,
    );
    const bindingKey = externalSessionBindingKey(principal, bindingExternalSessionId);
    const sessionId = this.#sessionBindings
      ? await this.#sessionBindings.get({
          source: "by-framework",
          userCode: principal.userCode,
          externalSessionId: bindingExternalSessionId,
        })
      : this.#externalSessionBindings.get(bindingKey);
    const sourceAgentId = commandSourceAgentId(command) || orchestrator?.id || "";
    const run = sessionId
      ? await this.#runIngress.createRun({
          sessionId,
          message,
          thinkingLevel,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(sourceAgentId ? { sourceAgentId } : {}),
          ...(command.header.sessionId ? { externalSessionId: command.header.sessionId } : {}),
          parentMessageId: command.header.messageId,
          metadata,
          ...(groupChatRef ? { groupChatRef } : {}),
          ...(orchestrator ? { orchestrator } : {}),
          ...auth,
        })
      : await this.#runIngress.createSessionRun({
          message,
          thinkingLevel,
          ...(sessionContext ? { context: sessionContext } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(sourceAgentId ? { sourceAgentId } : {}),
          ...(command.header.sessionId ? { externalSessionId: command.header.sessionId } : {}),
          parentMessageId: command.header.messageId,
          metadata,
          ...(groupChatRef ? { groupChatRef } : {}),
          ...(orchestrator ? { orchestrator } : {}),
          ...auth,
        });
    if (this.#sessionBindings) {
      await this.#sessionBindings.bind({
        source: "by-framework",
        userCode: principal.userCode,
        externalSessionId: bindingExternalSessionId,
        sessionId: run.sessionId,
        now: Date.now(),
      });
    } else {
      this.#externalSessionBindings.set(bindingKey, run.sessionId);
    }
    this.#activeRuns.set(command.header.messageId, run.id);
    if (context.executionId) {
      this.#activeRuns.set(context.executionId, run.id);
    }
    const stopCancellationMonitor = this.#monitorPersistedCancellation(command, context, run.id);
    this.#logger?.info(
      { ...commandLogFields(command), runId: run.id },
      "by-framework 入站任务已创建 Run",
    );

    try {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }
      return await this.#forwardRunEvents(
        run,
        principal,
        context,
        agentName,
        sessionContext?.locale,
      );
    } finally {
      stopCancellationMonitor();
      this.#activeRuns.delete(command.header.messageId);
      if (context.executionId) {
        this.#activeRuns.delete(context.executionId);
      }
    }
  }

  /** 将 by-framework 的取消控制消息映射到正在执行的内部 Run。 */
  async onCancelTask(command: unknown): Promise<void> {
    if (!(command instanceof CancelTaskCommand)) {
      return;
    }
    const runId =
      this.#activeRuns.get(command.targetMessageId) ||
      this.#activeRuns.get(command.targetExecutionId);
    if (!runId) {
      this.#logger?.warn({ targetMessageId: command.targetMessageId }, "取消请求未找到活动 Run");
      return;
    }
    this.#logger?.info(
      { targetMessageId: command.targetMessageId, runId },
      "正在取消 by-framework 入站 Run",
    );
    await this.#runService.cancelRun(runId, command.reason || "by-framework task cancelled");
  }

  /**
   * 兜底 claim 与 cancel 并发窗口：取消方可能在 Worker 写入 worker_id 前只把
   * execution 标记为 cancel_requested，因而没有控制消息能触发 onCancelTask。
   * 运行期间轮询同一 execution 真相，确保这种取消也能进入内部 RunService。
   */
  #monitorPersistedCancellation(
    command: GatewayCommand,
    context: AgentContext,
    runId: string,
  ): () => void {
    let stopped = false;
    let checking = false;
    let cancellationForwarded = false;
    let warned = false;
    const check = async () => {
      if (stopped || checking || cancellationForwarded) {
        return;
      }
      checking = true;
      try {
        const execution = await this.#registry.getExecutionByMessageId(
          command.header.messageId,
          command.header.sessionId,
        );
        warned = false;
        if (stopped) {
          return;
        }
        const status = String(execution?.status ?? "").toUpperCase();
        const persistedCancelRequested = String(execution?.cancel_requested ?? "").toLowerCase();
        const cancelRequested =
          context.isCancelRequested() ||
          execution?.cancel_requested === true ||
          persistedCancelRequested === "true" ||
          persistedCancelRequested === "1" ||
          status === "CANCELLING" ||
          status === "CANCELLED";
        if (!cancelRequested) {
          return;
        }
        const reason =
          typeof execution?.cancel_reason === "string" && execution.cancel_reason.trim()
            ? execution.cancel_reason
            : "by-framework task cancelled";
        this.#logger?.info(
          {
            runId,
            messageId: command.header.messageId,
            executionId: context.executionId,
            status,
          },
          "检测到 by-framework 持久取消状态",
        );
        await this.#runService.cancelRun(runId, reason);
        cancellationForwarded = true;
      } catch (error) {
        if (!stopped && !warned) {
          warned = true;
          this.#logger?.warn(
            {
              runId,
              messageId: command.header.messageId,
              error: toError(error).message,
            },
            "同步 by-framework 持久取消状态失败",
          );
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => {
      void check();
    }, 100);
    timer.unref?.();
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  /** 订阅内部事件流，并只输出简化进度与 Leader 最终回答；终态时记录一条业务返回日志。 */
  async #forwardRunEvents(
    run: { id: string; sessionId: string; createdAt: number },
    principal: CallerPrincipal,
    context: AgentContext,
    agentName: string,
    locale?: string,
  ): Promise<AgentTaskResult> {
    let reasoningStarted = false;
    let reasoningEnded = false;
    let answer = "";
    const reasoningMessageId = `${run.id}:reasoning`;
    const delegationToolCards = new Map<string, DelegationToolCardState>();

    // 按 byai-channel 协议：未开启或已收尾时先补一条思考开始帧，再写增量。
    const ensureReasoningOpen = async () => {
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
    };

    await this.#emitReadyTitle(run.id, context, agentName, locale);

    for await (const event of this.#runService.streamEvents(run.id)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }

      if (isDelegationReasoningEvent(event)) {
        await ensureReasoningOpen();
      }
      await this.#forwardDelegationEvent(event, context, delegationToolCards);
      await this.#forwardInteractionEvent(event, context);

      const progress = progressMessage(event);
      if (progress) {
        await ensureReasoningOpen();
        await this.#emitReasoning(
          run.id,
          context,
          reasoningMessageId,
          progress,
          EventType.REASONING_LOG_DELTA,
        );
      }

      if (event.type === "leader.reasoning.delta") {
        await ensureReasoningOpen();
        const delta = stringData(event.data.text);
        if (delta) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            delta,
            EventType.REASONING_LOG_DELTA,
          );
        }
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
        const userMessage = stringData(event.data.userMessage);
        if (userMessage) {
          await context.emitChunk(userMessage, EventType.ANSWER_DELTA);
          return new AgentTaskResult({
            status: AgentState.COMPLETED,
            content: userMessage,
            replyData: { runId: run.id },
          });
        }
        throw new Error(error);
      }
    }

    throw new Error(`Run event stream ended without a terminal event: ${run.id}`);
  }

  /** 在 Run 开始时输出与 byai-channel 相同的“智能体已就绪”思考标题。 */
  async #emitReadyTitle(
    runId: string,
    context: AgentContext,
    agentName: string,
    locale?: string,
  ): Promise<void> {
    await this.#protocolEmitter.emitChunk(
      context.sessionId,
      context.traceId,
      agentReadyTitle(agentName, locale),
      {
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: SseReasonMessageType.think_title,
        sourceAgentType: this.#agentType,
        messageId: `${runId}:ready`,
        parentMessageId: "-1",
        metadata: { parent_run_id: runId },
      },
    );
  }

  /** 按 byai-channel 的协议把普通文本放入前端思考区，而不是作为 3003 标题原样展示。 */
  async #emitReasoning(
    runId: string,
    context: AgentContext,
    messageId: string,
    content: string,
    eventType: EventType,
  ): Promise<void> {
    await this.#protocolEmitter.emitChunk(context.sessionId, context.traceId, content, {
      eventType,
      contentType: SseReasonMessageType.think_text,
      sourceAgentType: this.#agentType,
      messageId,
      parentMessageId: "-1",
      metadata: { parent_run_id: runId },
    });
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
   * Agent 调用是 3009 根节点，过程、工具和正文按 parentOrderId 组成它的子树。
   */
  async #forwardDelegationEvent(
    event: RunEvent,
    context: AgentContext,
    toolCards: Map<string, DelegationToolCardState>,
  ): Promise<void> {
    if (event.type === "delegation.started") {
      await this.#emitDelegationStatus(event, context, "_START_");
      await this.#emitDelegationDetail(event, context, "start");
      return;
    }
    if (event.type === "delegation.display.progress") {
      await this.#emitDelegationProgress(event, context);
      return;
    }
    if (event.type === "delegation.tool.started") {
      await this.#emitDelegationToolCard(event, context, "_START_", toolCards, {
        ...(event.data.input !== undefined ? { input: event.data.input } : {}),
      });
      return;
    }
    if (event.type === "delegation.tool.detail") {
      const phase = stringData(event.data.phase);
      if (phase === "input" || phase === "output") {
        await this.#emitDelegationToolCard(event, context, "_START_", toolCards, {
          [phase]: event.data.value,
        });
      }
      return;
    }
    if (event.type === "delegation.tool.completed") {
      await this.#emitDelegationToolCard(event, context, "_DONE_", toolCards, {
        ...(event.data.output !== undefined ? { output: event.data.output } : {}),
      });
      return;
    }
    if (event.type === "delegation.tool.failed") {
      const error = stringData(event.data.error) || "工具调用失败";
      await this.#emitDelegationToolCard(event, context, "_ERROR_", toolCards, {
        output:
          event.data.output !== undefined
            ? { output: normalizeDisplayValue(event.data.output), error, errorDetail: error }
            : { error, errorDetail: error },
      });
      return;
    }
    if (event.type === "delegation.output.delta") {
      const text = stringData(event.data.text);
      if (text) {
        await this.#emitDelegationAnswerStatus(event, context, "_START_");
        await this.#emitDelegationOutput(event, context, text);
      }
      return;
    }
    if (event.type === "delegation.completed") {
      if (event.data.hasOutput === true) {
        await this.#emitDelegationAnswerStatus(event, context, "_DONE_");
      }
      await this.#emitDelegationStatus(event, context, "_DONE_");
      await this.#emitDelegationDetail(event, context, "result");
      return;
    }
    if (event.type === "delegation.failed") {
      await this.#emitDelegationStatus(event, context, "_ERROR_");
      await this.#emitDelegationDetail(event, context, "result");
    }
  }

  /** 子 Agent 正文使用委派根节点下的独立状态节点。 */
  async #emitDelegationAnswerStatus(
    event: RunEvent,
    context: AgentContext,
    status: "_START_" | "_DONE_",
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const orderId = `${delegationId}:answer`;
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: orderId,
      parentMessageId: delegationId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: "数字员工输出",
        contentType: "3009",
        orderId,
        parentOrderId: delegationId,
        status,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
      },
    });
  }

  /** 将子 Agent 可展示过程挂在委派根节点下。 */
  async #emitDelegationProgress(event: RunEvent, context: AgentContext): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    const text = stringData(event.data.text);
    if (!delegationId || !text) {
      return;
    }
    const orderId = `${delegationId}:progress`;
    const parentOrderId = delegationId;
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: orderId,
      parentMessageId: parentOrderId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: text,
        contentType: SseReasonMessageType.think_text,
        orderId,
        parentOrderId,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
      },
    });
  }

  /** 复用 Byclaw-code 的 3015 工具卡片协议，并以同一 orderId 原位更新 Input/Output。 */
  async #emitDelegationToolCard(
    event: RunEvent,
    context: AgentContext,
    status: "_START_" | "_DONE_" | "_ERROR_",
    toolCards: Map<string, DelegationToolCardState>,
    patch: { input?: unknown; output?: unknown },
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    const callId = stringData(event.data.callId);
    if (!delegationId || !callId) {
      return;
    }
    const toolName = stringData(event.data.toolName) || "工具";
    const upstreamTitle = stringData(event.data.title);
    const title = upstreamTitle || `调用工具：${toolName}`;
    const orderId = `${delegationId}:tool:${callId}`;
    const existing = toolCards.get(orderId);
    const input =
      patch.input !== undefined
        ? normalizeDisplayValue(patch.input)
        : existing?.input;
    const output =
      patch.output !== undefined
        ? normalizeDisplayValue(patch.output)
        : existing?.output;
    const card: DelegationToolCardState = {
      title: existing?.title || toolCardTitle(toolName, upstreamTitle),
      description: toolCardDescription(title, input, output),
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
    };
    toolCards.set(orderId, card);
    const content = JSON.stringify({
      title: card.title,
      ...(card.input !== undefined ? { input: card.input } : {}),
      ...(card.output !== undefined ? { output: card.output } : {}),
      status,
      description: card.description,
    });
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId: orderId,
      parentMessageId: delegationId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content,
        contentType: "3015",
        orderId,
        parentOrderId: delegationId,
        ...(stringData(event.data.agentId) ? { agentId: stringData(event.data.agentId) } : {}),
        objectType: "tool_call",
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        child_call_id: callId,
      },
    });
  }

  /** 将统一交互事件输出为 3013 表单或 2010 PAGE 数字员工卡片。 */
  async #forwardInteractionEvent(event: RunEvent, context: AgentContext): Promise<void> {
    if (event.type !== "interaction.requested") {
      return;
    }
    const interactionId = stringData(event.data.interactionId);
    const request = recordValue(event.data.request);
    const externalPage = stringData(request?.kind) === "external_page";
    const uiPayload = recordValue(request?.uiPayload) ?? {
      formStatus: 0,
      pluginMachineFields: [],
    };
    const delegationId = stringData(event.data.delegationId);
    const content = JSON.stringify(uiPayload);
    const eventType = externalPage ? EventType.ANSWER_DELTA : EventType.REASONING_LOG_DELTA;
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
        agentId: externalPage ? stringData(uiPayload.agentId) : "",
        agentName: externalPage ? stringData(uiPayload.agentName) : "",
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
    const displayName = agentName || agentId || "数字员工";
    const content =
      status === "_START_"
        ? `正在让数字员工处理：${displayName}`
        : status === "_DONE_"
        ? `数字员工处理完成：${displayName}`
        : `数字员工处理失败：${displayName}`;
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
        objectType: "tool_call",
        status,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        ...(agentId ? { delegated_agent_id: agentId } : {}),
        ...(agentName ? { delegated_agent_name: agentName } : {}),
      },
    });
  }

  /** 输出挂在 3009 调用节点下的 Input/Output JSON 详情。 */
  async #emitDelegationDetail(
    event: RunEvent,
    context: AgentContext,
    phase: "start" | "result",
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const agentId = stringData(event.data.agentId);
    const agentName = stringData(event.data.agentName);
    const error = stringData(event.data.error);
    const detail =
      phase === "start"
        ? {
            agentId,
            agentName,
            task: stringData(event.data.task),
            ...(stringData(event.data.expectedOutput)
              ? { expectedOutput: stringData(event.data.expectedOutput) }
              : {}),
            ...(Array.isArray(event.data.attachments)
              ? { attachments: event.data.attachments }
              : {}),
          }
        : {
            agentId,
            agentName,
            status:
              stringData(event.data.resultStatus) ||
              stringData(event.data.status) ||
              (event.type === "delegation.completed" ? "completed" : "failed"),
            artifactCount:
              typeof event.data.artifactCount === "number" ? event.data.artifactCount : 0,
            ...(error ? { error, errorDetail: error } : {}),
          };
    const content = JSON.stringify({
      title: phase === "start" ? "Input" : "Output",
      json: formatDetailJson(detail),
    });
    const messageId = `${delegationId}-${phase}`;
    await this.#protocolEmitter.emitEvent({
      sessionId: context.sessionId,
      traceId: context.traceId,
      eventType: EventType.REASONING_LOG_DELTA,
      sourceAgentType: this.#agentType,
      messageId,
      parentMessageId: delegationId,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content,
        contentType: SseReasonMessageType.json_block,
        orderId: messageId,
        parentOrderId: delegationId,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        detail_phase: phase,
        ...(agentId ? { delegated_agent_id: agentId } : {}),
        ...(agentName ? { delegated_agent_name: agentName } : {}),
      },
    });
  }

  /** 原样输出子 Agent 正文，并用 parentOrderId 挂到对应 Agent 调用节点。 */
  async #emitDelegationOutput(event: RunEvent, context: AgentContext, text: string): Promise<void> {
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
      messageId: `${delegationId}:answer:text`,
      parentMessageId: `${delegationId}:answer`,
      data: protocolMessage({
        event: EventType.REASONING_LOG_DELTA,
        content: text,
        contentType: "1002",
        orderId: `${delegationId}:answer:text`,
        parentOrderId: `${delegationId}:answer`,
      }),
      metadata: {
        parent_run_id: event.runId,
        delegation_id: delegationId,
        ...(agentId ? { delegated_agent_id: agentId } : {}),
        ...(agentName ? { delegated_agent_name: agentName } : {}),
      },
    });
  }
}
