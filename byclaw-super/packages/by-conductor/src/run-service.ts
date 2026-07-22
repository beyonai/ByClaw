import { randomUUID } from "node:crypto";
import { DelegationService } from "./delegation-service.js";
import type { LeaderSession, LeaderSessionFactory } from "./leader.js";
import type {
  DelegationRepository,
  RunEventStore,
  RunRepository,
  ThreadRepository,
} from "./repositories.js";
import type { AgentProfile, JsonValue, Run, RunEvent, RunStatus, Thread } from "./types.js";
import { TERMINAL_RUN_STATUSES } from "./types.js";

export interface CreateThreadInput {
  tenantId: string;
  userCode: string;
  userName?: string;
}

export interface CreateRunInput {
  threadId: string;
  message: string;
  agentList: AgentProfile[];
  metadata?: Record<string, unknown>;
}

type QueueEntry = { runId: string; metadata: Record<string, unknown> };
type ThreadQueue = { running: boolean; entries: QueueEntry[] };
type ActiveRun = { controller: AbortController; leader: LeaderSession };

/**
 * 编排 Thread 与 Run 的生命周期，并保证同一 Thread 串行、不同 Thread 并行。
 * 每个 Thread 复用一个 Leader Session，以保留连续对话上下文。
 */
export class RunService {
  readonly #queues = new Map<string, ThreadQueue>();
  readonly #sessions = new Map<string, Promise<LeaderSession>>();
  readonly #active = new Map<string, ActiveRun>();

  /** 注入内存或持久化 Port、委派服务及 Leader Session 工厂。 */
  constructor(
    private readonly threads: ThreadRepository,
    private readonly runs: RunRepository,
    private readonly delegations: DelegationRepository,
    private readonly events: RunEventStore,
    private readonly delegationService: DelegationService,
    private readonly leaders: LeaderSessionFactory,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  /** 创建会话容器；Thread 本身不立即初始化模型 Session。 */
  async createThread(input: CreateThreadInput): Promise<Thread> {
    const now = this.now();
    const thread: Thread = {
      id: this.createId(),
      tenantId: input.tenantId,
      userCode: input.userCode,
      ...(input.userName ? { userName: input.userName } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await this.threads.save(thread);
    return thread;
  }

  /**
   * 创建 Run 并加入所属 Thread 的 FIFO 队列。
   * Agent 列表会被快照，后续委派只能使用本次 Run 明确授权的 Agent。
   */
  async createRun(input: CreateRunInput): Promise<Run> {
    const thread = await this.threads.get(input.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${input.threadId}`);
    }
    const seen = new Set<string>();
    for (const agent of input.agentList) {
      if (seen.has(agent.id)) {
        throw new Error(`Duplicate agent id: ${agent.id}`);
      }
      seen.add(agent.id);
    }

    const now = this.now();
    const run: Run = {
      id: this.createId(),
      threadId: thread.id,
      input: input.message,
      agentList: structuredClone(input.agentList),
      status: "QUEUED",
      createdAt: now,
      updatedAt: now,
    };
    await this.runs.save(run);
    await this.events.append({
      timestamp: now,
      threadId: thread.id,
      runId: run.id,
      type: "run.created",
      data: { status: "QUEUED" },
    });

    const queue = this.#queues.get(thread.id) ?? { running: false, entries: [] };
    queue.entries.push({ runId: run.id, metadata: input.metadata ?? {} });
    this.#queues.set(thread.id, queue);
    void this.#pump(thread.id);
    return run;
  }

  /** 查询 Run 当前快照。 */
  async getRun(runId: string): Promise<Run | undefined> {
    return this.runs.get(runId);
  }

  /** 查询 Run 所属 Thread 的 userCode，供外层订阅接口执行身份校验。 */
  async getRunUserCode(runId: string): Promise<string | undefined> {
    const run = await this.runs.get(runId);
    if (!run) {
      return undefined;
    }
    const thread = await this.threads.get(run.threadId);
    return thread?.userCode;
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

    const cancelling = await this.#setStatus(run, "CANCELLING", { reason });
    const active = this.#active.get(runId);
    active?.controller.abort(new Error(reason));
    await Promise.allSettled([
      active?.leader.abort() ?? Promise.resolve(),
      this.delegationService.cancelRun(runId, reason),
    ]);
    return this.#finishCancelled(cancelling, reason);
  }

  /** 返回 Leader 模型运行时的就绪状态。 */
  async health(): Promise<{ healthy: boolean; message?: string; model?: string }> {
    return this.leaders.health();
  }

  /** 中止活动 Run 并释放所有已创建的 Thread Session。 */
  async dispose(): Promise<void> {
    for (const active of this.#active.values()) {
      active.controller.abort(new Error("service shutting down"));
      await active.leader.abort().catch(() => undefined);
    }
    const sessions = await Promise.allSettled(this.#sessions.values());
    for (const result of sessions) {
      if (result.status === "fulfilled") {
        result.value.dispose();
      }
    }
  }

  /** 按 FIFO 逐个消费某个 Thread 的队列；其他 Thread 使用各自独立的泵。 */
  async #pump(threadId: string): Promise<void> {
    const queue = this.#queues.get(threadId);
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
        this.#queues.delete(threadId);
      }
    }
  }

  /** 执行单个 Run，连接 Leader 流式输出、委派调用和最终状态收敛。 */
  async #execute(run: Run, metadata: Record<string, unknown>): Promise<void> {
    const thread = await this.threads.get(run.threadId);
    if (!thread) {
      await this.#finishFailed(run, `Thread not found: ${run.threadId}`);
      return;
    }
    let current = run;
    let controller: AbortController | undefined;

    try {
      const leader = await this.#getLeader(thread.id);
      const latest = await this.runs.get(run.id);
      if (!latest || TERMINAL_RUN_STATUSES.has(latest.status)) {
        return;
      }
      current = await this.#setStatus(latest, "RUNNING");
      const runController = new AbortController();
      controller = runController;
      this.#active.set(run.id, { controller: runController, leader });
      const result = await leader.run({
        message: current.input,
        agents: current.agentList,
        signal: runController.signal,
        // Leader 的可见回答增量被规范化为 Run 事件，供 SSE 消费。
        onDelta: async (text) => {
          await this.events.append({
            timestamp: this.now(),
            threadId: thread.id,
            runId: current.id,
            type: "leader.delta",
            data: { text },
          });
        },
        // 工具调用只进入 DelegationService，不让 Pi 接触 Connector Registry。
        delegate: async (delegationInput) => {
          current = await this.#setStatus(current, "WAITING_AGENT");
          const delegated = await this.delegationService.execute({
            thread,
            runId: current.id,
            agents: current.agentList,
            agentId: delegationInput.agentId,
            task: delegationInput.task,
            ...(delegationInput.expectedOutput
              ? { expectedOutput: delegationInput.expectedOutput }
              : {}),
            metadata,
            signal: delegationInput.signal ?? runController.signal,
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
        finalAnswer: result.text,
        updatedAt: this.now(),
        finishedAt: this.now(),
      };
      await this.runs.save(finished);
      await this.events.append({
        timestamp: this.now(),
        threadId: thread.id,
        runId: finished.id,
        type: "run.completed",
        data: { status: "COMPLETED", finalAnswer: result.text },
      });
      this.events.close(finished.id);
    } catch (error) {
      if (controller?.signal.aborted) {
        await this.#finishCancelled(current, "run cancelled");
      } else {
        await this.#finishFailed(current, error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.#active.delete(run.id);
    }
  }

  /** 惰性创建并缓存 Thread 对应的 Leader Session。 */
  #getLeader(threadId: string): Promise<LeaderSession> {
    let session = this.#sessions.get(threadId);
    if (!session) {
      session = this.leaders.create(threadId);
      this.#sessions.set(threadId, session);
    }
    return session;
  }

  /** 保存 Run 中间状态并发出统一状态事件。 */
  async #setStatus(run: Run, status: RunStatus, data: Record<string, JsonValue> = {}): Promise<Run> {
    const updated: Run = {
      ...run,
      status,
      updatedAt: this.now(),
      ...(status === "RUNNING" && !run.startedAt ? { startedAt: this.now() } : {}),
    };
    await this.runs.save(updated);
    await this.events.append({
      timestamp: this.now(),
      threadId: updated.threadId,
      runId: updated.id,
      type: "run.status",
      data: { status, ...data },
    });
    return updated;
  }

  /** 幂等地将 Run 收敛到 CANCELLED，并关闭事件流。 */
  async #finishCancelled(run: Run, reason: string): Promise<Run> {
    const latest = await this.runs.get(run.id);
    if (latest && TERMINAL_RUN_STATUSES.has(latest.status)) {
      return latest;
    }
    const finished: Run = {
      ...(latest ?? run),
      status: "CANCELLED",
      error: reason,
      updatedAt: this.now(),
      finishedAt: this.now(),
    };
    await this.runs.save(finished);
    await this.events.append({
      timestamp: this.now(),
      threadId: finished.threadId,
      runId: finished.id,
      type: "run.cancelled",
      data: { status: "CANCELLED", reason },
    });
    this.events.close(finished.id);
    return finished;
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
      error,
      updatedAt: this.now(),
      finishedAt: this.now(),
    };
    await this.runs.save(finished);
    await this.events.append({
      timestamp: this.now(),
      threadId: finished.threadId,
      runId: finished.id,
      type: "run.failed",
      data: { status: "FAILED", error },
    });
    this.events.close(finished.id);
    return finished;
  }
}
