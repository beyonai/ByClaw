import type {
  DelegationRepository,
  RunEventStore,
  RunRepository,
  ThreadRepository,
} from "./repositories.js";
import type { Delegation, Run, RunEvent, Thread } from "./types.js";

/** 开发闭环使用的 Thread 内存仓库；所有读写都复制对象，避免调用方意外修改存储。 */
export class InMemoryThreadRepository implements ThreadRepository {
  readonly #items = new Map<string, Thread>();

  /** 保存 Thread 的结构化副本。 */
  async save(thread: Thread): Promise<void> {
    this.#items.set(thread.id, structuredClone(thread));
  }

  /** 返回 Thread 的结构化副本。 */
  async get(threadId: string): Promise<Thread | undefined> {
    const item = this.#items.get(threadId);
    return item ? structuredClone(item) : undefined;
  }
}

/** 开发闭环使用的 Run 内存仓库。 */
export class InMemoryRunRepository implements RunRepository {
  readonly #items = new Map<string, Run>();

  /** 保存 Run 的结构化副本。 */
  async save(run: Run): Promise<void> {
    this.#items.set(run.id, structuredClone(run));
  }

  /** 返回 Run 的结构化副本。 */
  async get(runId: string): Promise<Run | undefined> {
    const item = this.#items.get(runId);
    return item ? structuredClone(item) : undefined;
  }

  /** 返回某个 Thread 的 Run，并保持创建顺序。 */
  async listByThread(threadId: string): Promise<Run[]> {
    return [...this.#items.values()]
      .filter((run) => run.threadId === threadId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((run) => structuredClone(run));
  }
}

/** 开发闭环使用的 Delegation 内存仓库。 */
export class InMemoryDelegationRepository implements DelegationRepository {
  readonly #items = new Map<string, Delegation>();

  /** 保存 Delegation 的结构化副本。 */
  async save(delegation: Delegation): Promise<void> {
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
