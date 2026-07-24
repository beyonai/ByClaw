import { randomUUID } from "node:crypto";
import { DelegationService } from "./delegation-service.js";
import type { EnvelopeExecutionCredentialCipher } from "./execution-credentials.js";
import type { LeaderSession, LeaderSessionFactory } from "./leader.js";
import { LeaderSessionCache } from "./leader-session-cache.js";
import type {
  DelegationRepository,
  ExecutionCredentialRepository,
  LeaderCheckpointStore,
  RunEventStore,
  RunExecutionClaim,
  RunExecutionQueue,
  RunRepository,
  SessionRepository,
} from "./repositories.js";
import type {
  AgentProfile,
  CallerPrincipal,
  JsonValue,
  Run,
  RunEvent,
  RunStatus,
  Session,
} from "./types.js";
import { TERMINAL_RUN_STATUSES } from "./types.js";

export interface CreateSessionInput {
  owner: CallerPrincipal;
}

export interface CreateRunInput {
  sessionId: string;
  message: string;
  agentList: AgentProfile[];
  metadata?: Record<string, unknown>;
  /** 只在 ingress 到 KMS seal 的短暂调用链中存在，绝不写入 Run/Event/Pi。 */
  executionCredential?: {
    secret: string;
    expiresAt: number;
  };
}

export interface CreateSessionRunInput extends CreateSessionInput {
  message: string;
  agentList: AgentProfile[];
  metadata?: Record<string, unknown>;
  executionCredential?: {
    secret: string;
    expiresAt: number;
  };
}

type QueueEntry = { runId: string; metadata: Record<string, unknown> };
type SessionQueue = { running: boolean; entries: QueueEntry[] };
type ActiveRun = { controller: AbortController; leader: LeaderSession };

export interface RunServiceRuntimeOptions {
  executionQueue?: RunExecutionQueue;
  checkpoints?: LeaderCheckpointStore;
  credentials?: ExecutionCredentialRepository;
  credentialCipher?: EnvelopeExecutionCredentialCipher;
  instanceId?: string;
  leaseMs?: number;
  queuePollMs?: number;
  maxConcurrentRuns?: number;
  leaderCacheMaxEntries?: number;
  leaderCacheIdleTtlMs?: number;
  /** 清理已过期 KMS 密文凭证的周期；默认 60 秒。 */
  credentialCleanupIntervalMs?: number;
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
  readonly #inFlightClaims = new Set<Promise<void>>();
  readonly #instanceId: string;
  readonly #leaseMs: number;
  readonly #queuePollMs: number;
  readonly #maxConcurrentRuns: number;
  readonly #credentialCleanupIntervalMs: number;
  #persistentActive = 0;
  #claimLoop: Promise<void> | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #credentialCleanupTimer: ReturnType<typeof setInterval> | undefined;
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
    this.#credentialCleanupIntervalMs =
      runtime.credentialCleanupIntervalMs ?? 60_000;
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
      void this.#kickPersistentQueue();
    }, this.#queuePollMs);
    this.#pollTimer.unref?.();
    if (this.runtime.credentials) {
      this.#credentialCleanupTimer = setInterval(() => {
        void this.runtime.credentials
          ?.deleteExpired(this.now())
          .catch(() => undefined);
      }, this.#credentialCleanupIntervalMs);
      this.#credentialCleanupTimer.unref?.();
      void this.runtime.credentials.deleteExpired(this.now()).catch(() => undefined);
    }
    void this.#kickPersistentQueue();
  }

  /** 创建会话容器；Session 本身不立即初始化模型 Session。 */
  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = this.now();
    const session: Session = {
      id: this.createId(),
      owner: structuredClone(input.owner),
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

  /** 回滚尚未创建任何 Run 的 Session；已被使用的 Session 不允许删除。 */
  async deleteEmptySession(sessionId: string): Promise<void> {
    if ((await this.runs.listBySession(sessionId)).length > 0) {
      throw new Error(`Cannot delete non-empty Session: ${sessionId}`);
    }
    await this.sessions.delete(sessionId);
  }

  /** 首个入口原子创建业务 Session、Run、run.created 和执行凭证密文。 */
  async createSessionRun(input: CreateSessionRunInput): Promise<Run> {
    validateAgentList(input.agentList);
    const now = this.now();
    const session: Session = {
      id: this.createId(),
      owner: structuredClone(input.owner),
      contextRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const run: Run = {
      id: this.createId(),
      sessionId: session.id,
      input: input.message,
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
    const credential =
      input.executionCredential && this.runtime.credentialCipher
        ? await this.runtime.credentialCipher.seal({
            runId: run.id,
            userCode: session.owner.userCode,
            secret: input.executionCredential.secret,
            expiresAt: input.executionCredential.expiresAt,
          })
        : undefined;
    const credentialRepository = this.runtime.credentials;
    if (credential && !credentialRepository) {
      throw new Error("Execution credential repository is not configured");
    }
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
    const encryptedCredential =
      input.executionCredential && this.runtime.credentialCipher
        ? await this.runtime.credentialCipher.seal({
            runId: run.id,
            userCode: session.owner.userCode,
            secret: input.executionCredential.secret,
            expiresAt: input.executionCredential.expiresAt,
          })
        : undefined;
    if (encryptedCredential && !this.runtime.credentials) {
      throw new Error("Execution credential repository is not configured");
    }
    if (this.runs.createWithEvent) {
      await this.runs.createWithEvent(run, createdEvent, encryptedCredential);
    } else {
      await this.runs.save(run);
      if (encryptedCredential) {
        if (!this.runtime.credentials) {
          throw new Error("Execution credential repository is not configured");
        }
        await this.runtime.credentials.save(encryptedCredential);
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
   * 取消排队中或执行中的 Run。
   * 执行中会先进入 CANCELLING，再同时中止 Leader、工具信号和活动 Connector。
   */
  async cancelRun(runId: string, reason = "user requested cancellation"): Promise<Run | undefined> {
    const run = await this.runs.get(runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
      return run;
    }
    if (run.status === "QUEUED" || run.status === "CREATED") {
      return this.#finishCancelled(run, reason);
    }

    const cancelling = await this.#requestCancelling(run, reason);
    if (TERMINAL_RUN_STATUSES.has(cancelling.status)) {
      return cancelling;
    }
    const active = this.#active.get(runId);
    active?.controller.abort(new Error(reason));
    await Promise.allSettled([
      active?.leader.abort() ?? Promise.resolve(),
      this.delegationService.cancelRun(runId, reason),
    ]);
    return this.#finishCancelled(cancelling, reason);
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
    if (this.#credentialCleanupTimer) {
      clearInterval(this.#credentialCleanupTimer);
      this.#credentialCleanupTimer = undefined;
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
        this.#persistentActive < this.#maxConcurrentRuns
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
    queue.entries.push({ runId: run.id, metadata: metadata ?? {} });
    this.#queues.set(run.sessionId, queue);
    void this.#pump(run.sessionId);
  }

  /** 读取经过 lease 校验的密文凭证，执行完成后释放当前 Session lease。 */
  async #executeClaim(claim: RunExecutionClaim): Promise<void> {
    const queue = this.runtime.executionQueue;
    if (!queue) {
      return;
    }
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
      if (this.runtime.credentials && this.runtime.credentialCipher) {
        const session = await this.sessions.get(run.sessionId);
        if (!session) {
          await this.#finishFailed(run, `Session not found: ${run.sessionId}`);
          return;
        }
        const encrypted = await this.runtime.credentials.loadForLease({
          runId: run.id,
          instanceId: claim.ownerInstanceId,
          fencingToken: claim.fencingToken,
          now: this.now(),
        });
        if (!encrypted) {
          await this.#finishFailed(run, "EXECUTION_CREDENTIAL_EXPIRED");
          return;
        }
        const secret = await this.runtime.credentialCipher.open(
          encrypted,
          session.owner.userCode,
        );
        metadata = { "Beyond-Token": secret };
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
    } finally {
      if (this.#executionClaims.get(claim.runId) === claim) {
        this.#executionClaims.delete(claim.runId);
      }
      this.#ephemeralMetadata.delete(claim.runId);
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
      leaderLease = await this.#leaderCache.acquire(session.id);
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
      current = await this.#setStatus(latest, "RUNNING");
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
      const result = await leader.run({
        message: current.input,
        agents: current.agentList,
        signal: runController.signal,
        // Leader 的可见回答增量被规范化为 Run 事件，供 SSE 消费。
        onDelta: async (text) => {
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
          current = await this.#setStatus(current, "WAITING_AGENT");
          const delegated = await this.delegationService.execute({
            session,
            runId: current.id,
            agents: current.agentList,
            agentId: delegationInput.agentId,
            task: delegationInput.task,
            ...(delegationInput.expectedOutput
              ? { expectedOutput: delegationInput.expectedOutput }
              : {}),
            metadata,
            signal: delegationInput.signal ?? runController.signal,
            ...(claim ? { leaseClaim: claim } : {}),
            ...(recoveringStage === "LEADER_SYNTHESIZING"
              ? { reuseCompleted: true }
              : {}),
          });
          if (!runController.signal.aborted) {
            current = await this.#setStatus(current, "SYNTHESIZING");
          }
          return delegated;
        },
      });

      if (runController.signal.aborted) {
        await this.#finishCancelled(current, "run cancelled");
        return;
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
      this.events.close(finished.id);
    } catch (error) {
      if (controller?.signal.aborted) {
        await this.#finishCancelled(current, "run cancelled");
      } else {
        await this.#finishFailed(current, error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      this.#active.delete(run.id);
      leaderLease?.release();
      if (dirtyLeader) {
        await this.#leaderCache.evict(run.sessionId);
      }
      if (claim && this.#executionClaims.get(run.id) === claim) {
        this.#executionClaims.delete(run.id);
      }
    }
  }

  /** 保存 Run 中间状态并发出统一状态事件。 */
  async #setStatus(run: Run, status: RunStatus, data: Record<string, JsonValue> = {}): Promise<Run> {
    const updated: Run = {
      ...run,
      status,
      executionStage:
        status === "WAITING_AGENT"
          ? "CONNECTOR_WAITING"
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
    return updated;
  }

  /** 幂等地将 Run 收敛到 CANCELLED，并关闭事件流。 */
  async #finishCancelled(run: Run, reason: string): Promise<Run> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latest = (await this.runs.get(run.id)) ?? run;
      if (TERMINAL_RUN_STATUSES.has(latest.status)) {
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
      return latest;
    }
    const finished: Run = {
      ...(latest ?? run),
      status: "FAILED",
      executionStage: "SETTLED",
      version: (latest ?? run).version + 1,
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
      await this.#saveRunWithEvent(finished, {
        timestamp: this.now(),
        runId: finished.id,
        type: "run.failed",
        data: { status: "FAILED", error },
      });
    } catch (saveError) {
      const concurrent = await this.runs.get(finished.id);
      if (concurrent && TERMINAL_RUN_STATUSES.has(concurrent.status)) {
        this.events.close(concurrent.id);
        return concurrent;
      }
      throw saveError;
    }
    await this.runtime.credentials?.delete(finished.id).catch(() => undefined);
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
