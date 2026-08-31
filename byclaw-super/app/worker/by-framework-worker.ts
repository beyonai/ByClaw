import {
  type CallerPrincipal,
  type IngressSessionBindingRepository,
  type RunEvent,
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
  TaskCancelledError,
  WorkerRegistry,
  type AgentContext,
  type GatewayCommand,
} from "@byclaw/by-framework";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import { truncateForLog } from "../log-format.js";
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
  delegationFailureUserMessage,
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
import type {
  ByClawSuperWorkerOptions,
  WorkerLogger,
  WorkerRunIngress,
  WorkerRunService,
} from "./by-framework-worker-contracts.js";

const CHILD_RESUME_PROTOCOL_ERROR_CODE = "CHILD_RESUME_PROTOCOL_INVALID";
const CHILD_RESUME_PROTOCOL_USER_MESSAGE =
  "子 Agent 返回结果协议异常，本次调度已终止，请重试。";
const CHILD_RESUME_NOT_RECOVERABLE_ERROR_CODE = "CHILD_RESUME_NOT_RECOVERABLE";
const CHILD_RESUME_NOT_RECOVERABLE_USER_MESSAGE =
  "未找到可恢复的子 Agent 调度，本次任务已终止，请重试。";
const COMMAND_PROCESSING_ERROR_CODE = "COMMAND_PROCESSING_FAILED";

// ─────────────────────────────────────────────────────────────────────────────
// 文件内部模型：不参与对外 API
// ─────────────────────────────────────────────────────────────────────────────

type AuthorizedRunContext = Awaited<ReturnType<WorkerRunIngress["authorizeRun"]>>;
type WorkerRun = Awaited<ReturnType<WorkerRunIngress["createRun"]>>;

interface AskCommandData {
  message: string;
  attachments: ReturnType<typeof extractUserInput>["attachments"];
  thinkingLevel: ReturnType<typeof commandThinkingLevel>;
  groupChatRef: ReturnType<typeof commandGroupChatRef>;
  orchestrator: ReturnType<typeof commandOrchestratorRef>;
  sessionContext: ReturnType<typeof commandSessionContext>;
  agentName: string;
  auth: { beyondToken: string; systemCode?: string };
  metadata: Record<string, unknown>;
}

interface AskSessionBinding {
  externalSessionId: string;
  key: string;
  sessionId?: string;
}

interface ForwardedRun {
  id: string;
  sessionId: string;
  createdAt: number;
}

interface DelegationFailureInfo {
  agentName: string;
  agentId: string;
  reason: string;
  stage: string;
}

interface RunForwardingState {
  reasoningStarted: boolean;
  reasoningEnded: boolean;
  answer: string;
  answerEmitted: boolean;
  delegationDispatched: boolean;
  delegationFailure?: DelegationFailureInfo;
  waitingForLeaderInteraction: boolean;
  resumedAttemptStarted: boolean;
}

interface RunForwardingScope {
  run: ForwardedRun;
  principal: CallerPrincipal;
  context: AgentContext;
  reasoningMessageId: string;
  summaryMessageId?: string;
}

interface FailureStreamInput {
  errorCode: string;
  userMessage: string;
  errorSource?: string;
  errorDetail?: string;
  runId?: string;
  delegationId?: string;
  protocolError?: boolean;
}

interface ResumeCommandHandlerOptions {
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  finishFailureStream(context: AgentContext, input: FailureStreamInput): Promise<void>;
  forwardRun(
    authorized: AuthorizedRunContext,
    context: AgentContext,
    afterEventId: number,
  ): Promise<AgentTaskResult>;
  logger?: WorkerLogger;
}

interface AskCommandHandlerOptions {
  registry: WorkerRegistry;
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  sessionBindings?: IngressSessionBindingRepository;
  forwardRun(
    run: WorkerRun,
    principal: CallerPrincipal,
    context: AgentContext,
    agentName: string,
    locale?: string,
  ): Promise<AgentTaskResult>;
  logger?: WorkerLogger;
}

/** 保留已由 Delegation 事件确定的失败责任方，避免总入口再改写为 Super 异常。 */
class AttributedDelegationFailure extends Error {
  constructor(
    readonly errorSource: string,
    readonly errorDetail: string,
    userMessage: string,
  ) {
    super(userMessage);
    this.name = "AttributedDelegationFailure";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 框架适配插件
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// ResumeCommand 用例
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 负责 ResumeCommand 的完整恢复用例。
 *
 * Worker 只做命令路由；本类集中管理用户交互恢复、子 Agent 回调校验、Run 唤醒和
 * 恢复后事件转发，避免同一条链路分散在 GatewayWorker 的多个分支中。
 */
class ByFrameworkResumeCommandHandler {
  readonly #runService: WorkerRunService;
  readonly #runIngress: WorkerRunIngress;
  readonly #finishFailureStream: ResumeCommandHandlerOptions["finishFailureStream"];
  readonly #forwardRun: ResumeCommandHandlerOptions["forwardRun"];
  readonly #logger: WorkerLogger | undefined;

  constructor(options: ResumeCommandHandlerOptions) {
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#finishFailureStream = options.finishFailureStream;
    this.#forwardRun = options.forwardRun;
    this.#logger = options.logger;
  }

  /** 按固定步骤消费用户交互或子 Agent 终态回调，并恢复原 Run。 */
  async handle(command: ResumeCommand, context: AgentContext): Promise<AgentTaskResult> {
    this.#logReceivedCommand(command);
    const runId = recordString(command.header.metadata, "parent_run_id");

    // Step 1：用户交互 Resume 只补充既有 Run 的输入，不进入子 Agent 结算流程。
    const interactionResult = await this.#resumeUserInteraction(command, context, runId);
    if (interactionResult) {
      return interactionResult;
    }

    // Step 2：严格校验子 Agent 回调与 Delegation 的关联字段，协议错误直接收口。
    const parsed = await this.#parseChildResume(command, context, runId);
    if ("failure" in parsed) {
      return parsed.failure;
    }
    const childResume = parsed.childResume;

    // Step 3：将合法终态写入持久化真相，并把 WAITING_AGENT Run 重新放回执行队列。
    const resumed = childResume
      ? await this.#runService.resumeDelegation({
          delegationId: childResume.delegationId,
          status: childResume.status,
          finalAnswer: childResume.finalAnswer,
        })
      : { accepted: false };
    this.#logSettlement(command, childResume, resumed);

    // Step 4：关联不到 Delegation 的终态不能静默丢弃，需要给当前用户流明确失败结果。
    if (childResume && !resumed.accepted && !resumed.runId) {
      return await this.#rejectUnrecoverableResume(command, context, childResume.delegationId);
    }

    // Step 5：只有真正唤醒 Run 的回调才接管后续事件；重复或辅助回调在当前上下文结束。
    if (resumed.accepted && resumed.runId && resumed.forwardEvents !== false) {
      const { authorized } = await this.#authorizeResumeRun(command, resumed.runId);
      return await this.#forwardRun(authorized, context, resumed.afterEventId ?? 0);
    }
    return this.#completeAuxiliaryResume(context);
  }

  async #resumeUserInteraction(
    command: ResumeCommand,
    context: AgentContext,
    runId: string,
  ): Promise<AgentTaskResult | undefined> {
    const interactionId = recordString(command.header.metadata, "interaction_id");
    if (!interactionId || !runId) {
      return undefined;
    }

    const { authorized, beyondToken } = await this.#authorizeResumeRun(command, runId);
    if (authorized.run.id !== runId) {
      throw new Error(`Authorized Run does not match Resume target: ${runId}`);
    }
    await this.#runService.respondToInteraction(
      runId,
      interactionId,
      {
        action: "submit",
        text: extractMessage(command.content),
      },
      beyondToken,
    );

    // 交互 Resume 不是新聊天终态，禁止框架提前关闭共享输出流。
    context.setStreamFinished(true);
    this.#logger?.info(
      { ...commandLogFields(command), runId, interactionId },
      "已恢复用户交互",
    );
    return this.#completedResult();
  }

  async #parseChildResume(
    command: ResumeCommand,
    context: AgentContext,
    runId: string,
  ): Promise<
    | { childResume: ReturnType<typeof parseChildAgentResume> }
    | { failure: AgentTaskResult }
  > {
    try {
      return { childResume: parseChildAgentResume(command) };
    } catch (error) {
      // 协议错误不可重试：正常结束 Redis 消费，同时显式关闭当前用户流。
      const delegationId = recordString(command.header.metadata, "delegation_id");
      this.#logger?.warn(
        {
          ...commandLogFields(command),
          status: command.status,
          parentMessageId: command.header.parentMessageId,
          delegationId,
          error: toError(error).message,
        },
        "拒绝协议不完整的子 Agent Resume 回调",
      );
      await this.#finishFailureStream(context, {
        errorCode: CHILD_RESUME_PROTOCOL_ERROR_CODE,
        userMessage: CHILD_RESUME_PROTOCOL_USER_MESSAGE,
        runId,
        delegationId,
        protocolError: true,
      });
      return {
        failure: new AgentTaskResult({
          status: AgentState.FAILED,
          content: "",
          replyData: null,
          metadata: { error_code: CHILD_RESUME_PROTOCOL_ERROR_CODE },
        }),
      };
    }
  }

  async #rejectUnrecoverableResume(
    command: ResumeCommand,
    context: AgentContext,
    delegationId: string,
  ): Promise<AgentTaskResult> {
    this.#logger?.warn(
      {
        ...commandLogFields(command),
        requestMessageId: command.header.parentMessageId,
        delegationId,
      },
      "子 Agent Resume 未找到可恢复的 Delegation",
    );
    await this.#finishFailureStream(context, {
      errorCode: CHILD_RESUME_NOT_RECOVERABLE_ERROR_CODE,
      userMessage: CHILD_RESUME_NOT_RECOVERABLE_USER_MESSAGE,
      delegationId,
    });
    return new AgentTaskResult({
      status: AgentState.FAILED,
      content: "",
      replyData: null,
      metadata: { error_code: CHILD_RESUME_NOT_RECOVERABLE_ERROR_CODE },
    });
  }

  async #authorizeResumeRun(
    command: ResumeCommand,
    runId: string,
  ): Promise<{ authorized: AuthorizedRunContext; beyondToken: string }> {
    const beyondToken = this.#requireBeyondToken(command);
    const systemCode = commandString(command, "System-Code");
    const authorized = await this.#runIngress.authorizeRun(runId, {
      beyondToken,
      ...(systemCode ? { systemCode } : {}),
    });
    return { authorized, beyondToken };
  }

  #requireBeyondToken(command: ResumeCommand): string {
    const beyondToken = commandString(command, "Beyond-Token");
    if (!beyondToken) {
      throw new BeyondTokenAuthError("Beyond-Token metadata is required");
    }
    return beyondToken;
  }

  #completeAuxiliaryResume(context: AgentContext): AgentTaskResult {
    // 无人等待或重复回调只是辅助命令，不应关闭共享会话流。
    context.setStreamFinished(true);
    return this.#completedResult();
  }

  #completedResult(): AgentTaskResult {
    return new AgentTaskResult({
      status: AgentState.COMPLETED,
      content: "",
      replyData: null,
    });
  }

  #logReceivedCommand(command: ResumeCommand): void {
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
  }

  #logSettlement(
    command: ResumeCommand,
    childResume: ReturnType<typeof parseChildAgentResume>,
    resumed: Awaited<ReturnType<WorkerRunService["resumeDelegation"]>>,
  ): void {
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
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AskAgentCommand 用例
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 负责 AskAgentCommand 的完整入站用例。
 *
 * 身份解析、Session 定位、Run 创建、活动索引和取消监控都在此处闭环；Worker 无需了解
 * Ask 命令内部的业务步骤。
 */
class ByFrameworkAskCommandHandler {
  readonly #registry: WorkerRegistry;
  readonly #runService: WorkerRunService;
  readonly #runIngress: WorkerRunIngress;
  readonly #sessionBindings: IngressSessionBindingRepository | undefined;
  readonly #forwardRun: AskCommandHandlerOptions["forwardRun"];
  readonly #logger: WorkerLogger | undefined;
  readonly #activeRuns = new Map<string, string>();
  readonly #externalSessionBindings = new Map<string, string>();

  constructor(options: AskCommandHandlerOptions) {
    this.#registry = options.registry;
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#sessionBindings = options.sessionBindings;
    this.#forwardRun = options.forwardRun;
    this.#logger = options.logger;
  }

  /** 按固定步骤把 AskAgentCommand 转为内部 Run，并转发 Run 输出。 */
  async handle(command: AskAgentCommand, context: AgentContext): Promise<AgentTaskResult> {
    // Step 1：解析协议字段并完成调用者鉴权，后续步骤只使用可信身份。
    const data = this.#parseCommand(command);
    await context.checkCancelled();
    this.#logger?.info(commandLogFields(command), "开始处理 by-framework 入站任务");
    const principal = await this.#runIngress.resolvePrincipal(data.auth);

    // Step 2：将外部会话定位到已有内部 Session；首次请求允许暂时没有绑定。
    const binding = await this.#resolveSessionBinding(command, data, principal);

    // Step 3：在已有 Session 追加 Run，或者为首次请求原子创建 Session + Run。
    const run = await this.#createRun(command, data, binding.sessionId);

    // Step 4：持久化会话关联并建立取消路由，确保外部 execution 能找到内部 Run。
    await this.#registerRun(command, context, principal, binding, run);

    // Step 5：转发 Run 事件；只有 WAITING_AGENT 状态需要保留活动索引供后续取消。
    return await this.#executeRun(command, context, principal, data, run);
  }

  /** 将 by-framework 的取消控制命令映射到当前活动 Run。 */
  async handleCancel(command: unknown): Promise<void> {
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
    this.releaseRun(runId);
  }

  /** 清理同一 Run 在 messageId 和 executionId 下的全部活动索引。 */
  releaseRun(runId: string): void {
    for (const [key, mappedRunId] of this.#activeRuns) {
      if (mappedRunId === runId) {
        this.#activeRuns.delete(key);
      }
    }
  }

  #parseCommand(command: AskAgentCommand): AskCommandData {
    const { message, attachments } = extractUserInput(command.content);
    const beyondToken = commandString(command, "Beyond-Token");
    if (!beyondToken) {
      throw new BeyondTokenAuthError("Beyond-Token metadata is required");
    }
    const systemCode = commandString(command, "System-Code");
    return {
      message,
      attachments,
      thinkingLevel: commandThinkingLevel(command),
      groupChatRef: commandGroupChatRef(command),
      orchestrator: commandOrchestratorRef(command),
      sessionContext: commandSessionContext(command),
      agentName: commandAgentName(command) || "超级助手",
      auth: {
        beyondToken,
        ...(systemCode ? { systemCode } : {}),
      },
      metadata: { ...command.header.metadata },
    };
  }

  async #resolveSessionBinding(
    command: AskAgentCommand,
    data: AskCommandData,
    principal: CallerPrincipal,
  ): Promise<AskSessionBinding> {
    const externalSessionId = orchestratorBindingSessionId(
      command.header.sessionId,
      data.orchestrator,
    );
    const key = externalSessionBindingKey(principal, externalSessionId);
    const sessionId = this.#sessionBindings
      ? await this.#sessionBindings.get({
          source: "by-framework",
          userCode: principal.userCode,
          externalSessionId,
        })
      : this.#externalSessionBindings.get(key);
    return {
      externalSessionId,
      key,
      ...(sessionId ? { sessionId } : {}),
    };
  }

  async #createRun(
    command: AskAgentCommand,
    data: AskCommandData,
    sessionId?: string,
  ): Promise<WorkerRun> {
    const sourceAgentId = commandSourceAgentId(command) || data.orchestrator?.id || "";
    const commonInput = {
      message: data.message,
      thinkingLevel: data.thinkingLevel,
      ...(data.attachments.length > 0 ? { attachments: data.attachments } : {}),
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...(command.header.sessionId ? { externalSessionId: command.header.sessionId } : {}),
      parentMessageId: command.header.messageId,
      traceId: command.header.traceId,
      metadata: data.metadata,
      ...(data.groupChatRef ? { groupChatRef: data.groupChatRef } : {}),
      ...(data.orchestrator ? { orchestrator: data.orchestrator } : {}),
      ...data.auth,
    };
    if (sessionId) {
      return await this.#runIngress.createRun({ sessionId, ...commonInput });
    }
    return await this.#runIngress.createSessionRun({
      ...commonInput,
      ...(data.sessionContext ? { context: data.sessionContext } : {}),
    });
  }

  async #registerRun(
    command: AskAgentCommand,
    context: AgentContext,
    principal: CallerPrincipal,
    binding: AskSessionBinding,
    run: WorkerRun,
  ): Promise<void> {
    if (this.#sessionBindings) {
      await this.#sessionBindings.bind({
        source: "by-framework",
        userCode: principal.userCode,
        externalSessionId: binding.externalSessionId,
        sessionId: run.sessionId,
        now: Date.now(),
      });
    } else {
      this.#externalSessionBindings.set(binding.key, run.sessionId);
    }
    this.#activeRuns.set(command.header.messageId, run.id);
    if (context.executionId) {
      this.#activeRuns.set(context.executionId, run.id);
    }
    this.#logger?.info(
      { ...commandLogFields(command), runId: run.id },
      "by-framework 入站任务已创建 Run",
    );
  }

  async #executeRun(
    command: AskAgentCommand,
    context: AgentContext,
    principal: CallerPrincipal,
    data: AskCommandData,
    run: WorkerRun,
  ): Promise<AgentTaskResult> {
    const stopCancellationMonitor = this.#monitorPersistedCancellation(command, context, run.id);
    let keepActiveRunMapping = false;
    try {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }
      const result = await this.#forwardRun(
        run,
        principal,
        context,
        data.agentName,
        data.sessionContext?.locale,
      );
      keepActiveRunMapping = result.status === AgentState.WAITING_AGENT;
      return result;
    } finally {
      stopCancellationMonitor();
      if (!keepActiveRunMapping) {
        this.releaseRun(run.id);
      }
    }
  }

  /**
   * 兜底 claim 与 cancel 并发窗口：取消方可能在 Worker 写入 worker_id 前只写入
   * cancel_requested，因此运行期间需要轮询 execution 真相并转发给内部 Run。
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
}

// ─────────────────────────────────────────────────────────────────────────────
// 协议辅助函数
// ─────────────────────────────────────────────────────────────────────────────

function isLeaderInteractionEvent(
  event: RunEvent,
  type: "interaction.requested" | "interaction.responded",
): boolean {
  return event.type === type && stringData(event.data.source) === "leader";
}

/** 把 processCommand 总入口的异常按命令来源和消费阶段说清楚。 */
function commandFailurePresentation(
  command: GatewayCommand,
  error: unknown,
): { userMessage: string; errorSource: string; errorDetail: string } {
  if (error instanceof AttributedDelegationFailure) {
    return {
      userMessage: error.message,
      errorSource: error.errorSource,
      errorDetail: error.errorDetail,
    };
  }

  const normalized = toError(error);
  const metadata = command.header.metadata;
  const delegatedAgentName = recordString(metadata, "delegated_agent_name");
  const delegatedAgentType = recordString(metadata, "delegated_agent_type");
  const sourceAgentType = (command.header.sourceAgentType ?? "").trim();
  const errorSource = delegatedAgentName || delegatedAgentType || sourceAgentType || "by-framework";
  const displaySource = delegatedAgentName
    ? `${delegatedAgentName}${delegatedAgentType ? `（${delegatedAgentType}）` : ""}`
    : delegatedAgentType || sourceAgentType;
  const failureKind =
    error instanceof BeyondTokenAuthError || normalized.name === "BeyondTokenAuthError"
      ? "鉴权失败"
      : "消费失败";

  if (command instanceof ResumeCommand) {
    const callbackKind = recordString(metadata, "interaction_id")
      ? "用户交互回调"
      : "数字员工结果回调";
    const sourcePrefix = delegatedAgentName
      ? `${displaySource}的`
      : displaySource
        ? `${displaySource} 的`
        : "";
    return {
      userMessage: `${sourcePrefix}${callbackKind}${failureKind}：${normalized.message}`,
      errorSource,
      errorDetail: normalized.message,
    };
  }

  const sourcePrefix = sourceAgentType ? `来自 ${sourceAgentType} 的` : "by-framework ";
  return {
    userMessage: `${sourcePrefix}入站请求${failureKind}：${normalized.message}`,
    errorSource,
    errorDetail: normalized.message,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 对外阅读入口：文件唯一导出的核心 Worker 类
// ─────────────────────────────────────────────────────────────────────────────

/**
 * byclaw-super 的 by-framework 入站 Worker。
 * 它把 AskAgent 转为内部 Run，并把 Run 事件映射回 by-framework 流式协议。
 */
export class ByClawSuperGatewayWorker extends GatewayWorker {
  readonly #agentType: string;
  readonly #registry: WorkerRegistry;
  readonly #runService: WorkerRunService;
  readonly #protocolEmitter: WorkerProtocolEmitter;
  readonly #presenter: ByFrameworkRunPresenter;
  readonly #logger: WorkerLogger | undefined;
  readonly #askCommandHandler: ByFrameworkAskCommandHandler;
  readonly #resumeCommandHandler: ByFrameworkResumeCommandHandler;

  /** 注入共享 Redis、业务 Run 入口和日志实现。 */
  constructor(options: ByClawSuperWorkerOptions) {
    const registry = options.registry ?? new WorkerRegistry(options.redis);
    const pluginRegistry = new PluginRegistry();
    pluginRegistry.registerBundle(new SuppressResumeStatePlugin());
    super(options.workerId, registry, options.redis, pluginRegistry);
    this.#agentType = options.agentType;
    this.#registry = registry;
    this.#runService = options.runService;
    this.#protocolEmitter = options.protocolEmitter ?? new GatewayDataEmitter(options.redis);
    this.#presenter = new ByFrameworkRunPresenter(this.#agentType, this.#protocolEmitter);
    this.#logger = options.logger;
    this.#askCommandHandler = new ByFrameworkAskCommandHandler({
      registry: this.#registry,
      runService: this.#runService,
      runIngress: options.runIngress,
      forwardRun: (run, principal, context, agentName, locale) =>
        this.#forwardRunEvents(run, principal, context, agentName, locale),
      ...(options.sessionBindings ? { sessionBindings: options.sessionBindings } : {}),
      ...(this.#logger ? { logger: this.#logger } : {}),
    });
    this.#resumeCommandHandler = new ByFrameworkResumeCommandHandler({
      runService: this.#runService,
      runIngress: options.runIngress,
      finishFailureStream: (context, input) => this.#finishFailureStream(context, input),
      forwardRun: (authorized, context, afterEventId) =>
        this.#forwardResumedRun(authorized, context, afterEventId),
      ...(this.#logger ? { logger: this.#logger } : {}),
    });
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
    try {
      if (command instanceof ResumeCommand) {
        return await this.#resumeCommandHandler.handle(command, context);
      }
      if (command instanceof AskAgentCommand) {
        return await this.#askCommandHandler.handle(command, context);
      }
      throw new Error(`Unsupported by-framework command: ${command.actionType}`);
    } catch (error) {
      return await this.#handleCommandFailure(command, context, error);
    }
  }

  /** 将命令异常按框架所有权规则转换为“继续抛出”或“当前用户流失败终态”。 */
  async #handleCommandFailure(
    command: GatewayCommand,
    context: AgentContext,
    error: unknown,
  ): Promise<AgentTaskResult> {
    const normalized = toError(error);

    // Step 1：取消异常必须交回 GatewayWorker，保留框架原生的级联取消语义。
    if (error instanceof TaskCancelledError || normalized.name === "TaskCancelledError") {
      throw error;
    }

    // Step 2：有上游 Agent 的 Ask 由框架回传 FAILED Resume，当前 Worker 不关闭共享流。
    if (!(command instanceof ResumeCommand) && command.header.sourceAgentType) {
      throw error;
    }

    // Step 3：其余异常属于当前 BY_SUPER trace，补齐责任方、Run 和 Delegation 信息。
    const runId = recordString(command.header.metadata, "parent_run_id");
    const delegationId = recordString(command.header.metadata, "delegation_id");
    const failure = commandFailurePresentation(command, error);
    this.#logger?.error(
      {
        ...commandLogFields(command),
        runId,
        delegationId,
        errorSource: failure.errorSource,
        error: normalized.message,
      },
      "处理 by-framework 命令失败，正在终止当前用户流",
    );

    // Step 4：由当前 Worker 负责输出用户正文、最终快照和流结束帧。
    await this.#finishFailureStream(context, {
      errorCode: COMMAND_PROCESSING_ERROR_CODE,
      userMessage: failure.userMessage,
      errorSource: failure.errorSource,
      errorDetail: failure.errorDetail,
      runId,
      delegationId,
    });
    return new AgentTaskResult({
      status: AgentState.FAILED,
      content: "",
      replyData: null,
      metadata: {
        error_code: COMMAND_PROCESSING_ERROR_CODE,
        error_source: failure.errorSource,
        error_detail: failure.errorDetail,
      },
    });
  }

  /** 将 by-framework 的取消控制消息映射到正在执行的内部 Run。 */
  async onCancelTask(command: unknown): Promise<void> {
    await this.#askCommandHandler.handleCancel(command);
  }

  /** 由当前 BY_SUPER trace 负责的失败必须同时包含用户正文、最终快照和流终止帧。 */
  async #finishFailureStream(
    context: AgentContext,
    input: FailureStreamInput,
  ): Promise<void> {
    const runId = input.runId?.trim() ?? "";
    const delegationId = input.delegationId?.trim() ?? "";
    const messageId = runId
      ? `${runId}:super-summary:answer`
      : `${context.executionId || "command"}:error`;
    const metadata = {
      error_code: input.errorCode,
      ...(input.errorSource ? { error_source: input.errorSource } : {}),
      ...(input.errorDetail ? { error_detail: input.errorDetail } : {}),
      ...(input.protocolError ? { protocol_error: true } : {}),
      ...(runId ? { parent_run_id: runId } : {}),
      ...(delegationId ? { delegation_id: delegationId } : {}),
    };
    const options = {
      sourceAgentType: this.#agentType,
      messageId,
      parentMessageId: "-1",
      metadata,
    };
    await this.#protocolEmitter.emitChunk(
      context.sessionId,
      context.traceId,
      { content: input.userMessage, metadata },
      { ...options, eventType: EventType.ANSWER_DELTA },
    );
    await this.#protocolEmitter.emitChunk(
      context.sessionId,
      context.traceId,
      { content: input.userMessage, metadata },
      { ...options, eventType: EventType.FINAL_ANSWER },
    );
    await this.#protocolEmitter.emitChunk(
      context.sessionId,
      context.traceId,
      { content: "", metadata },
      {
        ...options,
        eventType: EventType.APP_STREAM_RESPONSE,
      },
    );
    context.setStreamFinished(true);
  }

  /** Resume Handler 已完成业务恢复；本方法只负责把恢复后的 Run 事件映射回框架流。 */
  async #forwardResumedRun(
    authorized: AuthorizedRunContext,
    context: AgentContext,
    afterEventId: number,
  ): Promise<AgentTaskResult> {
    try {
      const result = await this.#forwardRunEvents(
        authorized.run,
        authorized.session.owner,
        context,
        "超级助手",
        authorized.session.sessionContext.locale,
        {
          afterEventId,
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

  /** 订阅内部事件流，并只输出简化进度与 Leader 最终回答；终态时记录一条业务返回日志。 */
  async #forwardRunEvents(
    run: ForwardedRun,
    principal: CallerPrincipal,
    context: AgentContext,
    agentName: string,
    locale?: string,
    options: { afterEventId?: number; summaryMessageId?: string } = {},
  ): Promise<AgentTaskResult> {
    const afterEventId = options.afterEventId ?? 0;
    const summaryMessageId = options.summaryMessageId;
    const scope: RunForwardingScope = {
      run,
      principal,
      context,
      reasoningMessageId: summaryMessageId
        ? `${summaryMessageId}:reasoning`
        : `${run.id}:reasoning`,
      ...(summaryMessageId ? { summaryMessageId } : {}),
    };
    const state: RunForwardingState = {
      reasoningStarted: false,
      reasoningEnded: false,
      answer: "",
      answerEmitted: false,
      delegationDispatched: false,
      waitingForLeaderInteraction: false,
      // Resume 先忽略挂起前已排队的 token，直到新的 run.attempt 明确开始。
      resumedAttemptStarted: !summaryMessageId,
    };

    // Step 1：首次 Ask 输出就绪标题；Resume 从暂停边界继续，不重复标题。
    if (afterEventId === 0) {
      await this.#presenter.emitReadyTitle(run.id, context, agentName, locale);
    }

    // Step 2：逐个处理持久 Run 事件；每个事件的业务分支集中在 #forwardRunEvent。
    for await (const event of this.#runService.streamEvents(run.id, afterEventId)) {
      if (context.isCancelRequested()) {
        await this.#runService.cancelRun(run.id, "by-framework task cancelled");
        await context.checkCancelled();
      }
      this.#logRunStep(run, context, event);
      const result = await this.#forwardRunEvent(scope, state, event);
      if (result) {
        return result;
      }
    }

    throw new Error(`Run event stream ended without a terminal event: ${run.id}`);
  }

  /** 处理一个 Run 事件；普通事件返回空，只有挂起或终态才返回框架结果。 */
  async #forwardRunEvent(
    scope: RunForwardingScope,
    state: RunForwardingState,
    event: RunEvent,
  ): Promise<AgentTaskResult | undefined> {
    const { context } = scope;

    // Step 1：先记录失败责任方，再转发属于 BY_SUPER 自己的状态卡和交互卡。
    if (event.type === "delegation.failed") {
      state.delegationFailure = {
        agentName: stringData(event.data.agentName),
        agentId: stringData(event.data.agentId),
        reason: stringData(event.data.error),
        stage: stringData(event.data.failureStage),
      };
    }
    if (!scope.summaryMessageId && this.#presenter.opensReasoning(event)) {
      await this.#openReasoning(scope, state);
    }
    await this.#presenter.forwardOwnedEvent(event, context);

    // Step 2：维护恢复、委派和用户交互边界，防止旧 token 越过新的 UI 节点。
    if (scope.summaryMessageId && event.type === "run.attempt") {
      state.resumedAttemptStarted = true;
      return undefined;
    }
    if (event.type === "delegation.started" && !scope.summaryMessageId) {
      state.delegationDispatched = true;
      return undefined;
    }
    if (isLeaderInteractionEvent(event, "interaction.requested")) {
      await this.#closeReasoning(scope, state);
      state.waitingForLeaderInteraction = true;
      return undefined;
    }
    if (isLeaderInteractionEvent(event, "interaction.responded")) {
      state.waitingForLeaderInteraction = false;
      return undefined;
    }

    // Step 3：交出控制权后忽略排队中的旧增量；它们不能越过交互卡或委派卡。
    const leaderDelta =
      event.type === "leader.reasoning.delta" || event.type === "leader.delta";
    if (state.waitingForLeaderInteraction && leaderDelta) {
      return undefined;
    }
    if (!scope.summaryMessageId && state.delegationDispatched && leaderDelta) {
      return undefined;
    }

    // 极快回调可能先将 Run 改回 QUEUED；初始 Ask 只结束等待，输出由 Resume 上下文接管。
    if (
      !scope.summaryMessageId &&
      event.type === "run.status" &&
      stringData(event.data.status) === "QUEUED" &&
      event.data.resumed === true
    ) {
      return this.#waitingAgentResult();
    }
    if (scope.summaryMessageId && !state.resumedAttemptStarted && leaderDelta) {
      return undefined;
    }

    // Step 4：Leader 增量是唯一需要逐条写入 by-framework DataStream 的业务正文。
    if (event.type === "leader.reasoning.delta" && !scope.summaryMessageId) {
      await this.#forwardReasoningDelta(scope, state, stringData(event.data.text));
      return undefined;
    }
    if (event.type === "leader.delta") {
      await this.#forwardAnswerDelta(scope, state, stringData(event.data.text));
      return undefined;
    }

    // Step 5：挂起保留 Run/Delegation 真相；完成、取消、失败分别进入明确的收口函数。
    if (event.type === "run.suspended") {
      return this.#waitingAgentResult();
    }
    if (event.type === "run.completed") {
      return await this.#completeForwardedRun(scope, state, event);
    }
    if (event.type === "run.cancelled") {
      return await this.#cancelForwardedRun(scope, state, event);
    }
    if (event.type === "run.failed") {
      return await this.#failForwardedRun(scope, state, event);
    }
    return undefined;
  }

  async #forwardReasoningDelta(
    scope: RunForwardingScope,
    state: RunForwardingState,
    delta: string,
  ): Promise<void> {
    if (!delta) {
      return;
    }
    await this.#openReasoning(scope, state);
    await this.#presenter.emitReasoning(
      scope.run.id,
      scope.context,
      scope.reasoningMessageId,
      delta,
      EventType.REASONING_LOG_DELTA,
    );
  }

  async #forwardAnswerDelta(
    scope: RunForwardingScope,
    state: RunForwardingState,
    delta: string,
  ): Promise<void> {
    await this.#closeReasoning(scope, state);
    if (!delta) {
      return;
    }
    state.answer += delta;
    await this.#emitAnswerDelta(scope, state, delta);
  }

  async #openReasoning(scope: RunForwardingScope, state: RunForwardingState): Promise<void> {
    if (state.reasoningStarted && !state.reasoningEnded) {
      return;
    }
    await this.#presenter.emitReasoning(
      scope.run.id,
      scope.context,
      scope.reasoningMessageId,
      "",
      EventType.REASONING_LOG_START,
    );
    state.reasoningStarted = true;
    state.reasoningEnded = false;
  }

  async #closeReasoning(scope: RunForwardingScope, state: RunForwardingState): Promise<void> {
    if (!state.reasoningStarted || state.reasoningEnded) {
      return;
    }
    await this.#presenter.emitReasoning(
      scope.run.id,
      scope.context,
      scope.reasoningMessageId,
      "",
      EventType.REASONING_LOG_END,
    );
    state.reasoningEnded = true;
  }

  async #emitAnswerDelta(
    scope: RunForwardingScope,
    state: RunForwardingState,
    content: string,
  ): Promise<void> {
    if (!scope.summaryMessageId) {
      await scope.context.emitChunk(content, EventType.ANSWER_DELTA);
      state.answerEmitted = true;
      return;
    }
    await this.#protocolEmitter.emitChunk(
      scope.context.sessionId,
      scope.context.traceId,
      content,
      {
        eventType: EventType.ANSWER_DELTA,
        sourceAgentType: this.#agentType,
        messageId: `${scope.summaryMessageId}:answer`,
        parentMessageId: "-1",
        metadata: { parent_run_id: scope.run.id, display_role: "super" },
      },
    );
    state.answerEmitted = true;
  }

  async #finishSummaryStream(scope: RunForwardingScope, finalAnswer: string): Promise<boolean> {
    if (!scope.summaryMessageId) {
      return false;
    }
    const options = {
      sourceAgentType: this.#agentType,
      messageId: `${scope.summaryMessageId}:answer`,
      parentMessageId: "-1",
      metadata: { parent_run_id: scope.run.id, display_role: "super" },
    };
    if (finalAnswer) {
      await this.#protocolEmitter.emitChunk(
        scope.context.sessionId,
        scope.context.traceId,
        finalAnswer,
        { ...options, eventType: EventType.FINAL_ANSWER },
      );
    }
    await this.#protocolEmitter.emitChunk(scope.context.sessionId, scope.context.traceId, "", {
      ...options,
      eventType: EventType.APP_STREAM_RESPONSE,
    });
    // 当前 Resume 上下文已使用独立 Super 节点收尾，禁止 GatewayWorker 再发一次终态。
    scope.context.setStreamFinished(true);
    return true;
  }

  async #completeForwardedRun(
    scope: RunForwardingScope,
    state: RunForwardingState,
    event: RunEvent,
  ): Promise<AgentTaskResult> {
    const finalAnswer = stringData(event.data.finalAnswer);
    state.answer ||= finalAnswer;
    await this.#closeReasoning(scope, state);
    this.#logRunFinished(scope.principal, scope.run, "completed", scope.run.createdAt, finalAnswer);
    this.#askCommandHandler.releaseRun(scope.run.id);

    const completedAnswer = state.answer || finalAnswer;
    if (completedAnswer && !state.answerEmitted) {
      await this.#emitAnswerDelta(scope, state, completedAnswer);
    }
    if (await this.#finishSummaryStream(scope, completedAnswer)) {
      return this.#completedResult();
    }
    return new AgentTaskResult({
      status: AgentState.COMPLETED,
      content: completedAnswer,
      replyData: { runId: scope.run.id },
    });
  }

  async #cancelForwardedRun(
    scope: RunForwardingScope,
    state: RunForwardingState,
    event: RunEvent,
  ): Promise<AgentTaskResult> {
    await this.#closeReasoning(scope, state);
    await scope.context.checkCancelled();
    const reason = stringData(event.data.reason) || "run cancelled";
    this.#logRunFinished(scope.principal, scope.run, "cancelled", scope.run.createdAt, reason);
    this.#askCommandHandler.releaseRun(scope.run.id);
    return new AgentTaskResult({
      status: AgentState.CANCELLED,
      content: "",
      replyData: { runId: scope.run.id, reason },
    });
  }

  async #failForwardedRun(
    scope: RunForwardingScope,
    state: RunForwardingState,
    event: RunEvent,
  ): Promise<AgentTaskResult> {
    await this.#closeReasoning(scope, state);
    const error = stringData(event.data.error) || "Run failed";
    this.#logRunFinished(scope.principal, scope.run, "failed", scope.run.createdAt, error);
    this.#askCommandHandler.releaseRun(scope.run.id);

    const userMessage = stringData(event.data.userMessage);
    if (userMessage) {
      const attributedMessage = state.delegationFailure
        ? delegationFailureUserMessage({
            agentName: state.delegationFailure.agentName,
            agentId: state.delegationFailure.agentId,
            reason: userMessage,
            stage: state.delegationFailure.stage,
          })
        : userMessage;
      await this.#emitAnswerDelta(scope, state, attributedMessage);
      if (await this.#finishSummaryStream(scope, attributedMessage)) {
        return this.#completedResult();
      }
      return new AgentTaskResult({
        status: AgentState.COMPLETED,
        content: attributedMessage,
        replyData: { runId: scope.run.id },
      });
    }

    if (state.delegationFailure) {
      const failure = state.delegationFailure;
      const errorSource = failure.agentName || failure.agentId || "下游数字员工";
      throw new AttributedDelegationFailure(
        errorSource,
        failure.reason || error,
        delegationFailureUserMessage({
          agentName: failure.agentName,
          agentId: failure.agentId,
          reason: failure.reason || error,
          stage: failure.stage,
        }),
      );
    }
    throw new Error(error);
  }

  #waitingAgentResult(): AgentTaskResult {
    return new AgentTaskResult({
      status: AgentState.WAITING_AGENT,
      content: "",
      // replyData 必须为空，否则 GatewayWorker 会把未完成的调度序列化成伪 FINAL_ANSWER。
      replyData: null,
    });
  }

  #completedResult(): AgentTaskResult {
    return new AgentTaskResult({
      status: AgentState.COMPLETED,
      content: "",
      replyData: null,
    });
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
