import { randomUUID } from "node:crypto";
import {
  ATTACHMENT_INSPECTION_ERROR_CODES,
  AttachmentInspectionError,
} from "../domain/attachment-inspection.js";
import type { AttachmentResolver } from "../ports/attachment-resolver.js";
import { DelegationService } from "./delegation-service.js";
import { LeaderRunSuspendedError } from "./run-suspension.js";
import type { RunIngressContextV1 } from "../domain/run-ingress-context.js";
import type {
  LeaderRunInput,
  LeaderSession,
  LeaderSessionFactory,
} from "../ports/leader.js";
import type {
  TaskPlanExecutionContext,
  TaskPlanGateway,
} from "../ports/task-plan.js";
import type {
  TaskPlanCommand,
  TaskPlanSnapshot,
} from "../domain/task-plan.js";
import { LeaderSessionCache } from "./leader-session-cache.js";
import type {
  DelegationRepository,
  ExecutionCredentialRepository,
  LeaderCheckpointStore,
  RunEventStore,
  RunExecutionClaim,
  RunExecutionQueue,
  RunPage,
  RunPageCursor,
  RunRepository,
  SessionRepository,
} from "../ports/repositories.js";
import type {
  AgentProfile,
  CallerPrincipal,
  Delegation,
  DelegationCallbackStatus,
  DelegationStatus,
  JsonValue,
  Run,
  RunAttachment,
  RunExecutionStage,
  RunEvent,
  RunStatus,
  Session,
  ThinkingLevel,
  UserInteractionQuestion,
  UserInteractionResponse,
} from "../domain/types.js";
import {
  isDelegationCallbackStatus,
  TERMINAL_DELEGATION_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../domain/types.js";
import { resolveAttachmentSelection } from "./attachments.js";
import {
  createSessionContext,
  type SessionContextInput,
} from "../domain/session-context.js";

export interface CreateSessionInput {
  owner: CallerPrincipal;
  context?: SessionContextInput;
}

export interface DelegationResumeInput {
  delegationId: string;
  status: string;
  finalAnswer: string;
}

interface NormalizedDelegationResumeInput extends Omit<DelegationResumeInput, "status"> {
  status: DelegationCallbackStatus;
}

type WaitingCallbackSettler = NonNullable<RunExecutionQueue["settleWaitingCallback"]>;

/**
 * 子 Agent 回调恢复的完整业务结果。
 *
 * outcome 是唯一判别字段：调用方不需要组合 accepted、runId 和 forwardEvents 来猜测原因。
 */
export type DelegationResumeResult =
  | { outcome: "delegation_not_found" }
  | {
      outcome: "delegation_already_settled";
      runId: string;
      delegationStatus: DelegationStatus;
      afterEventId?: number;
    }
  | { outcome: "callback_expired"; runId: string; afterEventId?: number }
  | {
      outcome: "run_not_resumable";
      runId: string;
      runStatus: RunStatus;
      afterEventId?: number;
    }
  | { outcome: "run_not_found"; runId: string; afterEventId?: number }
  | {
      outcome: "delegation_settled";
      runId: string;
      runStatus: RunStatus;
      executionStage: RunExecutionStage;
      afterEventId?: number;
    }
  | { outcome: "run_resumed"; runId: string; afterEventId?: number };

type RoutedDelegationResumeResult = Exclude<
  DelegationResumeResult,
  { outcome: "delegation_not_found" }
>;

function normalizeDelegationResumeInput(
  input: DelegationResumeInput,
): NormalizedDelegationResumeInput {
  const status = input.status.trim().toUpperCase();
  if (!isDelegationCallbackStatus(status)) {
    throw new Error(`Unsupported delegation callback status: ${status || "<empty>"}`);
  }
  return { ...input, status };
}

function withResumeBoundary(
  result: RoutedDelegationResumeResult,
  afterEventId: number | undefined,
): RoutedDelegationResumeResult {
  return afterEventId === undefined ? result : { ...result, afterEventId };
}

export interface CreateRunInput {
  sessionId: string;
  message: string;
  thinkingLevel?: ThinkingLevel;
  agentList: AgentProfile[];
  attachments?: RunAttachment[];
  ingressContext?: RunIngressContextV1;
  metadata?: Record<string, unknown>;
  /** 仅写入专用执行凭证表，不写入 Run、Event 或 Pi Session。 */
  executionCredential?: {
    secret: string;
  };
}

export interface CreateSessionRunInput extends CreateSessionInput {
  message: string;
  thinkingLevel?: ThinkingLevel;
  agentList: AgentProfile[];
  attachments?: RunAttachment[];
  ingressContext?: RunIngressContextV1;
  metadata?: Record<string, unknown>;
  executionCredential?: {
    secret: string;
  };
}

type QueueEntry = { runId: string; metadata: Record<string, unknown> };

const MAX_TASK_PLAN_STALL_ATTEMPTS = 3;
const TASK_PLAN_CONTINUATION_MESSAGE = `The trusted runtime task plan is still active, so this Run cannot finish yet.
Continue the unfinished steps now. Do not repeat completed work. Call updateTaskPlan whenever progress changes,
and only provide the final user answer after every task has reached a terminal status.`;
type SessionQueue = { running: boolean; entries: QueueEntry[] };
type ActiveRun = { controller: AbortController; leader: LeaderSession };
type PendingLeaderInteraction = {
  runId: string;
  resolve(response: UserInteractionResponse): void;
  reject(error: unknown): void;
};

const DOWNSTREAM_MODEL_FAILURE_PREFIX = "Leader model call failed:";

export interface RunServiceRuntimeOptions {
  executionQueue?: RunExecutionQueue;
  checkpoints?: LeaderCheckpointStore;
  credentials?: ExecutionCredentialRepository;
  logger?: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
    error(bindings: Record<string, unknown>, message: string): void;
  };
  instanceId?: string;
  leaseMs?: number;
  queuePollMs?: number;
  maxConcurrentRuns?: number;
  leaderCacheMaxEntries?: number;
  leaderCacheIdleTtlMs?: number;
  /** 是否扫描并执行子 Agent 终态回调截止时间；默认开启以兼容库调用。 */
  callbackTimeoutEnabled?: boolean;
  /**
   * 附件读取边界；注入后 Leader 可通过 inspectAttachment / downloadAttachment
   * 用 Run 执行凭证经 BE 安全读取本轮附件。未实现对应能力时工具不暴露。
   */
  attachmentResolver?: AttachmentResolver;
  /** BE 权威任务计划 Port；缺失时不向 Leader 暴露 updateTaskPlan。 */
  taskPlans?: TaskPlanGateway;
}

/**
 * 编排 Session 与 Run 的生命周期，并保证同一 Session 串行、不同 Session 并行。
 * 每个 Session 复用一个 Leader Session，以保留连续对话上下文。
 */
export class RunService {
  readonly #queues = new Map<string, SessionQueue>();
  readonly #leaderCache: LeaderSessionCache;
  readonly #active = new Map<string, ActiveRun>();
  readonly #executionClaims = new Map<string, RunExecutionClaim>();
  readonly #ephemeralMetadata = new Map<string, Record<string, unknown>>();
  readonly #pendingLeaderInteractions = new Map<string, PendingLeaderInteraction>();
  readonly #inFlightClaims = new Set<Promise<void>>();
  readonly #persistentWaiting = new Set<string>();
  readonly #instanceId: string;
  readonly #leaseMs: number;
  readonly #queuePollMs: number;
  readonly #maxConcurrentRuns: number;
  readonly #attachmentResolver: AttachmentResolver | undefined;
  readonly #taskPlans: TaskPlanGateway | undefined;
  #persistentActive = 0;
  #claimLoop: Promise<void> | undefined;
  #callbackSweep: Promise<void> | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #started = false;
  #stopping = false;

  /** 注入内存或持久化 Port、委派服务及 Leader Session 工厂。 */
  constructor(
    private readonly sessions: SessionRepository,
    private readonly runs: RunRepository,
    private readonly delegations: DelegationRepository,
    private readonly events: RunEventStore,
    private readonly delegationService: DelegationService,
    private readonly leaders: LeaderSessionFactory,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly runtime: RunServiceRuntimeOptions = {},
  ) {
    this.#instanceId = runtime.instanceId ?? `byclaw-super-${randomUUID()}`;
    this.#leaseMs = runtime.leaseMs ?? 30_000;
    this.#queuePollMs = runtime.queuePollMs ?? 500;
    this.#maxConcurrentRuns = runtime.maxConcurrentRuns ?? 10;
    this.#attachmentResolver = runtime.attachmentResolver;
    this.#taskPlans = runtime.taskPlans;
    this.#leaderCache = new LeaderSessionCache(leaders, {
      maxEntries: runtime.leaderCacheMaxEntries ?? 100,
      idleTtlMs: runtime.leaderCacheIdleTtlMs ?? 1_800_000,
      now,
    });
  }

  /** 启动持久队列轮询；纯内存测试路径无需显式启动。 */
  start(): void {
    if (this.#started || !this.runtime.executionQueue) {
      return;
    }
    this.#started = true;
    this.#pollTimer = setInterval(() => {
      void this.#sweepExpiredCallbacks().finally(() => this.#kickPersistentQueue());
    }, this.#queuePollMs);
    this.#pollTimer.unref?.();
    void this.#sweepExpiredCallbacks().finally(() => this.#kickPersistentQueue());
  }

  /** 创建会话容器；Session 本身不立即初始化模型 Session。 */
  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = this.now();
    const session: Session = {
      id: this.createId(),
      owner: structuredClone(input.owner),
      sessionContext: createSessionContext(input.context),
      sessionContextVersion: 1,
      contextRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.sessions.save(session);
    return session;
  }

  /** 查询 Session 快照，供外层会话入口复用并校验对话归属。 */
  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  /** 在 Repository 查询中同时应用 owner 条件，避免越权对象进入上层内存。 */
  async getOwnedSession(
    sessionId: string,
    owner: CallerPrincipal,
  ): Promise<Session | undefined> {
    return this.sessions.getOwned(sessionId, owner);
  }

  /** 提交一个待处理的人机交互；可同时刷新本 Run 的执行凭证。 */
  async respondToInteraction(
    runId: string,
    interactionId: string,
    response: UserInteractionResponse,
    executionCredentialSecret?: string,
  ): Promise<void> {
    if (!isUserInteractionResponse(response)) {
      throw new Error("Invalid user interaction response");
    }
    const run = await this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`Run is already terminal: ${runId} (${run.status})`);
    }
    const refreshedSecret = executionCredentialSecret?.trim();
    if (refreshedSecret && this.runtime.credentials) {
      await this.runtime.credentials.save({
        runId,
        secret: refreshedSecret,
        createdAt: this.now(),
      });
      const metadata = this.#ephemeralMetadata.get(runId);
      if (metadata) {
        metadata["Beyond-Token"] = refreshedSecret;
      }
    }
    if (
      await this.delegationService.respondToInteraction(
        runId,
        interactionId,
        structuredClone(response),
      )
    ) {
      return;
    }
    const pending = this.#pendingLeaderInteractions.get(interactionId);
    const history = await this.events.list(runId);
    const requested = history
      .slice()
      .reverse()
      .find(
        (event) =>
          event.type === "interaction.requested" &&
          event.data.interactionId === interactionId &&
          event.data.source === "leader",
      );
    const alreadyResponded = history.some(
      (event) =>
        event.type === "interaction.responded" &&
        event.data.interactionId === interactionId &&
        (!requested || event.eventId > requested.eventId),
    );
    if (!requested || alreadyResponded) {
      throw new Error(`Pending interaction not found: ${interactionId}`);
    }
    await this.#appendRunEvent({
      timestamp: this.now(),
      runId,
      type: "interaction.responded",
      data: {
        interactionId,
        source: "leader",
        action: response.action,
        ...(response.answers ? { answers: response.answers } : {}),
        ...(response.text ? { text: response.text } : {}),
      },
    });
    if (pending?.runId === runId) {
      this.#pendingLeaderInteractions.delete(interactionId);
      pending.resolve(structuredClone(response));
    }
  }

  /** 回滚尚未创建任何 Run 的 Session；已被使用的 Session 不允许删除。 */
  async deleteEmptySession(sessionId: string): Promise<void> {
    if ((await this.runs.listBySession(sessionId)).length > 0) {
      throw new Error(`Cannot delete non-empty Session: ${sessionId}`);
    }
    await this.sessions.delete(sessionId);
  }

  /** 首个入口原子创建业务 Session、Run、run.created 和执行凭证。 */
  async createSessionRun(input: CreateSessionRunInput): Promise<Run> {
    validateAgentList(input.agentList);
    const now = this.now();
    const session: Session = {
      id: this.createId(),
      owner: structuredClone(input.owner),
      sessionContext: createSessionContext(input.context),
      sessionContextVersion: 1,
      contextRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const run: Run = {
      id: this.createId(),
      sessionId: session.id,
      input: input.message,
      attachments: structuredClone(input.attachments ?? []),
      ...(input.ingressContext
        ? { ingressContext: structuredClone(input.ingressContext) }
        : {}),
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList: structuredClone(input.agentList),
      status: "QUEUED",
      baseContextRevision: 0,
      attemptNo: 0,
      executionStage: "QUEUED",
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const event = {
      timestamp: now,
      runId: run.id,
      type: "run.created",
      data: { status: "QUEUED" },
    } as const;
    const credential = input.executionCredential && this.runtime.credentials
      ? {
          runId: run.id,
          secret: input.executionCredential.secret,
          metadata: persistedExecutionMetadata(input.metadata),
          createdAt: now,
        }
      : undefined;
    const credentialRepository = this.runtime.credentials;
    if (this.runs.createSessionWithRun) {
      await this.runs.createSessionWithRun(session, run, event, credential);
    } else {
      await this.sessions.save(session);
      try {
        if (this.runs.createWithEvent) {
          await this.runs.createWithEvent(run, event, credential);
        } else {
          await this.runs.save(run);
          if (credential) {
            await credentialRepository!.save(credential);
          }
          await this.events.append(event);
        }
      } catch (error) {
        await this.sessions.delete(session.id).catch(() => undefined);
        throw error;
      }
    }
    await this.#scheduleRun(run, input.metadata);
    return run;
  }

  /**
   * 创建 Run 并加入所属 Session 的 FIFO 队列。
   * Agent 列表会被快照，后续委派只能使用本次 Run 明确授权的 Agent。
   */
  async createRun(input: CreateRunInput): Promise<Run> {
    const session = await this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }
    validateAgentList(input.agentList);

    const now = this.now();
    const run: Run = {
      id: this.createId(),
      sessionId: session.id,
      input: input.message,
      attachments: structuredClone(input.attachments ?? []),
      ...(input.ingressContext
        ? { ingressContext: structuredClone(input.ingressContext) }
        : {}),
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList: structuredClone(input.agentList),
      status: "QUEUED",
      baseContextRevision: session.contextRevision,
      attemptNo: 0,
      executionStage: "QUEUED",
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const createdEvent = {
      timestamp: now,
      runId: run.id,
      type: "run.created",
      data: { status: "QUEUED" },
    } as const;
    const credential = input.executionCredential && this.runtime.credentials
      ? {
          runId: run.id,
          secret: input.executionCredential.secret,
          metadata: persistedExecutionMetadata(input.metadata),
          createdAt: now,
        }
      : undefined;
    if (this.runs.createWithEvent) {
      await this.runs.createWithEvent(run, createdEvent, credential);
    } else {
      await this.runs.save(run);
      if (credential) {
        if (!this.runtime.credentials) {
          throw new Error("Execution credential repository is not configured");
        }
        await this.runtime.credentials.save(credential);
      }
      await this.events.append(createdEvent);
    }
    await this.#scheduleRun(run, input.metadata);
    return run;
  }

  /** 查询 Run 当前快照。 */
  async getRun(runId: string): Promise<Run | undefined> {
    return this.runs.get(runId);
  }

  async getOwnedRun(
    runId: string,
    owner: CallerPrincipal,
  ): Promise<Run | undefined> {
    return this.runs.getOwned(runId, owner);
  }

  /** 在 owner 校验后读取 Session 的一页 Run，避免越权方枚举历史消息。 */
  async listOwnedSessionRuns(
    sessionId: string,
    owner: CallerPrincipal,
    input: {
      limit: number;
      before?: RunPageCursor;
    },
  ): Promise<RunPage | undefined> {
    if (!(await this.sessions.getOwned(sessionId, owner))) {
      return undefined;
    }
    return this.runs.listPageBySession({
      sessionId,
      limit: input.limit,
      ...(input.before ? { before: input.before } : {}),
    });
  }

  /** 查询 Run 及其全部委派记录，供状态接口一次性返回。 */
  async getRunDetails(runId: string): Promise<{
    run: Run;
    delegations: Awaited<ReturnType<DelegationRepository["listByRun"]>>;
  } | undefined> {
    const run = await this.runs.get(runId);
    if (!run) {
      return undefined;
    }
    return { run, delegations: await this.delegations.listByRun(runId) };
  }

  /** 从指定事件 ID 之后订阅 Run 事件，支持 SSE 回放与断线重连。 */
  streamEvents(runId: string, afterEventId = 0, signal?: AbortSignal): AsyncIterable<RunEvent> {
    return this.events.stream(runId, afterEventId, signal);
  }

  /**
   * 消费子 Agent 的独立终态回调，并把原 Run 从 WAITING_AGENT 重新放回执行队列。
   * 返回的 afterEventId 供 by-framework Resume 上下文只转发暂停后的增量，避免重放旧消息。
   */
  async resumeDelegation(input: DelegationResumeInput): Promise<DelegationResumeResult> {
    const normalized = normalizeDelegationResumeInput(input);
    const executionQueue = this.runtime.executionQueue;
    const atomicSettlement = executionQueue?.settleWaitingCallback;
    if (!atomicSettlement) {
      return this.#resumeDelegationWithRepository(normalized);
    }
    const settle: WaitingCallbackSettler = (callback) =>
      atomicSettlement.call(executionQueue, callback);
    return this.#resumeDelegationAtomically(normalized, settle);
  }

  async #resumeDelegationAtomically(
    input: NormalizedDelegationResumeInput,
    settle: WaitingCallbackSettler,
  ): Promise<DelegationResumeResult> {
    const settled = await settle({
      ...input,
      enforceDeadline: this.runtime.callbackTimeoutEnabled !== false,
    });
    if (settled.outcome === "delegation_not_found") {
      return settled;
    }

    const afterEventId = await this.#resumeBoundaryEventId(settled.runId, input.delegationId);
    const result = withResumeBoundary(settled, afterEventId);
    if (settled.outcome === "run_resumed") {
      await this.#scheduleQueuedRun(settled.runId);
    }
    return result;
  }

  async #resumeDelegationWithRepository(
    input: NormalizedDelegationResumeInput,
  ): Promise<DelegationResumeResult> {
    const completed = await this.delegationService.completeFromExternalCallback(input);
    if (completed.outcome === "delegation_not_found") {
      return completed;
    }

    const afterEventId = await this.#resumeBoundaryEventId(
      completed.runId,
      input.delegationId,
    );
    if (completed.outcome === "delegation_already_settled") {
      return withResumeBoundary(
        {
          outcome: completed.outcome,
          runId: completed.runId,
          delegationStatus: completed.delegationStatus,
        },
        afterEventId,
      );
    }

    const run = await this.runs.get(completed.runId);
    if (!run) {
      return withResumeBoundary(
        {
          outcome: "run_not_found",
          runId: completed.runId,
        },
        afterEventId,
      );
    }
    if (TERMINAL_RUN_STATUSES.has(run.status) || run.status === "CANCELLING") {
      return withResumeBoundary(
        {
          outcome: "run_not_resumable",
          runId: completed.runId,
          runStatus: run.status,
        },
        afterEventId,
      );
    }

    const queued = await this.#setStatus(run, "QUEUED", {
      delegationId: input.delegationId,
      resumed: true,
    });
    await this.#scheduleRun(queued, undefined);
    return withResumeBoundary(
      {
        outcome: "run_resumed",
        runId: queued.id,
      },
      afterEventId,
    );
  }

  async #resumeBoundaryEventId(runId: string, delegationId: string): Promise<number | undefined> {
    const history = await this.events.list(runId);
    const reversed = history.slice().reverse();
    // 回调可能早于旧执行提交 run.suspended。delegation.started 同样是可靠恢复边界，
    // 可避免 Resume 上下文从事件 0 重放 Super 的历史输出。
    return (
      reversed.find((event) => event.type === "run.suspended") ??
      reversed.find(
        (event) =>
          event.type === "delegation.started" && event.data.delegationId === delegationId,
      )
    )?.eventId;
  }

  async #scheduleQueuedRun(runId: string): Promise<void> {
    const queued = await this.runs.get(runId);
    if (queued?.status === "QUEUED") {
      await this.#scheduleRun(queued, undefined);
    }
  }

  /**
   * 取消排队中或执行中的 Run。
   * 执行中会先进入 CANCELLING，再同时中止 Leader、工具信号和活动 Connector。
   */
  async cancelRun(
    runId: string,
    reason = "user requested cancellation",
    beyondToken?: string,
  ): Promise<Run | undefined> {
    const run = await this.runs.get(runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
      return run;
    }
    if (run.status === "QUEUED" || run.status === "CREATED") {
      const cancelled = await this.#finishCancelled(run, reason);
      await this.#cancelTaskPlan(run, reason, beyondToken);
      return cancelled;
    }

    const cancelling = await this.#requestCancelling(run, reason);
    if (TERMINAL_RUN_STATUSES.has(cancelling.status)) {
      return cancelling;
    }
    const active = this.#active.get(runId);
    active?.controller.abort(new Error(reason));
    const [, delegationCancellation] = await Promise.allSettled([
      active?.leader.abort() ?? Promise.resolve(),
      this.delegationService.cancelRun(runId, reason),
    ]);
    if (delegationCancellation.status === "rejected") {
      throw delegationCancellation.reason;
    }
    const cancelled = await this.#finishCancelled(cancelling, reason);
    await this.#cancelTaskPlan(run, reason, beyondToken);
    return cancelled;
  }

  /** 与执行实例的状态推进竞争时重读后重试，避免合法取消因一次乐观锁冲突返回 500。 */
  async #requestCancelling(run: Run, reason: string): Promise<Run> {
    let current = run;
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (
        current.status === "CANCELLING" ||
        TERMINAL_RUN_STATUSES.has(current.status)
      ) {
        return current;
      }
      try {
        return await this.#setStatus(current, "CANCELLING", { reason });
      } catch (error) {
        lastError = error;
        const latest = await this.runs.get(current.id);
        if (!latest) {
          throw error;
        }
        current = latest;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Run cancellation conflicted repeatedly: ${run.id}`);
  }

  /** 返回 Leader 模型运行时的就绪状态。 */
  async health(): Promise<{ healthy: boolean; message?: string; model?: string }> {
    return this.leaders.health();
  }

  /** 中止活动 Run 并释放所有已创建的 Pi Leader 会话。 */
  async dispose(): Promise<void> {
    this.#stopping = true;
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    for (const active of this.#active.values()) {
      active.controller.abort(new Error("service shutting down"));
      await active.leader.abort().catch(() => undefined);
    }
    await Promise.allSettled(this.#inFlightClaims);
    await this.#leaderCache.dispose();
  }

  /** 持续 claim 可用 Run，单个执行不阻塞其他 Session。 */
  async #kickPersistentQueue(): Promise<void> {
    if (
      this.#stopping ||
      !this.runtime.executionQueue ||
      this.#claimLoop
    ) {
      return this.#claimLoop ?? Promise.resolve();
    }
    this.#claimLoop = (async () => {
      while (
        !this.#stopping &&
        this.#persistentActive - this.#persistentWaiting.size <
          this.#maxConcurrentRuns
      ) {
        const claim = await this.runtime.executionQueue?.claimNext(
          this.#instanceId,
          this.#leaseMs,
        );
        if (!claim) {
          break;
        }
        this.#persistentActive += 1;
        let execution: Promise<void>;
        execution = this.#executeClaim(claim)
          // 数据库暂时不可用时保留非终态，lease 到期后允许其他实例重试。
          .catch(() => undefined)
          .finally(() => {
            this.#inFlightClaims.delete(execution);
            this.#persistentWaiting.delete(claim.runId);
            this.#persistentActive -= 1;
            void this.#kickPersistentQueue();
          });
        this.#inFlightClaims.add(execution);
      }
    })().finally(() => {
      this.#claimLoop = undefined;
    });
    return this.#claimLoop;
  }

  /** 数据库是唯一计时真相；这里只触发幂等扫描，不创建进程内 Delegation 定时器。 */
  async #sweepExpiredCallbacks(): Promise<void> {
    const queue = this.runtime.executionQueue;
    if (
      this.runtime.callbackTimeoutEnabled === false ||
      !queue?.expireWaitingCallbacks ||
      this.#callbackSweep ||
      this.#stopping
    ) {
      return this.#callbackSweep ?? Promise.resolve();
    }
    this.#callbackSweep = queue
      .expireWaitingCallbacks({ limit: 100 })
      .then((expired) => {
        for (const item of expired) {
          this.#ephemeralMetadata.delete(item.runId);
        }
        if (expired.length > 0) {
          this.runtime.logger?.warn(
            {
              instanceId: this.#instanceId,
              expiredCount: expired.length,
              runIds: expired.map((item) => item.runId),
              delegationIds: expired.map((item) => item.delegationId),
            },
            "已终结超过回调截止时间的子 Agent 委派",
          );
        }
      })
      // 数据库短暂异常时保留 WAITING_AGENT，下个轮询周期继续扫描，但必须留下日志。
      .catch((error: unknown) => {
        this.runtime.logger?.error(
          {
            instanceId: this.#instanceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "扫描子 Agent 回调超时失败",
        );
      })
      .finally(() => {
        this.#callbackSweep = undefined;
      });
    return this.#callbackSweep;
  }

  async #scheduleRun(
    run: Run,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (metadata) {
      this.#ephemeralMetadata.set(run.id, structuredClone(metadata));
    }
    if (this.runtime.executionQueue) {
      // Run 行本身就是持久队列真相；NOTIFY 失败只影响唤醒延迟，不能让调用方误以为创建失败。
      await this.runtime.executionQueue.enqueue(run).catch(() => undefined);
      void this.#kickPersistentQueue();
      return;
    }
    const queue = this.#queues.get(run.sessionId) ?? {
      running: false,
      entries: [],
    };
    // callback 恢复不会再次携带入口 metadata；单实例内存队列复用首次运行保存的
    // 进程内上下文。持久队列路径仍由 credentials 仓库按 lease 恢复凭证。
    queue.entries.push({
      runId: run.id,
      metadata: metadata ?? this.#ephemeralMetadata.get(run.id) ?? {},
    });
    this.#queues.set(run.sessionId, queue);
    void this.#pump(run.sessionId);
  }

  /** 读取经过 lease 校验的执行凭证，执行完成后释放当前 Session lease。 */
  async #executeClaim(claim: RunExecutionClaim): Promise<void> {
    const queue = this.runtime.executionQueue;
    if (!queue) {
      return;
    }
    let retainEphemeralMetadata = false;
    try {
      const run = await this.runs.get(claim.runId);
      if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
        return;
      }
      this.#executionClaims.set(run.id, claim);
      if (run.status === "CANCELLING") {
        await this.#finishCancelled(
          run,
          "cancellation resumed after lease handoff",
        );
        return;
      }
      let metadata = this.#ephemeralMetadata.get(run.id) ?? {};
      if (this.runtime.credentials) {
        const credential = await this.runtime.credentials.loadForLease({
          runId: run.id,
          instanceId: claim.ownerInstanceId,
          fencingToken: claim.fencingToken,
        });
        if (!credential) {
          await this.#finishFailed(run, "EXECUTION_CREDENTIAL_MISSING");
          return;
        }
        metadata = {
          ...(credential.metadata ?? {}),
          ...metadata,
          "Beyond-Token": credential.secret,
        };
      }
      if (this.events.appendForClaim) {
        await this.events.appendForClaim(
          {
            runId: run.id,
            timestamp: this.now(),
            type: "run.attempt",
            data: {
              attemptNo: claim.attemptNo,
              resumedFrom: run.executionStage,
              instanceId: claim.ownerInstanceId,
            },
          },
          claim,
        );
      }
      await this.#execute(run, metadata, claim);
      const latest = await this.runs.get(claim.runId);
      retainEphemeralMetadata = Boolean(
        latest && !TERMINAL_RUN_STATUSES.has(latest.status),
      );
    } finally {
      if (this.#executionClaims.get(claim.runId) === claim) {
        this.#executionClaims.delete(claim.runId);
      }
      // callback/用户交互恢复会把同一个非终态 Run 再次入队，且不会重新携带入口
      // metadata。单实例内需保留这份执行上下文，直到 Run 真正终结。
      if (!retainEphemeralMetadata) {
        this.#ephemeralMetadata.delete(claim.runId);
      }
      await queue.release(claim).catch(() => undefined);
    }
  }

  /** 按 FIFO 逐个消费某个 Session 的队列；其他 Session 使用各自独立的泵。 */
  async #pump(sessionId: string): Promise<void> {
    const queue = this.#queues.get(sessionId);
    if (!queue || queue.running) {
      return;
    }
    queue.running = true;
    try {
      while (queue.entries.length > 0) {
        const entry = queue.entries.shift();
        if (!entry) {
          break;
        }
        const run = await this.runs.get(entry.runId);
        if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
          continue;
        }
        await this.#execute(run, entry.metadata);
      }
    } finally {
      queue.running = false;
      if (queue.entries.length === 0) {
        this.#queues.delete(sessionId);
      }
    }
  }

  /** 执行单个 Run，连接 Leader 流式输出、委派调用和最终状态收敛。 */
  async #execute(
    run: Run,
    metadata: Record<string, unknown>,
    claim?: RunExecutionClaim,
  ): Promise<void> {
    // 持久队列会在接管时从凭证仓库重建 metadata。失败收口和 callback 恢复都只
    // 读取这个进程内副本；claim 释放时会立即删除，不进入 Run/Event/Pi 持久化。
    metadata = structuredClone(metadata);
    if (Object.keys(metadata).length > 0) {
      this.#ephemeralMetadata.set(run.id, metadata);
    }
    const session = await this.sessions.get(run.sessionId);
    if (!session) {
      await this.#finishFailed(run, `Session not found: ${run.sessionId}`);
      return;
    }
    let current = run;
    let controller: AbortController | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let leaderLease:
      | Awaited<ReturnType<LeaderSessionCache["acquire"]>>
      | undefined;
    let dirtyLeader = false;
    if (claim) {
      this.#executionClaims.set(run.id, claim);
    }

    try {
      leaderLease = await this.#leaderCache.acquire(
        session.id,
        latestLeaderModel(run),
      );
      const leader = leaderLease.session;
      const latest = await this.runs.get(run.id);
      if (!latest || TERMINAL_RUN_STATUSES.has(latest.status)) {
        return;
      }
      const recoveringStage = latest.executionStage;
      if (leader.contextRevision !== latest.baseContextRevision) {
        throw new Error(
          `Leader context revision ${leader.contextRevision} does not match Run base ${latest.baseContextRevision}`,
        );
      }
      const runController = new AbortController();
      controller = runController;
      if (claim && this.runtime.executionQueue) {
        heartbeat = setInterval(() => {
          void this.runtime.executionQueue
            ?.heartbeat(claim, this.#leaseMs)
            .then((owned) => {
              if (!owned && !runController.signal.aborted) {
                runController.abort(new Error("Run lease fencing token lost"));
              }
            });
        }, Math.max(1_000, Math.floor(this.#leaseMs / 3)));
        heartbeat.unref?.();
      }
      this.#active.set(run.id, { controller: runController, leader });
      dirtyLeader = true;
      let leaderMessage = latest.input;
      if (recoveringStage === "USER_INTERACTION_WAITING") {
        const history = await this.events.list(latest.id);
        const requested = history
          .slice()
          .reverse()
          .find(
            (event) => event.type === "interaction.requested",
          );
        if (requested?.data.source === "leader") {
          this.#persistentWaiting.add(latest.id);
          void this.#kickPersistentQueue();
          const interactionId = String(requested.data.interactionId);
          const response = await this.#waitForInteractionResponse(
            latest.id,
            interactionId,
            requested.eventId,
            runController.signal,
          );
          await this.#reloadExecutionCredential(latest.id, metadata, claim);
          this.#persistentWaiting.delete(latest.id);
          leaderMessage = `${latest.input}

The user has now answered the clarification requested in the previous attempt.
Continue the original task using this response:
${JSON.stringify(response)}`;
        }
      }
      let recoveredDelegations: Delegation[] = [];
      if (recoveringStage === "CONNECTOR_WAITING") {
        recoveredDelegations = (await this.delegations.listByRun(latest.id))
          .filter((delegation) => TERMINAL_DELEGATION_STATUSES.has(delegation.status));
        const completedDelegations = recoveredDelegations
          .map((delegation) => ({
            delegationId: delegation.id,
            agentId: delegation.agentId,
            agentName: delegation.agentName,
            task: delegation.task,
            status: delegation.status,
            result: delegation.result,
          }));
        if (completedDelegations.length > 0) {
          leaderMessage = `${latest.input}

The previously requested delegateAgent call has now returned through the trusted platform callback.
Treat the following records as completed tool results. Do not repeat an identical delegation; continue
the original task, dispatch only work that is still genuinely missing, and synthesize the final answer.
${JSON.stringify(completedDelegations)}`;
        }
      }
      current = await this.#setStatus(latest, "RUNNING");
      const taskPlanContext = this.#taskPlanContext(current, metadata);
      let taskPlanReady = false;
      let activeTaskPlan: TaskPlanSnapshot | undefined;
      if (taskPlanContext && this.#taskPlans) {
        try {
          activeTaskPlan = await this.#taskPlans.loadActive(taskPlanContext);
          taskPlanReady = true;
        } catch (error) {
          throw new Error("Unable to load the authoritative task plan for this Run", {
            cause: error,
          });
        }
      }
      let leaderOutputPausedForDelegation = false;
      let leaderInput: LeaderRunInput;
      leaderInput = {
        message: leaderMessage,
        observability: {
          runId: current.id,
          sessionId: current.sessionId,
          ...(current.ingressContext?.externalSessionId
            ? { externalSessionId: current.ingressContext.externalSessionId }
            : {}),
          ...(current.ingressContext?.traceId
            ? { traceId: current.ingressContext.traceId }
            : {}),
        },
        ...(current.ingressContext?.externalSessionId
          ? { externalSessionId: current.ingressContext.externalSessionId }
          : {}),
        attachments: current.attachments,
        thinkingLevel: current.thinkingLevel ?? "off",
        agents: current.agentList,
        ...(current.ingressContext?.agentCatalogError
          ? { authorizedAgentsUnavailable: true }
          : {}),
        sessionContext: session.sessionContext,
        ...(current.ingressContext?.groupChat
          ? { groupChatContext: current.ingressContext.groupChat }
          : {}),
        currentTime: this.now(),
        user: session.owner,
        ...(current.ingressContext?.orchestrator
          ? { orchestrator: current.ingressContext.orchestrator }
          : {}),
        ...(activeTaskPlan ? { activeTaskPlan } : {}),
        signal: runController.signal,
        // Leader 的可见回答与思考增量被规范化为 Run 事件，供对外流协议消费。
        onDelta: async (text) => {
          // ACTIVE 计划尚未收口时抑制可见回答，避免过早回答在内部续跑前泄漏给用户。
          if (leaderOutputPausedForDelegation || activeTaskPlan?.status === "ACTIVE") {
            return;
          }
          const event = {
            timestamp: this.now(),
            runId: current.id,
            type: "leader.delta",
            data: { text },
          } as const;
          if (claim && this.events.appendForClaim) {
            await this.events.appendForClaim(event, claim);
          } else {
            await this.events.append(event);
          }
        },
        onReasoningDelta: async (text) => {
          if (leaderOutputPausedForDelegation) {
            return;
          }
          const event = {
            timestamp: this.now(),
            runId: current.id,
            type: "leader.reasoning.delta",
            data: { text },
          } as const;
          if (claim && this.events.appendForClaim) {
            await this.events.appendForClaim(event, claim);
          } else {
            await this.events.append(event);
          }
        },
        ...(this.runtime.checkpoints
          ? {
              onCheckpoint: async (checkpoint) => {
                await this.runtime.checkpoints?.stagePending({
                  sessionId: current.sessionId,
                  runId: current.id,
                  attemptNo: current.attemptNo,
                  baseRevision: current.baseContextRevision,
                  checkpoint,
                  now: this.now(),
                  ...(claim ? { claim } : {}),
                });
              },
            }
          : {}),
        // 工具调用只进入 DelegationService，不让 Pi 接触 Connector Registry。
        delegate: async (delegationInput) => {
          runController.signal.throwIfAborted();
          // Pi 可能尚有排队的流回调。委派开始即交出控制权，迟到的 Super
          // reasoning/answer 不再逐 Token 落库，也不能延迟 WAITING_AGENT。
          leaderOutputPausedForDelegation = true;
          // Pi 工具 signal 只代表该次工具调用；Run 级停止必须始终拥有更高优先级，
          // 不能因为工具传入了独立 signal 就丢失整轮取消。
          const delegationSignal = delegationInput.signal
            ? AbortSignal.any([runController.signal, delegationInput.signal])
            : runController.signal;
          const delegated = await this.delegationService.execute({
            session,
            runId: current.id,
            traceId: current.ingressContext?.traceId ?? current.id,
            agents: current.agentList,
            agentId: delegationInput.agentId,
            task: delegationInput.task,
            // 只能从当前 Run 的附件集合按 ID 选择；未知 ID 在解析阶段被拒绝。
            attachments: resolveAttachmentSelection(
              current.attachments,
              delegationInput.attachmentIds,
            ),
            ...(delegationInput.expectedOutput
              ? { expectedOutput: delegationInput.expectedOutput }
              : {}),
            metadata: {
              ...metadata,
              ...(current.ingressContext?.externalSessionId
                ? { externalSessionId: current.ingressContext.externalSessionId }
                : {}),
              ...(current.ingressContext?.parentMessageId
                ? { parentMessageId: current.ingressContext.parentMessageId }
                : {}),
            },
            signal: delegationSignal,
            ...(claim ? { leaseClaim: claim } : {}),
            ...(recoveringStage === "LEADER_SYNTHESIZING" || recoveringStage === "CONNECTOR_WAITING"
              ? { reuseCompleted: true }
              : {}),
            onInputRequired: async (interactionId) => {
              current = await this.#setStatus(current, "WAITING_USER", {
                interactionId,
                source: "by-framework",
              });
            },
            onInputResolved: async (interactionId) => {
              if (!runController.signal.aborted) {
                current = await this.#setStatus(current, "WAITING_AGENT", {
                  interactionId,
                  resumed: true,
                });
              }
            },
          });
          // 同步 Connector 返回了真实终态时，Leader 仍需继续使用工具结果。
          // 挂起会抛出 DelegationSuspendedError，因此不会执行到这里。
          leaderOutputPausedForDelegation = false;
          if (!runController.signal.aborted) {
            current = await this.#setStatus(current, "SYNTHESIZING");
          }
          return delegated;
        },
        askUser: async ({ toolCallId, questions, signal }) => {
          if (activeTaskPlan && activeTaskPlan.status !== "ACTIVE") {
            throw new Error(
              `Task plan is ${activeTaskPlan.status}; no further user interaction is allowed`,
            );
          }
          validateInteractionQuestions(questions);
          const interactionId = `${current.id}:${toolCallId}`;
          const requestedAt = this.now();
          current = await this.#setStatus(current, "WAITING_USER", {
            interactionId,
            source: "leader",
          });
          const requestedEvent = await this.#appendRunEvent({
            timestamp: requestedAt,
            runId: current.id,
            type: "interaction.requested",
            data: {
              interactionId,
              source: "leader",
              request: {
                questions,
                uiPayload: toLegacyFormPayload(questions),
              } as unknown as JsonValue,
            },
          });
          const response = await new Promise<UserInteractionResponse>((resolve, reject) => {
            const interactionSignal = signal ?? runController.signal;
            const onAbort = () => {
              this.#pendingLeaderInteractions.delete(interactionId);
              reject(interactionSignal.reason ?? new Error("User interaction cancelled"));
            };
            if (interactionSignal.aborted) {
              onAbort();
              return;
            }
            interactionSignal.addEventListener("abort", onAbort, { once: true });
            this.#pendingLeaderInteractions.set(interactionId, {
              runId: current.id,
              resolve: (value) => {
                interactionSignal.removeEventListener("abort", onAbort);
                resolve(value);
              },
              reject: (error) => {
                interactionSignal.removeEventListener("abort", onAbort);
                reject(error);
              },
            });
            void this.#waitForInteractionResponse(
              current.id,
              interactionId,
              requestedEvent.eventId,
              interactionSignal,
            )
              .then((value) => {
                const pending = this.#pendingLeaderInteractions.get(interactionId);
                if (pending?.runId !== current.id) {
                  return;
                }
                this.#pendingLeaderInteractions.delete(interactionId);
                pending.resolve(value);
              })
              .catch((error: unknown) => {
                const pending = this.#pendingLeaderInteractions.get(interactionId);
                if (pending?.runId !== current.id) {
                  return;
                }
                this.#pendingLeaderInteractions.delete(interactionId);
                pending.reject(error);
              });
          });
          await this.#reloadExecutionCredential(current.id, metadata, claim);
          if (!runController.signal.aborted) {
            current = await this.#setStatus(current, "RUNNING", {
              interactionId,
              resumed: true,
            });
          }
          return response;
        },
        ...(taskPlanReady && taskPlanContext && this.#taskPlans
          ? {
              updateTaskPlan: async ({
                toolCallId,
                command,
                signal,
              }) => {
                runController.signal.throwIfAborted();
                signal?.throwIfAborted();
                const result = await this.#taskPlans!.command({
                  context: taskPlanContext,
                  idempotencyKey: toolCallId,
                  command,
                });
                if (result.ok) {
                  activeTaskPlan = result.plan;
                } else if (result.currentPlan) {
                  activeTaskPlan = result.currentPlan;
                }
                return result;
              },
            }
          : {}),
        // inspectAttachment 用 Run 执行凭证经 Resolver 安全读取本轮附件；
        // 工具层只能传 attachmentId，附件对象必须在 current.attachments 中命中。
        ...(this.#attachmentResolver
          ? {
              inspectAttachment: async ({
                attachmentId,
                mode,
                signal,
              }: {
                attachmentId: string;
                mode?: "metadata" | "text" | "structure";
                signal?: AbortSignal;
              }) => {
                const attachment = current.attachments.find(
                  (item) => item.id === attachmentId,
                );
                if (!attachment) {
                  throw new AttachmentInspectionError(
                    ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
                    `unknown attachmentId: ${attachmentId}`,
                  );
                }
                const credential = readBeyondToken(metadata);
                if (!credential) {
                  throw new AttachmentInspectionError(
                    ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_MISSING,
                    "execution credential is not available for attachment inspection",
                  );
                }
                return this.#attachmentResolver!.inspect({
                  attachment,
                  principal: session.owner,
                  credential,
                  mode: mode ?? "text",
                  signal: signal ?? runController.signal,
                });
              },
              ...(this.#attachmentResolver.materialize
                ? {
                    downloadAttachment: async ({
                      attachmentId,
                      destinationDirectory,
                      signal,
                    }: {
                      attachmentId: string;
                      destinationDirectory: string;
                      signal?: AbortSignal;
                    }) => {
                      const attachment = current.attachments.find(
                        (item) => item.id === attachmentId,
                      );
                      if (!attachment) {
                        throw new AttachmentInspectionError(
                          ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
                          `unknown attachmentId: ${attachmentId}`,
                        );
                      }
                      const credential = readBeyondToken(metadata);
                      if (!credential) {
                        throw new AttachmentInspectionError(
                          ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_MISSING,
                          "execution credential is not available for attachment download",
                        );
                      }
                      return this.#attachmentResolver!.materialize!({
                        attachment,
                        principal: session.owner,
                        credential,
                        destinationDirectory,
                        signal: signal ?? runController.signal,
                      });
                    },
                  }
                : {}),
            }
          : {}),
      };
      let result = await leader.run(leaderInput);
      let taskPlanStallAttempts = 0;
      while (activeTaskPlan?.status === "ACTIVE") {
        runController.signal.throwIfAborted();
        if (taskPlanStallAttempts >= MAX_TASK_PLAN_STALL_ATTEMPTS) {
          throw new Error(
            `Leader made no task plan progress after ${MAX_TASK_PLAN_STALL_ATTEMPTS} continuation attempts`,
          );
        }
        const previousPlanVersion = activeTaskPlan.version;
        taskPlanStallAttempts += 1;
        result = await leader.run({
          ...leaderInput,
          message: TASK_PLAN_CONTINUATION_MESSAGE,
          activeTaskPlan,
          currentTime: this.now(),
        });
        if (activeTaskPlan?.version !== previousPlanVersion) {
          taskPlanStallAttempts = 0;
        }
      }

      if (runController.signal.aborted) {
        await this.#finishLocallyCancelledRun(current, "run cancelled");
        return;
      }
      if (!result.text.trim()) {
        throw new Error("Leader returned an empty response");
      }
      const finished: Run = {
        ...current,
        status: "COMPLETED",
        executionStage: "SETTLED",
        version: current.version + 1,
        finalAnswer: result.text,
        updatedAt: this.now(),
        finishedAt: this.now(),
      };
      const completionEvent = {
        timestamp: this.now(),
        runId: finished.id,
        type: "run.completed",
        data: { status: "COMPLETED", finalAnswer: result.text },
      } as const;
      const checkpoint = leader.checkpoint();
      if (checkpoint && this.runtime.checkpoints) {
        const committed = await this.runtime.checkpoints.commit({
          sessionId: finished.sessionId,
          runId: finished.id,
          attemptNo: finished.attemptNo,
          expectedRevision: finished.baseContextRevision,
          checkpoint,
          now: this.now(),
          completion: { run: finished, event: completionEvent },
          ...(claim ? { claim } : {}),
        });
        leader.markCommitted(committed.revision);
      } else {
        await this.#saveRunWithEvent(finished, completionEvent);
      }
      dirtyLeader = false;
      this.#ephemeralMetadata.delete(finished.id);
      this.events.close(finished.id);
    } catch (error) {
      if (error instanceof LeaderRunSuspendedError) {
        await this.runtime.checkpoints
          ?.discardPending(current.id, current.attemptNo, claim)
          .catch(() => undefined);
        const atomicSuspension = this.runtime.executionQueue?.suspendRunForDelegation;
        if (atomicSuspension) {
          await atomicSuspension.call(this.runtime.executionQueue, {
            runId: current.id,
            delegationId: error.delegationId,
            expectedRunVersion: current.version,
            ...(claim ? { claim } : {}),
          });
          current = (await this.runs.get(current.id)) ?? current;
        } else {
          current = await this.#setStatus(current, "WAITING_AGENT", {
            delegationId: error.delegationId,
          });
          await this.#appendRunEvent({
            timestamp: this.now(),
            runId: current.id,
            type: "run.suspended",
            data: {
              status: "WAITING_AGENT",
              delegationId: error.delegationId,
            },
          });
        }
      } else if (controller?.signal.aborted) {
        await this.#finishLocallyCancelledRun(current, "run cancelled");
      } else {
        await this.#finishFailed(current, error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      this.#active.delete(run.id);
      for (const [interactionId, interaction] of this.#pendingLeaderInteractions) {
        if (interaction.runId === run.id) {
          this.#pendingLeaderInteractions.delete(interactionId);
        }
      }
      leaderLease?.release();
      if (dirtyLeader) {
        await this.#leaderCache.evict(run.sessionId);
      }
      if (claim && this.#executionClaims.get(run.id) === claim) {
        this.#executionClaims.delete(run.id);
      }
      this.#persistentWaiting.delete(run.id);
    }
  }

  /** 只从可信 Run 快照和执行凭证构造计划归属，模型不能覆盖这些字段。 */
  #taskPlanContext(
    run: Run,
    metadata: Record<string, unknown>,
  ): TaskPlanExecutionContext | undefined {
    if (!this.#taskPlans) {
      return undefined;
    }
    const sessionId = run.ingressContext?.externalSessionId?.trim();
    const messageId = run.ingressContext?.parentMessageId?.trim();
    const beyondToken = readBeyondToken(metadata);
    if (!sessionId || !messageId || !beyondToken) {
      return undefined;
    }
    return {
      beyondToken,
      sessionId,
      messageId,
      ...(run.ingressContext?.traceId
        ? { traceId: run.ingressContext.traceId }
        : {}),
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: run.id,
    };
  }

  async #cancelTaskPlan(
    run: Run,
    reason: string,
    beyondToken?: string,
  ): Promise<void> {
    if (!this.#taskPlans) {
      return;
    }
    const metadata = {
      ...(this.#ephemeralMetadata.get(run.id) ?? {}),
      ...(beyondToken ? { "Beyond-Token": beyondToken } : {}),
    };
    const context = this.#taskPlanContext(run, metadata);
    if (!context) {
      return;
    }
    // 计划同步不能把已经成功的运行时取消反转成网关失败；标准 STOP_CHAT
    // 仍会由 BE 在 Gateway 返回后执行权威的 confirmCancellation。
    await this.#taskPlans.cancel({ context, reason }).catch(() => undefined);
  }

  /** Run 异常终止时把活动计划收敛到 FAILED，避免前端永久停留在执行中。 */
  async #failActiveTaskPlan(run: Run): Promise<void> {
    if (!this.#taskPlans) {
      return;
    }
    const metadata = this.#ephemeralMetadata.get(run.id) ?? {};
    const context = this.#taskPlanContext(run, metadata);
    if (!context) {
      return;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const snapshot = await this.#taskPlans.loadActive(context);
        if (!snapshot || snapshot.status !== "ACTIVE") {
          return;
        }
        const result = await this.#taskPlans.command({
          context,
          idempotencyKey: `run-failed:${run.id}:${snapshot.version}`,
          command: taskPlanCommandForRunFailure(snapshot),
        });
        if (!result.ok) {
          throw new Error(`${result.error.code}: ${result.error.message}`);
        }
        if (result.plan.status !== "ACTIVE") {
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to close task plan for failed Run ${run.id}`);
  }

  /**
   * 用户取消时由 cancelRun 在外部执行确认停止后收敛终态；其他本地 Abort 仍直接结束 Run。
   */
  async #finishLocallyCancelledRun(run: Run, reason: string): Promise<void> {
    const latest = await this.runs.get(run.id);
    if (latest?.status === "CANCELLING") {
      return;
    }
    await this.#finishCancelled(latest ?? run, reason);
  }

  /** 保存 Run 中间状态并发出统一状态事件。 */
  async #setStatus(run: Run, status: RunStatus, data: Record<string, JsonValue> = {}): Promise<Run> {
    const updated: Run = {
      ...run,
      status,
      executionStage:
        status === "WAITING_AGENT"
          ? "CONNECTOR_WAITING"
          : status === "WAITING_USER"
            ? "USER_INTERACTION_WAITING"
          : status === "SYNTHESIZING"
            ? "LEADER_SYNTHESIZING"
            : status === "RUNNING"
              ? "LEADER_RUNNING"
              : run.executionStage,
      version: run.version + 1,
      updatedAt: this.now(),
      ...(status === "RUNNING" && !run.startedAt ? { startedAt: this.now() } : {}),
    };
    await this.#saveRunWithEvent(updated, {
      timestamp: this.now(),
      runId: updated.id,
      type: "run.status",
      data: { status, ...data },
    });
    if (this.#executionClaims.has(updated.id)) {
      if (status === "WAITING_USER") {
        this.#persistentWaiting.add(updated.id);
        void this.#kickPersistentQueue();
      } else {
        this.#persistentWaiting.delete(updated.id);
      }
    }
    return updated;
  }

  /** 幂等地将 Run 收敛到 CANCELLED，并关闭事件流。 */
  async #finishCancelled(run: Run, reason: string): Promise<Run> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latest = (await this.runs.get(run.id)) ?? run;
      if (TERMINAL_RUN_STATUSES.has(latest.status)) {
        this.#ephemeralMetadata.delete(latest.id);
        this.events.close(latest.id);
        return latest;
      }
      const finished: Run = {
        ...latest,
        status: "CANCELLED",
        executionStage: "SETTLED",
        version: latest.version + 1,
        error: reason,
        updatedAt: this.now(),
        finishedAt: this.now(),
      };
      await this.runtime.checkpoints
        ?.discardPending(
          finished.id,
          finished.attemptNo,
          this.#executionClaims.get(finished.id),
        )
        .catch(() => undefined);
      try {
        await this.#saveRunWithEvent(finished, {
          timestamp: this.now(),
          runId: finished.id,
          type: "run.cancelled",
          data: { status: "CANCELLED", reason },
        });
        await this.runtime.credentials?.delete(finished.id).catch(() => undefined);
        this.#ephemeralMetadata.delete(finished.id);
        this.events.close(finished.id);
        return finished;
      } catch (error) {
        // claim/heartbeat 与取消可能同时推进 version；重读最新状态后再次尝试收敛。
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Run cancellation conflicted repeatedly: ${run.id}`);
  }

  /** 幂等地将 Run 收敛到 FAILED，并关闭事件流。 */
  async #finishFailed(run: Run, error: string): Promise<Run> {
    const latest = await this.runs.get(run.id);
    if (latest && TERMINAL_RUN_STATUSES.has(latest.status)) {
      this.#ephemeralMetadata.delete(latest.id);
      return latest;
    }
    const runToFail = latest ?? run;
    await this.#failActiveTaskPlan(runToFail).catch((taskPlanError) => {
      this.runtime.logger?.warn(
        {
          runId: runToFail.id,
          error:
            taskPlanError instanceof Error
              ? taskPlanError.message
              : String(taskPlanError),
        },
        "Run 失败后的任务计划收口同步失败",
      );
    });
    const finished: Run = {
      ...runToFail,
      status: "FAILED",
      executionStage: "SETTLED",
      version: runToFail.version + 1,
      error,
      updatedAt: this.now(),
      finishedAt: this.now(),
    };
    await this.runtime.checkpoints
      ?.discardPending(
        finished.id,
        finished.attemptNo,
        this.#executionClaims.get(finished.id),
      )
      .catch(() => undefined);
    try {
      const userMessage = userMessageForRunFailure(error);
      await this.#saveRunWithEvent(finished, {
        timestamp: this.now(),
        runId: finished.id,
        type: "run.failed",
        data: {
          status: "FAILED",
          error,
          ...(userMessage ? { userMessage } : {}),
        },
      });
    } catch (saveError) {
      const concurrent = await this.runs.get(finished.id);
      if (concurrent && TERMINAL_RUN_STATUSES.has(concurrent.status)) {
        this.#ephemeralMetadata.delete(concurrent.id);
        this.events.close(concurrent.id);
        return concurrent;
      }
      throw saveError;
    }
    await this.runtime.credentials?.delete(finished.id).catch(() => undefined);
    this.#ephemeralMetadata.delete(finished.id);
    this.events.close(finished.id);
    return finished;
  }

  /** PostgreSQL 走原子状态+事件事务，内存测试继续使用两个简单 Port。 */
  async #saveRunWithEvent(
    run: Run,
    event: Omit<RunEvent, "eventId">,
  ): Promise<RunEvent> {
    if (this.runs.saveWithEvent) {
      return this.runs.saveWithEvent(
        run,
        event,
        this.#executionClaims.get(run.id),
      );
    }
    await this.runs.save(run);
    return this.events.append(event);
  }

  async #appendRunEvent(
    event: Omit<RunEvent, "eventId">,
  ): Promise<RunEvent> {
    const claim = this.#executionClaims.get(event.runId);
    if (claim && this.events.appendForClaim) {
      return this.events.appendForClaim(event, claim);
    }
    return this.events.append(event);
  }

  async #waitForInteractionResponse(
    runId: string,
    interactionId: string,
    afterEventId: number,
    signal: AbortSignal,
  ): Promise<UserInteractionResponse> {
    for await (const event of this.events.stream(runId, afterEventId, signal)) {
      if (
        event.type === "interaction.responded" &&
        event.data.interactionId === interactionId
      ) {
        const action =
          event.data.action === "skip" || event.data.action === "cancel"
            ? event.data.action
            : "submit";
        const answers =
          event.data.answers &&
          typeof event.data.answers === "object" &&
          !Array.isArray(event.data.answers)
            ? event.data.answers
            : undefined;
        return {
          action,
          ...(answers ? { answers } : {}),
          ...(typeof event.data.text === "string"
            ? { text: event.data.text }
            : {}),
        };
      }
    }
    signal.throwIfAborted();
    throw new Error(`Interaction event stream ended: ${interactionId}`);
  }

  /** Resume 可能由另一实例消费；被唤醒的 lease owner 需重读其写入的最新凭证。 */
  async #reloadExecutionCredential(
    runId: string,
    metadata: Record<string, unknown>,
    claim: RunExecutionClaim | undefined,
  ): Promise<void> {
    if (!claim || !this.runtime.credentials) {
      return;
    }
    const credential = await this.runtime.credentials.loadForLease({
      runId,
      instanceId: claim.ownerInstanceId,
      fencingToken: claim.fencingToken,
    });
    if (!credential) {
      throw new Error("EXECUTION_CREDENTIAL_MISSING");
    }
    const currentMetadata = { ...metadata };
    Object.assign(metadata, credential.metadata ?? {}, currentMetadata, {
      "Beyond-Token": credential.secret,
    });
  }
}

function userMessageForRunFailure(error: string): string | undefined {
  if (error.startsWith(DOWNSTREAM_MODEL_FAILURE_PREFIX)) {
    return error.slice(DOWNSTREAM_MODEL_FAILURE_PREFIX.length).trim() || error;
  }
  return undefined;
}

function latestLeaderModel(run: Run) {
  return run.ingressContext?.leaderModel;
}

function validateInteractionQuestions(questions: UserInteractionQuestion[]): void {
  if (questions.length < 1 || questions.length > 4) {
    throw new Error("askUserQuestion requires 1-4 questions");
  }
  for (const question of questions) {
    if (!question.header.trim() || !question.question.trim()) {
      throw new Error("Each user interaction question requires a header and question");
    }
    if (question.options.length < 2 || question.options.length > 4) {
      throw new Error("Each user interaction question requires 2-4 options");
    }
  }
}

function toLegacyFormPayload(
  questions: UserInteractionQuestion[],
): Record<string, JsonValue> {
  return {
    formStatus: 0,
    humanTool: true,
    pluginMachineFields: questions.map((question, index) => ({
      formType: question.multiSelect ? "textarea" : "select",
      fieldName: question.header,
      fieldCode: `answer_${index + 1}`,
      description: question.multiSelect
        ? `${question.question}\n可多选：${question.options
            .map((option) => option.label)
            .join("、")}`
        : question.question,
      required: true,
      ...(question.multiSelect
        ? {}
        : {
            optional: question.options.map((option) => ({
              label: option.label,
              value: option.value ?? option.label,
              description: option.description,
            })),
          }),
    })),
  };
}

function isUserInteractionResponse(value: UserInteractionResponse): boolean {
  return (
    value.action === "submit" ||
    value.action === "skip" ||
    value.action === "cancel"
  );
}

function validateAgentList(agentList: AgentProfile[]): void {
  const seen = new Set<string>();
  for (const agent of agentList) {
    if (seen.has(agent.id)) {
      throw new Error(`Duplicate agent id: ${agent.id}`);
    }
    seen.add(agent.id);
  }
}

function taskPlanCommandForRunFailure(snapshot: TaskPlanSnapshot): TaskPlanCommand {
  if (!snapshot.tasks.some(({ status }) => status === "IN_PROGRESS")) {
    throw new Error("Active task plan has no unfinished task to close");
  }
  return {
    action: "fail_current",
    statusReason: {
      code: "RUN_FAILED",
      message: "运行失败，任务计划已自动收口",
    },
  };
}

/** 从 Run 执行上下文 metadata 中读取短期 Beyond-Token；缺失或非字符串返回空串。 */
function readBeyondToken(metadata: Record<string, unknown>): string {
  const value = metadata["Beyond-Token"];
  return typeof value === "string" ? value.trim() : "";
}

/** 凭证单独保存 Beyond-Token，其他入口 metadata 随 lease 受保护地持久化。 */
function persistedExecutionMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const persisted = structuredClone(metadata ?? {});
  delete persisted["Beyond-Token"];
  return persisted;
}
