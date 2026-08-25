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
  WorkerRegistry,
  WorkerRunner,
  type AgentContext,
  type GatewayCommand,
  createRedis,
} from "@byclaw/by-framework";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import type { RunIngressService } from "../ingress/run-ingress-service.js";
import {
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
  orchestratorBindingSessionId,
  recordString,
  stringData,
  toError,
} from "./by-framework-protocol.js";
import { parseChildAgentResume } from "./by-framework-resume.js";
import {
  ByFrameworkRunPresenter,
  type WorkerProtocolEmitter,
} from "./by-framework-run-presenter.js";
import { truncateForLog } from "../log-format.js";

export type RedisClient = ReturnType<typeof createRedis>;
export type WorkerRunService = Pick<
  RunService,
  "streamEvents" | "cancelRun" | "respondToInteraction" | "resumeDelegation"
>;
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
 * GatewayWorker 会在 ResumeCommand 进入 processCommand 前自动发送一个面向框架内部的
 * `RESUMED` 状态。它与 Delegation 根卡片复用 messageId，会把业务展示文案短暂覆盖成
 * 内部状态词。这里只抑制该自动帧，委派完成状态由 Run Presenter 统一输出。
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
  readonly #presenter: ByFrameworkRunPresenter;
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
    this.#presenter = new ByFrameworkRunPresenter(this.#agentType, this.#protocolEmitter);
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
      return this.#processResumeCommand(command, context);
    }
    if (command instanceof AskAgentCommand) {
      return this.#processAskCommand(command, context);
    }
    throw new Error(`Unsupported by-framework command: ${command.actionType}`);
  }

  /** 消费用户交互或子 Agent 终态回调，并恢复原 Run。 */
  async #processResumeCommand(
    command: ResumeCommand,
    context: AgentContext,
  ): Promise<AgentTaskResult> {
    this.#logger?.info(
      {
        ...commandLogFields(command),
        status: command.status,
        parentMessageId: command.header.parentMessageId,
        delegationId: recordString(command.header.metadata, "delegation_id"),
        contentType: Array.isArray(command.content) ? "array" : typeof command.content,
        contentChars: typeof command.content === "string" ? command.content.length : undefined,
        replyDataType: Array.isArray(command.replyData) ? "array" : typeof command.replyData,
        replyDataChars:
          typeof command.replyData === "string" ? command.replyData.length : undefined,
      },
      "收到 by-framework ResumeCommand",
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
    let childResume: ReturnType<typeof parseChildAgentResume>;
    try {
      childResume = parseChildAgentResume(command);
    } catch (error) {
      // 协议错误属于不可重试消息。若继续抛出，Redis consumer group 会反复领取同一条
      // Resume 并阻塞后续正常回调；记录关联字段后正常 ACK，由等待中的 Delegation
      // 按数据库截止时间收敛。
      this.#logger?.warn(
        {
          ...commandLogFields(command),
          status: command.status,
          parentMessageId: command.header.parentMessageId,
          delegationId: recordString(command.header.metadata, "delegation_id"),
          error: toError(error).message,
        },
        "拒绝协议不完整的子 Agent Resume 回调",
      );
      context.setStreamFinished(true);
      return new AgentTaskResult({
        status: AgentState.COMPLETED,
        content: "",
        replyData: null,
      });
    }
    const resumed = childResume
      ? await this.#runService.resumeDelegation({
          delegationId: childResume.delegationId,
          status: childResume.status,
          finalAnswer: childResume.finalAnswer,
        })
      : { accepted: false };
    this.#logger?.info(
      {
        ...commandLogFields(command),
        requestMessageId: childResume?.requestMessageId,
        delegationId: childResume?.delegationId,
        consumed: resumed.accepted,
        resumedRunId: resumed.runId,
        finalAnswerChars: childResume?.finalAnswer.length ?? 0,
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

  /** 验证 AskAgent、创建内部 Run，并转发 Super 自己拥有的输出。 */
  async #processAskCommand(
    command: AskAgentCommand,
    context: AgentContext,
  ): Promise<AgentTaskResult> {
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
    if (
      ![AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED].includes(
        status as AgentState,
      )
    ) {
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
    let delegationDispatched = false;
    let waitingForLeaderInteraction = false;
    // Resume 订阅可能先看到旧执行在挂起前已排队的 token。只有新 attempt 开始后
    // 的 Leader 输出才属于恢复汇总阶段。
    let resumedAttemptStarted = !summaryMessageId;
    const reasoningMessageId = summaryMessageId
      ? `${summaryMessageId}:reasoning`
      : `${run.id}:reasoning`;

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
        await this.#presenter.emitReasoning(
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
      await this.#presenter.emitReadyTitle(run.id, context, agentName, locale);
    }

    for await (const event of this.#runService.streamEvents(run.id, afterEventId)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }

      this.#logRunStep(run, context, event);

      if (!summaryMessageId && this.#presenter.opensReasoning(event)) {
        await ensureReasoningOpen();
      }
      await this.#presenter.forwardOwnedEvent(event, context);

      if (summaryMessageId && event.type === "run.attempt") {
        resumedAttemptStarted = true;
        continue;
      }

      if (event.type === "delegation.started" && !summaryMessageId) {
        // 调度卡发出即表示 Super 已经把控制权交给子 Agent。当前执行随后只负责
        // 落库并进入 WAITING_AGENT，不能再把迟到的 Leader 思考或正文发到前端。
        // reasoning 保持开启，让“数字员工正在处理”工具卡在等待回调期间保持展开。
        delegationDispatched = true;
        continue;
      }

      if (isLeaderInteractionEvent(event, "interaction.requested")) {
        if (reasoningStarted && !reasoningEnded) {
          await this.#presenter.emitReasoning(
            run.id,
            context,
            reasoningMessageId,
            "",
            EventType.REASONING_LOG_END,
          );
          reasoningEnded = true;
        }
        waitingForLeaderInteraction = true;
        continue;
      }
      if (isLeaderInteractionEvent(event, "interaction.responded")) {
        waitingForLeaderInteraction = false;
        continue;
      }

      // AskUserQuestion 已经交出控制权。异步写入队列中迟到的 Leader 增量属于提问前
      // 的输出，不得越过问题卡；用户回答后，下一条增量会重新开启 reasoning。
      if (
        waitingForLeaderInteraction &&
        (event.type === "leader.reasoning.delta" || event.type === "leader.delta")
      ) {
        continue;
      }

      // 初次执行在 callAgent 后应立即挂起。事件队列中可能仍有 Leader 已经生成的
      // 增量，它们属于交出控制权前的迟到输出，不能越过数字员工调度卡。
      if (
        !summaryMessageId &&
        delegationDispatched &&
        (event.type === "leader.reasoning.delta" || event.type === "leader.delta")
      ) {
        continue;
      }

      // 极快回调会先把 RUNNING Run 原子改回 QUEUED。初始 Ask 上下文此时只需
      // 结束等待；真正的恢复与最终输出由 ResumeCommand 上下文独占。
      if (
        !summaryMessageId &&
        event.type === "run.status" &&
        stringData(event.data.status) === "QUEUED" &&
        event.data.resumed === true
      ) {
        return new AgentTaskResult({
          status: AgentState.WAITING_AGENT,
          content: "",
          replyData: null,
        });
      }

      if (
        summaryMessageId &&
        !resumedAttemptStarted &&
        (event.type === "leader.reasoning.delta" || event.type === "leader.delta")
      ) {
        continue;
      }

      if (event.type === "leader.reasoning.delta" && !summaryMessageId) {
        await ensureReasoningOpen();
        const delta = stringData(event.data.text);
        if (delta) {
          await this.#presenter.emitReasoning(
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
          await this.#presenter.emitReasoning(
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
          await emitAnswerDelta(delta);
        }
      }

      if (event.type === "run.suspended") {
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
          await this.#presenter.emitReasoning(
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
          await this.#presenter.emitReasoning(
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
          await this.#presenter.emitReasoning(
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
}

function isLeaderInteractionEvent(
  event: RunEvent,
  type: "interaction.requested" | "interaction.responded",
): boolean {
  return event.type === type && stringData(event.data.source) === "leader";
}
