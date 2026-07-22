import type { Delegation, Run, RunEvent, Thread } from "./types.js";

export interface ThreadRepository {
  /** 新建或覆盖保存 Thread。 */
  save(thread: Thread): Promise<void>;
  /** 按 ID 读取 Thread，不存在时返回 undefined。 */
  get(threadId: string): Promise<Thread | undefined>;
}

export interface RunRepository {
  /** 新建或覆盖保存 Run。 */
  save(run: Run): Promise<void>;
  /** 按 ID 读取 Run。 */
  get(runId: string): Promise<Run | undefined>;
  /** 按创建时间返回指定 Thread 下的 Run。 */
  listByThread(threadId: string): Promise<Run[]>;
}

export interface DelegationRepository {
  /** 新建或覆盖保存一次子 Agent 委派。 */
  save(delegation: Delegation): Promise<void>;
  /** 按 ID 读取 Delegation。 */
  get(delegationId: string): Promise<Delegation | undefined>;
  /** 按创建时间返回指定 Run 下的全部 Delegation。 */
  listByRun(runId: string): Promise<Delegation[]>;
}

export interface RunEventStore {
  /** 为 Run 追加事件，并由存储层分配单调递增的事件 ID。 */
  append(event: Omit<RunEvent, "eventId">): Promise<RunEvent>;
  /** 查询指定事件 ID 之后的历史事件，用于 SSE 回放。 */
  list(runId: string, afterEventId?: number): Promise<RunEvent[]>;
  /** 先回放历史事件，再持续输出新事件，直到 Run 关闭或订阅被取消。 */
  stream(runId: string, afterEventId?: number, signal?: AbortSignal): AsyncIterable<RunEvent>;
  /** 标记 Run 事件流已经终结，并唤醒所有等待中的订阅者。 */
  close(runId: string): void;
}
