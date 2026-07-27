import type {
  ExecutionCredentialRepository,
  IngressSessionBindingRepository,
  DelegationRepository,
  RunExecutionClaim,
  RunExecutionQueue,
  RunEventStore,
  RunPage,
  RunRepository,
  SessionRepository,
} from "./repositories.js";
import type { ExecutionCredential } from "./execution-credentials.js";
import type {
  CallerPrincipal,
  Delegation,
  Run,
  RunEvent,
  Session,
} from "./types.js";

/** 开发闭环使用的 Session 内存仓库；所有读写都复制对象，避免调用方意外修改存储。 */
export class InMemorySessionRepository implements SessionRepository {
  readonly #items = new Map<string, Session>();

  /** 保存 Session 的结构化副本。 */
  async save(session: Session): Promise<void> {
    this.#items.set(session.id, structuredClone(session));
  }

  /** 返回 Session 的结构化副本。 */
  async get(sessionId: string): Promise<Session | undefined> {
    const item = this.#items.get(sessionId);
    return item ? structuredClone(item) : undefined;
  }

  /** owner 不匹配时与不存在使用相同结果。 */
  async getOwned(
    sessionId: string,
    owner: CallerPrincipal,
  ): Promise<Session | undefined> {
    const session = await this.get(sessionId);
    return session?.owner.userCode === owner.userCode ? session : undefined;
  }

  /** 删除 Session；不存在时保持幂等。 */
  async delete(sessionId: string): Promise<void> {
    this.#items.delete(sessionId);
  }
}

/** 开发闭环使用的 Run 内存仓库。 */
export class InMemoryRunRepository implements RunRepository {
  readonly #items = new Map<string, Run>();

  constructor(private readonly sessions: SessionRepository) {}

  /** 保存 Run 的结构化副本。 */
  async save(run: Run): Promise<void> {
    this.#items.set(run.id, structuredClone(run));
  }

  /** 返回 Run 的结构化副本。 */
  async get(runId: string): Promise<Run | undefined> {
    const item = this.#items.get(runId);
    return item ? structuredClone(item) : undefined;
  }

  /** 返回某个 Session 的 Run，并保持创建顺序。 */
  async listBySession(sessionId: string): Promise<Run[]> {
    return [...this.#items.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((run) => structuredClone(run));
  }

  async listPageBySession(input: {
    sessionId: string;
    limit: number;
    before?: { createdAt: number; runId: string };
  }): Promise<RunPage> {
    const descending = [...this.#items.values()]
      .filter(
        (run) =>
          run.sessionId === input.sessionId &&
          (!input.before ||
            run.createdAt < input.before.createdAt ||
            (run.createdAt === input.before.createdAt &&
              run.id < input.before.runId)),
      )
      .sort(
        (a, b) =>
          b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      );
    const hasMore = descending.length > input.limit;
    return {
      runs: descending
        .slice(0, input.limit)
        .reverse()
        .map((run) => structuredClone(run)),
      hasMore,
    };
  }

  /** 通过 Session owner 进行关联授权查询。 */
  async getOwned(
    runId: string,
    owner: CallerPrincipal,
  ): Promise<Run | undefined> {
    const run = await this.get(runId);
    if (!run || !(await this.sessions.getOwned(run.sessionId, owner))) {
      return undefined;
    }
    return run;
  }
}

/** 开发闭环使用的 Delegation 内存仓库。 */
export class InMemoryDelegationRepository implements DelegationRepository {
  readonly #items = new Map<string, Delegation>();

  /** 保存 Delegation 的结构化副本。 */
  async save(delegation: Delegation, _claim?: RunExecutionClaim): Promise<void> {
    this.#items.set(delegation.id, structuredClone(delegation));
  }

  /** 返回 Delegation 的结构化副本。 */
  async get(delegationId: string): Promise<Delegation | undefined> {
    const item = this.#items.get(delegationId);
    return item ? structuredClone(item) : undefined;
  }

  /** 返回某个 Run 的全部 Delegation，并保持创建顺序。 */
  async listByRun(runId: string): Promise<Delegation[]> {
    return [...this.#items.values()]
      .filter((delegation) => delegation.runId === runId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((delegation) => structuredClone(delegation));
  }
}

type StreamWaiter = {
  push(event: RunEvent): void;
  finish(): void;
};

/** 支持历史回放和实时订阅的 Run 事件内存存储。 */
export class InMemoryRunEventStore implements RunEventStore {
  readonly #events = new Map<string, RunEvent[]>();
  readonly #waiters = new Map<string, Set<StreamWaiter>>();
  readonly #closed = new Set<string>();

  /** 追加事件、分配序号，并同步通知当前订阅者。 */
  async append(event: Omit<RunEvent, "eventId">): Promise<RunEvent> {
    const events = this.#events.get(event.runId) ?? [];
    const stored: RunEvent = { ...event, eventId: (events.at(-1)?.eventId ?? 0) + 1 };
    events.push(stored);
    this.#events.set(event.runId, events);
    for (const waiter of this.#waiters.get(event.runId) ?? []) {
      waiter.push(stored);
    }
    return structuredClone(stored);
  }

  /** 读取指定序号之后的事件快照。 */
  async list(runId: string, afterEventId = 0): Promise<RunEvent[]> {
    return (this.#events.get(runId) ?? [])
      .filter((event) => event.eventId > afterEventId)
      .map((event) => structuredClone(event));
  }

  /** 原子建立“历史回放 + 后续推送”订阅，避免建立 SSE 时遗漏事件。 */
  async *stream(runId: string, afterEventId = 0, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const queue = await this.list(runId, afterEventId);
    let finished = this.#closed.has(runId);
    let wake: (() => void) | undefined;
    // 唤醒当前等待新事件的异步迭代器。
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const waiter: StreamWaiter = {
      push: (event) => {
        if (event.eventId > afterEventId) {
          queue.push(structuredClone(event));
          notify();
        }
      },
      finish: () => {
        finished = true;
        notify();
      },
    };
    const waiters = this.#waiters.get(runId) ?? new Set<StreamWaiter>();
    waiters.add(waiter);
    this.#waiters.set(runId, waiters);
    // 仅结束当前订阅，不关闭 Run，也不影响其他订阅者。
    const onAbort = () => {
      finished = true;
      notify();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (!finished || queue.length > 0) {
        const event = queue.shift();
        if (event) {
          afterEventId = event.eventId;
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (finished || signal?.aborted) {
            notify();
          }
        });
      }
    } finally {
      waiters.delete(waiter);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** 结束一个 Run 的全部当前及未来订阅。 */
  close(runId: string): void {
    this.#closed.add(runId);
    for (const waiter of this.#waiters.get(runId) ?? []) {
      waiter.finish();
    }
  }
}

/** 测试与本地开发使用的入站 Session 映射。 */
export class InMemoryIngressSessionBindingRepository
implements IngressSessionBindingRepository {
  readonly #items = new Map<string, string>();

  async get(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
  }): Promise<string | undefined> {
    return this.#items.get(bindingKey(input));
  }

  async bind(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
    sessionId: string;
    now: number;
  }): Promise<void> {
    this.#items.set(bindingKey(input), input.sessionId);
  }
}

/**
 * 单进程测试队列。它同样执行 Session 级互斥和单调 fencing，
 * 让 RunService 的测试语义尽量贴近 PostgreSQL 实现。
 */
export class InMemoryRunExecutionQueue implements RunExecutionQueue {
  readonly #queued: Run[] = [];
  readonly #activeSessions = new Set<string>();
  readonly #fencing = new Map<string, number>();

  async enqueue(run: Run): Promise<void> {
    if (!this.#queued.some((candidate) => candidate.id === run.id)) {
      this.#queued.push(structuredClone(run));
      this.#queued.sort((left, right) => left.createdAt - right.createdAt);
    }
  }

  async claimNext(
    instanceId: string,
    leaseMs: number,
  ): Promise<RunExecutionClaim | undefined> {
    const index = this.#queued.findIndex(
      (run) => !this.#activeSessions.has(run.sessionId),
    );
    if (index < 0) {
      return undefined;
    }
    const [run] = this.#queued.splice(index, 1);
    if (!run) {
      return undefined;
    }
    const fencingToken = (this.#fencing.get(run.sessionId) ?? 0) + 1;
    this.#fencing.set(run.sessionId, fencingToken);
    this.#activeSessions.add(run.sessionId);
    return {
      runId: run.id,
      sessionId: run.sessionId,
      ownerInstanceId: instanceId,
      attemptNo: run.attemptNo + 1,
      fencingToken,
      leaseExpiresAt: Date.now() + leaseMs,
    };
  }

  async heartbeat(claim: RunExecutionClaim, leaseMs: number): Promise<boolean> {
    const current = this.#fencing.get(claim.sessionId);
    if (current !== claim.fencingToken || !this.#activeSessions.has(claim.sessionId)) {
      return false;
    }
    claim.leaseExpiresAt = Date.now() + leaseMs;
    return true;
  }

  async release(claim: RunExecutionClaim): Promise<void> {
    if (this.#fencing.get(claim.sessionId) === claim.fencingToken) {
      this.#activeSessions.delete(claim.sessionId);
    }
  }
}

/** 仅用于单元测试的短期执行凭证仓库。 */
export class InMemoryExecutionCredentialRepository
implements ExecutionCredentialRepository {
  readonly #items = new Map<string, ExecutionCredential>();

  async save(credential: ExecutionCredential): Promise<void> {
    this.#items.set(credential.runId, structuredClone(credential));
  }

  async loadForLease(input: {
    runId: string;
    instanceId: string;
    fencingToken: number;
    now: number;
  }): Promise<ExecutionCredential | undefined> {
    const item = this.#items.get(input.runId);
    return item && item.expiresAt > input.now
      ? structuredClone(item)
      : undefined;
  }

  async delete(runId: string): Promise<void> {
    this.#items.delete(runId);
  }

  async deleteExpired(now: number): Promise<number> {
    let deleted = 0;
    for (const [runId, credential] of this.#items) {
      if (credential.expiresAt <= now) {
        this.#items.delete(runId);
        deleted += 1;
      }
    }
    return deleted;
  }
}

function bindingKey(input: {
  source: string;
  userCode: string;
  externalSessionId: string;
}): string {
  return JSON.stringify([input.source, input.userCode, input.externalSessionId]);
}
