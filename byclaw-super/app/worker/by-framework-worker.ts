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
  Plugin,
  PluginRegistry,
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
  "streamEvents" | "cancelRun" | "respondToInteraction" | "resumeDelegation"
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

/**
 * 标准 GatewayWorker 通常把正文放在 content；当前 BYCLAW_CODE 的真实回调则是
 * content 为空、replyData 直接承载最终答案字符串。归一化必须在 Resume 入口完成，
 * Connector 只接收稳定的 finalAnswer，不感知各子 Agent 的原始返回差异。
 */
function resumeFinalAnswer(content: unknown, replyData: unknown): string {
  const contentText = extractMessage(content);
  if (contentText.trim()) {
    return contentText;
  }
  if (typeof replyData === "string") {
    return replyData;
  }
  const replyRecord = recordValue(replyData);
  if (replyRecord) {
    for (const key of ["finalAnswer", "final_answer", "output", "content", "message", "text"]) {
      const candidate = stringData(replyRecord[key]);
      if (candidate) {
        return candidate;
      }
    }
  }
  if (replyData === null || replyData === undefined) {
    return "";
  }
  try {
    return JSON.stringify(replyData);
  } catch {
    return String(replyData);
  }
}

type DelegationToolCardState = {
  title: string;
  description: string;
  input?: unknown;
  output?: unknown;
};

type DelegationPresentationState = {
  connectorId: string;
  nextTextSegment: number;
  activeTextKind?: "progress" | "output";
  activeTextOrderId?: string;
};

const CODE_BY_FRAMEWORK_CONNECTOR_ID = "code-by-framework";

/**
 * GatewayWorker 会在 ResumeCommand 进入 processCommand 前自动发送一个面向框架内部的
 * `RESUMED` 状态。它与 Delegation 根卡片复用 messageId，会把业务展示文案短暂覆盖成
 * 内部状态词。这里只抑制该自动帧，委派完成状态仍由 #emitDelegationStatus 统一输出。
 */
class SuppressResumeStatePlugin extends Plugin {
  constructor() {
    super({
      plugin_id: "byclaw-super-suppress-resume-state",
      version: "1.0.0",
      priority: -100,
      enabled: true,
    });
  }

  async registerAgentConfigs(): Promise<null> {
    return null;
  }

  async onTaskStart(context: AgentContext): Promise<void> {
    if (!(context.currentCommand instanceof ResumeCommand)) {
      return;
    }
    const emitState = context.emitState.bind(context);
    context.emitState = async (event, eventType) => {
      const state = typeof event === "string" ? event : event.state;
      if (state === AgentState.RESUMED) {
        return;
      }
      await emitState(event, eventType);
    };
  }
}

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
    const pluginRegistry = new PluginRegistry();
    pluginRegistry.registerBundle(new SuppressResumeStatePlugin());
    super(options.workerId, registry, options.redis, pluginRegistry);
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
    if (command instanceof ResumeCommand) {
      this.#logger?.info(
        {
          ...commandLogFields(command),
          status: command.status,
          contentType: Array.isArray(command.content) ? "array" : typeof command.content,
          content: command.content,
          replyDataType: Array.isArray(command.replyData) ? "array" : typeof command.replyData,
          replyData: command.replyData,
        },
        "收到 by-framework ResumeCommand 原始回调",
      );
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
      // 新协议中 callAgent.messageId 与 Delegation 根节点 ID 分离，Resume 的
      // parentMessageId 指向子请求；Delegation ID 由原请求 metadata 原样回传。
      // 某些旧子 Agent 不回传 metadata，因此也支持从确定性的 :request 后缀还原；
      // 更早的旧消息则直接把 parentMessageId 当作 Delegation ID。
      const callbackMessageId = command.header.parentMessageId;
      const delegationId = resumeDelegationId(command);
      const finalAnswer = resumeFinalAnswer(command.content, command.replyData);
      const resumed = delegationId
        ? await this.#runService.resumeDelegation({
            delegationId,
            status: command.status,
            finalAnswer,
          })
        : { accepted: false };
      this.#logger?.info(
        {
          ...commandLogFields(command),
          callbackMessageId,
          delegationId,
          consumed: resumed.accepted,
          resumedRunId: resumed.runId,
          finalAnswerChars: finalAnswer.length,
        },
        resumed.accepted
          ? "已持久化子 Agent Resume 回调并唤醒原 Run"
          : "收到无可恢复 Run 的子 Agent Resume 回调",
      );
      if (resumed.accepted && resumed.runId && resumed.forwardEvents !== false) {
        const beyondToken = commandString(command, "Beyond-Token");
        if (!beyondToken) {
          throw new BeyondTokenAuthError("Beyond-Token metadata is required");
        }
        const systemCode = commandString(command, "System-Code");
        const authorized = await this.#runIngress.authorizeRun(resumed.runId, {
          beyondToken,
          ...(systemCode ? { systemCode } : {}),
        });
        try {
          const result = await this.#forwardRunEvents(
            authorized.run,
            authorized.session.owner,
            context,
            "超级助手",
            authorized.session.sessionContext.locale,
            {
              afterEventId: resumed.afterEventId ?? 0,
              summaryMessageId: `${authorized.run.id}:super-summary`,
            },
          );
          await this.#markOriginalExecutionFinished(authorized.run, result.status);
          return result;
        } catch (error) {
          await this.#markOriginalExecutionFinished(authorized.run, AgentState.FAILED);
          throw error;
        }
      }
      // 无人等待或重复回调只是辅助命令，不应关闭共享会话流。
      context.setStreamFinished(true);
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
          traceId: command.header.traceId,
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
          traceId: command.header.traceId,
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

    let keepActiveRunMapping = false;
    try {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }
      const result = await this.#forwardRunEvents(
        run,
        principal,
        context,
        agentName,
        sessionContext?.locale,
      );
      keepActiveRunMapping = result.status === AgentState.WAITING_AGENT;
      return result;
    } finally {
      stopCancellationMonitor();
      if (!keepActiveRunMapping) {
        this.#deleteActiveRunMappings(run.id);
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
    this.#deleteActiveRunMappings(runId);
  }

  /** 清理同一 Run 在原 messageId、executionId 和 Resume 上下文中的全部临时映射。 */
  #deleteActiveRunMappings(runId: string): void {
    for (const [key, mappedRunId] of this.#activeRuns) {
      if (mappedRunId === runId) {
        this.#activeRuns.delete(key);
      }
    }
  }

  /** ResumeCommand 是新 execution；显式同步最初入站 execution，避免长期停在 WAITING_AGENT。 */
  async #markOriginalExecutionFinished(
    run: { ingressContext?: { externalSessionId?: string; parentMessageId?: string } },
    status: string,
  ): Promise<void> {
    if (![AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED].includes(status as AgentState)) {
      return;
    }
    const sessionId = run.ingressContext?.externalSessionId;
    const messageId = run.ingressContext?.parentMessageId;
    if (!sessionId || !messageId) {
      return;
    }
    const execution = await this.#registry.getExecutionByMessageId(messageId, sessionId);
    if (!execution?.execution_id) {
      return;
    }
    await this.#registry.markExecutionFinished(
      String(execution.execution_id),
      sessionId,
      status,
    );
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
    options: { afterEventId?: number; summaryMessageId?: string } = {},
  ): Promise<AgentTaskResult> {
    const afterEventId = options.afterEventId ?? 0;
    const summaryMessageId = options.summaryMessageId;
    let reasoningStarted = false;
    let reasoningEnded = false;
    let answer = "";
    let answerEmitted = false;
    let deferDelegatedAnswer = false;
    const reasoningMessageId = summaryMessageId
      ? `${summaryMessageId}:reasoning`
      : `${run.id}:reasoning`;
    const delegationToolCards = new Map<string, DelegationToolCardState>();
    const delegationPresentations = new Map<string, DelegationPresentationState>();

    const emitAnswerDelta = async (content: string) => {
      if (!summaryMessageId) {
        await context.emitChunk(content, EventType.ANSWER_DELTA);
        answerEmitted = true;
        return;
      }
      await this.#protocolEmitter.emitChunk(context.sessionId, context.traceId, content, {
        eventType: EventType.ANSWER_DELTA,
        sourceAgentType: this.#agentType,
        messageId: `${summaryMessageId}:answer`,
        parentMessageId: "-1",
        metadata: { parent_run_id: run.id, display_role: "super" },
      });
      answerEmitted = true;
    };

    const finishSummaryStream = async (finalAnswer: string): Promise<boolean> => {
      if (!summaryMessageId) {
        return false;
      }
      if (finalAnswer) {
        await this.#protocolEmitter.emitChunk(context.sessionId, context.traceId, finalAnswer, {
          eventType: EventType.FINAL_ANSWER,
          sourceAgentType: this.#agentType,
          messageId: `${summaryMessageId}:answer`,
          parentMessageId: "-1",
          metadata: { parent_run_id: run.id, display_role: "super" },
        });
      }
      await this.#protocolEmitter.emitChunk(context.sessionId, context.traceId, "", {
        eventType: EventType.APP_STREAM_RESPONSE,
        sourceAgentType: this.#agentType,
        messageId: `${summaryMessageId}:answer`,
        parentMessageId: "-1",
        metadata: { parent_run_id: run.id, display_role: "super" },
      });
      // Resume 的 GatewayWorker 会按 AgentTaskResult 再发一次 finalAnswer/appStreamResponse；
      // 这里已使用独立 Super 节点完成收尾，因此阻止框架用 Delegation ID 重复发送。
      context.setStreamFinished(true);
      return true;
    };

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

    if (afterEventId === 0) {
      await this.#emitReadyTitle(run.id, context, agentName, locale);
    }

    for await (const event of this.#runService.streamEvents(run.id, afterEventId)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }

      this.#logRunStep(run, context, event);

      if (event.type === "delegation.started" && !summaryMessageId) {
        // 子 Agent 调度可能在本轮末尾挂起。此后 Leader 产生的“我来调用……”等正文
        // 先暂存在当前执行栈中，避免 ANSWER 把前端的委派思考树切成 think→answer→think。
        // 若本轮直接完成，会在 run.completed 统一发出；若挂起，则丢弃该临时正文。
        deferDelegatedAnswer = true;
      }

      if (isDelegationReasoningEvent(event)) {
        await ensureReasoningOpen();
      }
      await this.#forwardDelegationEvent(
        event,
        context,
        delegationToolCards,
        delegationPresentations,
      );
      await this.#forwardInteractionEvent(event, context);

      const progress = progressMessage(event);
      if (progress) {
        await ensureReasoningOpen();
        await this.#emitDelegationProgress(event, context);
      }

      if (event.type === "leader.reasoning.delta" && !summaryMessageId) {
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
          if (!deferDelegatedAnswer) {
            await emitAnswerDelta(delta);
          }
        }
      }

      if (event.type === "run.suspended") {
        if (reasoningStarted && !reasoningEnded) {
          await this.#emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
        }
        return new AgentTaskResult({
          status: AgentState.WAITING_AGENT,
          content: "",
          // Run/Delegation 关联已经持久化在数据库。若把 runId 放入 replyData，
          // GatewayWorker 会将其序列化为 FINAL_ANSWER，导致尚未完成的调度提前出现伪终态。
          replyData: null,
        });
      }

      if (event.type === "run.completed") {
        const finalAnswer = stringData(event.data.finalAnswer);
        if (!answer && finalAnswer) {
          answer = finalAnswer;
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
        this.#deleteActiveRunMappings(run.id);
        const completedAnswer = answer || finalAnswer;
        if (completedAnswer && !answerEmitted) {
          await emitAnswerDelta(completedAnswer);
        }
        if (await finishSummaryStream(completedAnswer)) {
          return new AgentTaskResult({
            status: AgentState.COMPLETED,
            content: "",
            replyData: null,
          });
        }
        return new AgentTaskResult({
          status: AgentState.COMPLETED,
          content: completedAnswer,
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
        this.#deleteActiveRunMappings(run.id);
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
        this.#deleteActiveRunMappings(run.id);
        const userMessage = stringData(event.data.userMessage);
        if (userMessage) {
          await emitAnswerDelta(userMessage);
          if (await finishSummaryStream(userMessage)) {
            return new AgentTaskResult({
              status: AgentState.COMPLETED,
              content: "",
              replyData: null,
            });
          }
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

  /**
   * 记录可串联的 Run 里程碑。Leader token 流和子 Agent 正文增量由终态/委派日志汇总，
   * 避免逐 token 写日志；状态、工具、交互和终态事件仍逐步可见。
   */
  #logRunStep(
    run: { id: string; sessionId: string; createdAt: number },
    context: AgentContext,
    event: RunEvent,
  ): void {
    if (
      event.type === "leader.reasoning.delta" ||
      event.type === "leader.delta" ||
      event.type === "delegation.output.delta"
    ) {
      return;
    }
    this.#logger?.info(
      {
        component: "byclaw-super",
        stage: "run_step",
        runId: run.id,
        sessionId: run.sessionId,
        externalSessionId: context.sessionId,
        traceId: context.traceId,
        runEventId: event.eventId,
        runEventType: event.type,
        elapsedMs: Date.now() - run.createdAt,
        ...(stringData(event.data.delegationId)
          ? { delegationId: stringData(event.data.delegationId) }
          : {}),
        ...(stringData(event.data.agentId) ? { agentId: stringData(event.data.agentId) } : {}),
        ...(stringData(event.data.agentName)
          ? { agentName: stringData(event.data.agentName) }
          : {}),
        ...(stringData(event.data.status) ? { stepStatus: stringData(event.data.status) } : {}),
        ...(stringData(event.data.callId) ? { callId: stringData(event.data.callId) } : {}),
        ...(stringData(event.data.toolName) ? { toolName: stringData(event.data.toolName) } : {}),
      },
      "Run 处理步骤",
    );
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
    presentations: Map<string, DelegationPresentationState>,
  ): Promise<void> {
    if (event.type === "delegation.started") {
      const delegationId = stringData(event.data.delegationId);
      if (delegationId) {
        presentations.set(delegationId, {
          connectorId: stringData(event.data.connectorId),
          nextTextSegment: 0,
        });
      }
      await this.#emitDelegationStatus(event, context, "_START_");
      await this.#emitDelegationDetail(event, context, "start");
      return;
    }
    const delegationId = stringData(event.data.delegationId);
    const presentation = delegationId ? presentations.get(delegationId) : undefined;
    const directCodePresentation =
      presentation?.connectorId === CODE_BY_FRAMEWORK_CONNECTOR_ID;
    if (event.type === "delegation.display.progress") {
      await this.#emitDelegationProgress(
        event,
        context,
        directCodePresentation && presentation
          ? nextDelegationTextOrderId(delegationId, presentation, "progress")
          : undefined,
      );
      return;
    }
    if (event.type === "delegation.tool.started") {
      if (presentation) {
        closeDelegationTextSegment(presentation);
      }
      await this.#emitDelegationToolCard(event, context, "_START_", toolCards, {
        ...(event.data.input !== undefined ? { input: event.data.input } : {}),
      });
      return;
    }
    if (event.type === "delegation.tool.detail") {
      if (presentation) {
        closeDelegationTextSegment(presentation);
      }
      const phase = stringData(event.data.phase);
      if (phase === "input" || phase === "output") {
        await this.#emitDelegationToolCard(event, context, "_START_", toolCards, {
          [phase]: event.data.value,
        });
      }
      return;
    }
    if (event.type === "delegation.tool.completed") {
      if (presentation) {
        closeDelegationTextSegment(presentation);
      }
      await this.#emitDelegationToolCard(event, context, "_DONE_", toolCards, {
        ...(event.data.output !== undefined ? { output: event.data.output } : {}),
      });
      return;
    }
    if (event.type === "delegation.tool.failed") {
      if (presentation) {
        closeDelegationTextSegment(presentation);
      }
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
        if (directCodePresentation && presentation) {
          await this.#emitDelegationOutput(
            event,
            context,
            text,
            nextDelegationTextOrderId(delegationId, presentation, "output"),
          );
        } else {
          await this.#emitDelegationOutput(event, context, text);
        }
      }
      return;
    }
    if (event.type === "delegation.completed") {
      await this.#emitDelegationStatus(event, context, "_DONE_");
      await this.#emitDelegationDetail(event, context, "result");
      if (delegationId) {
        presentations.delete(delegationId);
      }
      return;
    }
    if (event.type === "delegation.failed") {
      await this.#emitDelegationStatus(event, context, "_ERROR_");
      await this.#emitDelegationDetail(event, context, "result");
      if (delegationId) {
        presentations.delete(delegationId);
      }
    }
  }

  /** 将子 Agent 可展示过程挂在委派根节点下。 */
  async #emitDelegationProgress(
    event: RunEvent,
    context: AgentContext,
    timelineOrderId?: string,
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    const text = stringData(event.data.text) || stringData(event.data.message);
    if (!delegationId || !text) {
      return;
    }
    const orderId = timelineOrderId || `${delegationId}:progress`;
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

  /** 将结构化问题输出为 3014，旧子 Agent 表单/PAGE 继续使用 3013/2010。 */
  async #forwardInteractionEvent(event: RunEvent, context: AgentContext): Promise<void> {
    if (event.type !== "interaction.requested") {
      return;
    }
    const interactionId = stringData(event.data.interactionId);
    const request = recordValue(event.data.request);
    const externalPage = stringData(request?.kind) === "external_page";
    const leaderQuestion = stringData(event.data.source) === "leader";
    const structuredQuestion =
      leaderQuestion || stringData(request?.kind) === "questions";
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    const uiPayload = recordValue(request?.uiPayload) ?? {
      formStatus: 0,
      pluginMachineFields: [],
    };
    const delegationId = stringData(event.data.delegationId);
    const content = JSON.stringify(structuredQuestion ? { questions } : uiPayload);
    const eventType = externalPage ? EventType.ANSWER_DELTA : EventType.REASONING_LOG_DELTA;
    const contentType = externalPage ? "2010" : structuredQuestion ? "3014" : "3013";
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
        ...(structuredQuestion ? { role: "assistant" } : {}),
      }),
      metadata: {
        parent_run_id: event.runId,
        interaction_id: interactionId,
        ...(delegationId ? { delegation_id: delegationId } : {}),
        ...(structuredQuestion
          ? { questions, tool_name: "AskUserQuestion" }
          : {}),
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
    const displayName = agentName || agentId;
    const displayPrefix = displayName ? `${displayName} ` : "";
    const content =
      status === "_START_"
        ? `${displayPrefix}数字员工正在处理`
        : status === "_DONE_"
        ? `${displayPrefix}数字员工处理完成`
        : `${displayPrefix}数字员工处理失败`;
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
  async #emitDelegationOutput(
    event: RunEvent,
    context: AgentContext,
    text: string,
    timelineOrderId?: string,
  ): Promise<void> {
    const delegationId = stringData(event.data.delegationId);
    if (!delegationId) {
      return;
    }
    const agentId = stringData(event.data.agentId);
    const agentName = stringData(event.data.agentName);
    const orderId = timelineOrderId || `${delegationId}:answer:text`;
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
        contentType: "1002",
        orderId,
        parentOrderId,
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

/** 从新旧两版 Resume 关联字段中恢复持久化 Delegation ID。 */
function resumeDelegationId(command: ResumeCommand): string {
  const callbackMessageId = command.header.parentMessageId;
  const requestSuffix = ":request";
  if (callbackMessageId.endsWith(requestSuffix)) {
    return callbackMessageId.slice(0, -requestSuffix.length);
  }
  return recordString(command.header.metadata, "delegation_id") || callbackMessageId;
}

function nextDelegationTextOrderId(
  delegationId: string,
  state: DelegationPresentationState,
  kind: "progress" | "output",
): string {
  if (state.activeTextKind !== kind || !state.activeTextOrderId) {
    state.nextTextSegment += 1;
    state.activeTextKind = kind;
    state.activeTextOrderId = `${delegationId}:timeline:${state.nextTextSegment}`;
  }
  return state.activeTextOrderId;
}

function closeDelegationTextSegment(state: DelegationPresentationState): void {
  delete state.activeTextKind;
  delete state.activeTextOrderId;
}
