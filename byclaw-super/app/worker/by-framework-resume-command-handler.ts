import type { DelegationResumeResult } from "@byclaw/by-conductor";
import {
  AgentState,
  AgentTaskResult,
  type AgentContext,
  type ResumeCommand,
} from "@byclaw/by-framework";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import {
  commandLogFields,
  commandString,
  extractMessage,
  recordString,
  toError,
} from "./by-framework-protocol.js";
import {
  parseChildAgentResume,
  type ChildAgentResume,
} from "./by-framework-resume.js";
import type {
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
const CHILD_RESUME_ALREADY_SETTLED_ERROR_CODE = "CHILD_RESUME_ALREADY_SETTLED";
const CHILD_RESUME_CALLBACK_EXPIRED_ERROR_CODE = "CHILD_RESUME_CALLBACK_EXPIRED";
const CHILD_RESUME_RUN_NOT_RESUMABLE_ERROR_CODE = "CHILD_RESUME_RUN_NOT_RESUMABLE";
const CHILD_RESUME_RUN_NOT_FOUND_ERROR_CODE = "CHILD_RESUME_RUN_NOT_FOUND";
const RESUME_NOT_ROUTABLE_ERROR_CODE = "RESUME_NOT_ROUTABLE";
const RESUME_NOT_ROUTABLE_CANCEL_REASON =
  "by-framework Resume 缺少恢复原 Run 所需的路由信息";

type AuthorizedRunContext = Awaited<ReturnType<WorkerRunIngress["authorizeRun"]>>;
type DelegationSettlement = Awaited<ReturnType<WorkerRunService["resumeDelegation"]>>;
type FailedDelegationSettlement = Exclude<
  DelegationResumeResult,
  { outcome: "run_resumed" | "delegation_settled" }
>;

interface UserInteractionResumeRoute {
  kind: "user_interaction";
  runId: string;
  interactionId: string;
}

interface DelegationCallbackResumeRoute {
  kind: "delegation_callback";
  callback: ChildAgentResume;
}

interface InvalidDelegationCallbackRoute {
  kind: "invalid_delegation_callback";
  metadataRunId: string;
  delegationId: string;
  errorDetail: string;
}

interface UnroutableResumeRoute {
  kind: "unroutable";
  metadataRunId: string;
}

type ResumeCommandRoute =
  | UserInteractionResumeRoute
  | DelegationCallbackResumeRoute
  | InvalidDelegationCallbackRoute
  | UnroutableResumeRoute;

interface ResumeFailureDescription {
  errorCode: string;
  userMessage: string;
  errorDetail: string;
  cancelRun: boolean;
}

interface RunTerminationResult {
  cancellationError: string;
  originalExecutionError: string;
}

export interface FailureStreamInput {
  errorCode: string;
  userMessage: string;
  errorSource?: string;
  errorDetail?: string;
  runId?: string;
  delegationId?: string;
  protocolError?: boolean;
}

export interface ResumeCommandHandlerOptions {
  runService: WorkerRunService;
  runIngress: WorkerRunIngress;
  resolveActiveRunId(sessionId: string, traceId: string): string | undefined;
  releaseActiveRun(runId: string): void;
  markOriginalExecutionFinished(runId: string, status: AgentState): Promise<void>;
  finishFailureStream(context: AgentContext, input: FailureStreamInput): Promise<void>;
  forwardRun(
    authorized: AuthorizedRunContext,
    context: AgentContext,
    afterEventId: number,
  ): Promise<AgentTaskResult>;
  logger?: WorkerLogger;
}

/**
 * ResumeCommand 的入口路由器。
 *
 * 这里只识别 Resume 属于用户交互、子 Agent 回调还是不可路由命令；具体恢复行为由各自
 * 的处理器完成，避免两套协议共享一条过程式分支。
 */
export class ByFrameworkResumeCommandHandler {
  readonly #resolveActiveRunId: ResumeCommandHandlerOptions["resolveActiveRunId"];
  readonly #finishFailureStream: ResumeCommandHandlerOptions["finishFailureStream"];
  readonly #interactionHandler: UserInteractionResumeHandler;
  readonly #delegationHandler: DelegationCallbackResumeHandler;
  readonly #runTerminator: ResumeRunTerminator;
  readonly #logger: WorkerLogger | undefined;

  constructor(options: ResumeCommandHandlerOptions) {
    this.#resolveActiveRunId = options.resolveActiveRunId;
    this.#finishFailureStream = options.finishFailureStream;
    this.#logger = options.logger;
    this.#runTerminator = new ResumeRunTerminator(options);
    this.#interactionHandler = new UserInteractionResumeHandler(options);
    this.#delegationHandler = new DelegationCallbackResumeHandler(options, this.#runTerminator);
  }

  async handle(command: ResumeCommand, context: AgentContext): Promise<AgentTaskResult> {
    this.#logReceivedCommand(command);
    const route = classifyResumeCommand(command);

    switch (route.kind) {
      case "user_interaction":
        return await this.#interactionHandler.handle(command, context, route);
      case "delegation_callback":
        return await this.#delegationHandler.handle(command, context, route.callback);
      case "invalid_delegation_callback":
        return await this.#delegationHandler.rejectInvalid(command, context, route);
      case "unroutable":
        return await this.#rejectUnroutable(command, context, route);
    }
    return assertNever(route);
  }

  async #rejectUnroutable(
    command: ResumeCommand,
    context: AgentContext,
    route: UnroutableResumeRoute,
  ): Promise<AgentTaskResult> {
    const runId =
      route.metadataRunId ||
      this.#resolveActiveRunId(command.header.sessionId, command.header.traceId) ||
      "";
    const delegationId = recordString(command.header.metadata, "delegation_id");
    const routingIssues = resumeRoutingIssues(command, route.metadataRunId);
    const errorDetail = `ResumeCommand 无法路由：${routingIssues.join("；")}`;
    const termination = runId
      ? await this.#runTerminator.terminate(runId, RESUME_NOT_ROUTABLE_CANCEL_REASON)
      : emptyRunTermination();

    this.#logger?.warn(
      {
        ...commandLogFields(command),
        status: command.status,
        parentMessageId: command.header.parentMessageId,
        delegationId,
        runId,
        routingIssues,
        runCancelled: Boolean(runId) && !termination.cancellationError,
        cancellationError: termination.cancellationError || undefined,
        originalExecutionError: termination.originalExecutionError || undefined,
      },
      "拒绝无法路由到原 Run 的 Resume 回调",
    );

    const userMessage = `恢复回调协议不完整（${routingIssues.join(
      "；",
    )}），无法恢复原任务。本次任务已终止，请重试。`;
    await this.#finishFailureStream(context, {
      errorCode: RESUME_NOT_ROUTABLE_ERROR_CODE,
      userMessage,
      errorDetail,
      runId,
      delegationId,
      protocolError: true,
    });
    return failedResult(RESUME_NOT_ROUTABLE_ERROR_CODE, errorDetail);
  }

  #logReceivedCommand(command: ResumeCommand): void {
    this.#logger?.info(
      {
        ...commandLogFields(command),
        status: command.status,
        parentMessageId: command.header.parentMessageId,
        delegationId: recordString(command.header.metadata, "delegation_id"),
        interactionId: recordString(command.header.metadata, "interaction_id"),
        runId: recordString(command.header.metadata, "parent_run_id"),
        contentType: Array.isArray(command.content) ? "array" : typeof command.content,
        contentChars: typeof command.content === "string" ? command.content.length : undefined,
        replyDataType: Array.isArray(command.replyData) ? "array" : typeof command.replyData,
        replyDataChars:
          typeof command.replyData === "string" ? command.replyData.length : undefined,
      },
      "收到 by-framework ResumeCommand",
    );
  }
}

/** 只负责把用户表单回答写回正在等待的 Run。 */
class UserInteractionResumeHandler {
  readonly #runService: WorkerRunService;
  readonly #runIngress: WorkerRunIngress;
  readonly #logger: WorkerLogger | undefined;

  constructor(options: ResumeCommandHandlerOptions) {
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#logger = options.logger;
  }

  async handle(
    command: ResumeCommand,
    context: AgentContext,
    route: UserInteractionResumeRoute,
  ): Promise<AgentTaskResult> {
    const { authorized, beyondToken } = await authorizeResumeRun(
      this.#runIngress,
      command,
      route.runId,
    );
    if (authorized.run.id !== route.runId) {
      throw new Error(`Authorized Run does not match Resume target: ${route.runId}`);
    }
    await this.#runService.respondToInteraction(
      route.runId,
      route.interactionId,
      {
        action: "submit",
        text: extractMessage(command.content),
      },
      beyondToken,
    );

    // 交互 Resume 不是新聊天终态，禁止框架提前关闭共享输出流。
    context.setStreamFinished(true);
    this.#logger?.info(
      {
        ...commandLogFields(command),
        runId: route.runId,
        interactionId: route.interactionId,
      },
      "已恢复用户交互",
    );
    return completedResult();
  }
}

/** 只负责校验、结算子 Agent 终态回调，并按结算结果恢复或终止原 Run。 */
class DelegationCallbackResumeHandler {
  readonly #runService: WorkerRunService;
  readonly #runIngress: WorkerRunIngress;
  readonly #finishFailureStream: ResumeCommandHandlerOptions["finishFailureStream"];
  readonly #forwardRun: ResumeCommandHandlerOptions["forwardRun"];
  readonly #runTerminator: ResumeRunTerminator;
  readonly #logger: WorkerLogger | undefined;

  constructor(options: ResumeCommandHandlerOptions, runTerminator: ResumeRunTerminator) {
    this.#runService = options.runService;
    this.#runIngress = options.runIngress;
    this.#finishFailureStream = options.finishFailureStream;
    this.#forwardRun = options.forwardRun;
    this.#runTerminator = runTerminator;
    this.#logger = options.logger;
  }

  async handle(
    command: ResumeCommand,
    context: AgentContext,
    callback: ChildAgentResume,
  ): Promise<AgentTaskResult> {
    const settlement = await this.#runService.resumeDelegation({
      delegationId: callback.delegationId,
      status: callback.status,
      finalAnswer: callback.finalAnswer,
    });
    this.#logSettlement(command, callback, settlement);
    return await this.#handleSettlement(command, context, callback.delegationId, settlement);
  }

  async rejectInvalid(
    command: ResumeCommand,
    context: AgentContext,
    route: InvalidDelegationCallbackRoute,
  ): Promise<AgentTaskResult> {
    // 协议错误不可重试：正常结束 Redis 消费，同时显式关闭当前用户流。
    this.#logger?.warn(
      {
        ...commandLogFields(command),
        status: command.status,
        parentMessageId: command.header.parentMessageId,
        delegationId: route.delegationId,
        error: route.errorDetail,
      },
      "拒绝协议不完整的子 Agent Resume 回调",
    );
    await this.#finishFailureStream(context, {
      errorCode: CHILD_RESUME_PROTOCOL_ERROR_CODE,
      userMessage: CHILD_RESUME_PROTOCOL_USER_MESSAGE,
      errorDetail: route.errorDetail,
      runId: route.metadataRunId,
      delegationId: route.delegationId,
      protocolError: true,
    });
    return failedResult(CHILD_RESUME_PROTOCOL_ERROR_CODE);
  }

  async #handleSettlement(
    command: ResumeCommand,
    context: AgentContext,
    delegationId: string,
    settlement: DelegationSettlement,
  ): Promise<AgentTaskResult> {
    switch (settlement.outcome) {
      case "delegation_not_found":
      case "delegation_already_settled":
      case "callback_expired":
      case "run_not_resumable":
      case "run_not_found":
        return await this.#rejectSettlement(command, context, delegationId, settlement);
      case "run_resumed": {
        const { authorized } = await authorizeResumeRun(
          this.#runIngress,
          command,
          settlement.runId,
        );
        return await this.#forwardRun(authorized, context, settlement.afterEventId ?? 0);
      }
      case "delegation_settled":
        // 回调已成功持久化，但 Run 正在其他有效阶段，无需由当前命令重复接管事件流。
        context.setStreamFinished(true);
        return completedResult();
    }
    return assertNever(settlement);
  }

  async #rejectSettlement(
    command: ResumeCommand,
    context: AgentContext,
    delegationId: string,
    settlement: FailedDelegationSettlement,
  ): Promise<AgentTaskResult> {
    const failure = describeResumeFailure(delegationId, settlement);
    const runId = "runId" in settlement ? settlement.runId : "";
    const termination =
      failure.cancelRun && runId
        ? await this.#runTerminator.terminate(runId, failure.userMessage)
        : emptyRunTermination();

    this.#logger?.warn(
      {
        ...commandLogFields(command),
        requestMessageId: command.header.parentMessageId,
        delegationId,
        runId,
        resumeOutcome: settlement.outcome,
        userFeedbackSent: true,
        runCancelled: failure.cancelRun && Boolean(runId) && !termination.cancellationError,
        cancellationError: termination.cancellationError || undefined,
        originalExecutionError: termination.originalExecutionError || undefined,
      },
      "子 Agent Resume 无法继续，已向用户返回失败消息",
    );
    await this.#finishFailureStream(context, {
      errorCode: failure.errorCode,
      userMessage: failure.userMessage,
      errorDetail: failure.errorDetail,
      runId,
      delegationId,
    });
    return failedResult(failure.errorCode, failure.errorDetail);
  }

  #logSettlement(
    command: ResumeCommand,
    callback: ChildAgentResume,
    settlement: DelegationSettlement,
  ): void {
    if (!this.#logger) {
      return;
    }
    const fields = {
      ...commandLogFields(command),
      requestMessageId: callback.requestMessageId,
      delegationId: callback.delegationId,
      resumeOutcome: settlement.outcome,
      resumedRunId: "runId" in settlement ? settlement.runId : undefined,
      delegationStatus: "delegationStatus" in settlement ? settlement.delegationStatus : undefined,
      runStatus: "runStatus" in settlement ? settlement.runStatus : undefined,
      executionStage: "executionStage" in settlement ? settlement.executionStage : undefined,
      finalAnswerChars: callback.finalAnswer.length,
    };
    switch (settlement.outcome) {
      case "delegation_not_found":
        this.#logger.warn(fields, "子 Agent Resume 回调未找到对应 Delegation");
        return;
      case "delegation_already_settled":
        this.#logger.info(fields, "检测到已结算 Delegation 的重复子 Agent Resume 回调");
        return;
      case "callback_expired":
        this.#logger.warn(fields, "检测到已超过截止时间的子 Agent Resume 回调");
        return;
      case "run_not_resumable":
        this.#logger.info(fields, "子 Agent Resume 回调对应的 Run 已不可恢复");
        return;
      case "run_not_found":
        this.#logger.warn(fields, "子 Agent Resume 回调对应的 Run 不存在");
        return;
      case "delegation_settled":
        this.#logger.info(fields, "已持久化子 Agent Resume 回调，当前 Run 无需唤醒");
        return;
      case "run_resumed":
        this.#logger.info(fields, "已持久化子 Agent Resume 回调并唤醒原 Run");
        return;
    }
    assertNever(settlement);
  }
}

/** 统一执行“取消内部 Run + 关闭原框架 execution”，并分别保留两步错误。 */
class ResumeRunTerminator {
  readonly #runService: WorkerRunService;
  readonly #releaseActiveRun: ResumeCommandHandlerOptions["releaseActiveRun"];
  readonly #markOriginalExecutionFinished: ResumeCommandHandlerOptions[
    "markOriginalExecutionFinished"
  ];

  constructor(options: ResumeCommandHandlerOptions) {
    this.#runService = options.runService;
    this.#releaseActiveRun = options.releaseActiveRun;
    this.#markOriginalExecutionFinished = options.markOriginalExecutionFinished;
  }

  async terminate(runId: string, reason: string): Promise<RunTerminationResult> {
    let cancellationError = "";
    let originalExecutionError = "";
    try {
      await this.#runService.cancelRun(runId, reason);
      this.#releaseActiveRun(runId);
    } catch (error) {
      cancellationError = toError(error).message;
    }
    try {
      await this.#markOriginalExecutionFinished(runId, AgentState.FAILED);
    } catch (error) {
      originalExecutionError = toError(error).message;
    }
    return { cancellationError, originalExecutionError };
  }
}

/** 先识别用户交互；其余命令才进入子 Agent 终态协议解析。 */
function classifyResumeCommand(command: ResumeCommand): ResumeCommandRoute {
  const metadataRunId = recordString(command.header.metadata, "parent_run_id");
  const interactionId = recordString(command.header.metadata, "interaction_id");
  if (interactionId && metadataRunId) {
    return {
      kind: "user_interaction",
      runId: metadataRunId,
      interactionId,
    };
  }

  try {
    const callback = parseChildAgentResume(command);
    return callback
      ? { kind: "delegation_callback", callback }
      : { kind: "unroutable", metadataRunId };
  } catch (error) {
    return {
      kind: "invalid_delegation_callback",
      metadataRunId,
      delegationId: recordString(command.header.metadata, "delegation_id"),
      errorDetail: toError(error).message,
    };
  }
}

function resumeRoutingIssues(command: ResumeCommand, metadataRunId: string): string[] {
  const issues: string[] = [];
  const sourceAgentType = command.header.sourceAgentType.trim();
  if (!sourceAgentType) {
    issues.push("sourceAgentType 为空");
  }

  const status = command.status.trim().toUpperCase();
  const terminalStatus =
    status === AgentState.COMPLETED ||
    status === AgentState.FAILED ||
    status === AgentState.CANCELLED;
  if (!terminalStatus) {
    issues.push(status ? `status=${status} 不是终态` : "status 为空");
  }

  const interactionId = recordString(command.header.metadata, "interaction_id");
  if (!interactionId) {
    issues.push("交互路由 interaction_id 缺失");
  }

  const delegationId = recordString(command.header.metadata, "delegation_id");
  if (!delegationId && !command.header.parentMessageId.trim().endsWith(":request")) {
    issues.push("子 Agent 路由 delegation_id/parentMessageId(:request) 缺失");
  }
  if (!metadataRunId) {
    issues.push("parent_run_id 缺失");
  }

  const replyDataType = Array.isArray(command.replyData)
    ? "array"
    : command.replyData === null
      ? "null"
      : typeof command.replyData;
  if (status === AgentState.COMPLETED && typeof command.replyData !== "string") {
    issues.push(`replyDataType=${replyDataType}，COMPLETED 子 Agent 回调要求 string`);
  } else if (!terminalStatus && typeof command.replyData !== "string") {
    issues.push(`replyDataType=${replyDataType}，无终态 status 时无法解释回调结果`);
  }
  return issues;
}

function describeResumeFailure(
  delegationId: string,
  settlement: FailedDelegationSettlement,
): ResumeFailureDescription {
  switch (settlement.outcome) {
    case "delegation_not_found":
      return {
        errorCode: CHILD_RESUME_NOT_RECOVERABLE_ERROR_CODE,
        userMessage: CHILD_RESUME_NOT_RECOVERABLE_USER_MESSAGE,
        errorDetail: `未找到 Delegation：${delegationId}`,
        cancelRun: false,
      };
    case "delegation_already_settled":
      return {
        errorCode: CHILD_RESUME_ALREADY_SETTLED_ERROR_CODE,
        userMessage:
          "该子 Agent 结果已经处理，当前恢复请求无法再次执行。请刷新会话；若任务仍在等待，请重试。",
        errorDetail: `Delegation ${delegationId} 已处于终态 ${settlement.delegationStatus}，关联 Run ${settlement.runId}`,
        cancelRun: false,
      };
    case "callback_expired":
      return {
        errorCode: CHILD_RESUME_CALLBACK_EXPIRED_ERROR_CODE,
        userMessage: "子 Agent 返回结果已超过等待时间，本次任务已终止，请重试。",
        errorDetail: `Delegation ${delegationId} 回调已过期，关联 Run ${settlement.runId}`,
        cancelRun: true,
      };
    case "run_not_resumable":
      return {
        errorCode: CHILD_RESUME_RUN_NOT_RESUMABLE_ERROR_CODE,
        userMessage: "原任务已经结束或正在取消，无法继续恢复。请重新发起任务。",
        errorDetail: `Run ${settlement.runId} 状态为 ${settlement.runStatus}，无法恢复 Delegation ${delegationId}`,
        cancelRun: false,
      };
    case "run_not_found":
      return {
        errorCode: CHILD_RESUME_RUN_NOT_FOUND_ERROR_CODE,
        userMessage: "未找到子 Agent 回调对应的原任务，本次任务已终止，请重试。",
        errorDetail: `未找到 Run ${settlement.runId}，无法恢复 Delegation ${delegationId}`,
        cancelRun: false,
      };
  }
  return assertNever(settlement);
}

async function authorizeResumeRun(
  runIngress: WorkerRunIngress,
  command: ResumeCommand,
  runId: string,
): Promise<{ authorized: AuthorizedRunContext; beyondToken: string }> {
  const beyondToken = requireBeyondToken(command);
  const systemCode = commandString(command, "System-Code");
  const authorized = await runIngress.authorizeRun(runId, {
    beyondToken,
    ...(systemCode ? { systemCode } : {}),
  });
  return { authorized, beyondToken };
}

function requireBeyondToken(command: ResumeCommand): string {
  const beyondToken = commandString(command, "Beyond-Token");
  if (!beyondToken) {
    throw new BeyondTokenAuthError("Beyond-Token metadata is required");
  }
  return beyondToken;
}

function failedResult(errorCode: string, errorDetail?: string): AgentTaskResult {
  return new AgentTaskResult({
    status: AgentState.FAILED,
    content: "",
    replyData: null,
    metadata: {
      error_code: errorCode,
      ...(errorDetail ? { error_detail: errorDetail } : {}),
    },
  });
}

function completedResult(): AgentTaskResult {
  return new AgentTaskResult({
    status: AgentState.COMPLETED,
    content: "",
    replyData: null,
  });
}

function emptyRunTermination(): RunTerminationResult {
  return { cancellationError: "", originalExecutionError: "" };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
