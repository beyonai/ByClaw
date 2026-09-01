import type { ExecutionCredential } from "../domain/execution-credentials.js";
import type { PiSessionCheckpoint } from "../pi-session-checkpoint.js";
import type {
  CallerPrincipal,
  Delegation,
  DelegationStatus,
  Run,
  RunExecutionStage,
  RunEvent,
  RunStatus,
  Session,
} from "../domain/types.js";

export interface SessionRepository {
  /** 新建或覆盖保存 Session。 */
  save(session: Session): Promise<void>;
  /** 按 ID 读取 Session，不存在时返回 undefined。 */
  get(sessionId: string): Promise<Session | undefined>;
  /** 在存储层同时校验 owner，避免敏感对象先被全局读取。 */
  getOwned(sessionId: string, owner: CallerPrincipal): Promise<Session | undefined>;
  /** 删除尚未对外可用的 Session，供内存原子创建失败时回滚。 */
  delete(sessionId: string): Promise<void>;
}

/** Session 历史翻页使用的稳定游标；createdAt 相同时用 Run ID 打破平局。 */
export interface RunPageCursor {
  createdAt: number;
  runId: string;
}

export interface RunPage {
  /** 按 createdAt、Run ID 正序返回，便于前端直接渲染。 */
  runs: Run[];
  hasMore: boolean;
}

export interface RunRepository {
  /** 新建或覆盖保存 Run。 */
  save(run: Run): Promise<void>;
  /**
   * 持久化实现应覆盖此方法，在同一事务执行乐观锁更新与事件追加。
   * 纯内存测试实现可以省略，由 RunService 使用 save + append 回退。
   */
  saveWithEvent?(
    run: Run,
    event: Omit<RunEvent, "eventId">,
    claim?: RunExecutionClaim,
  ): Promise<RunEvent>;
  /** PostgreSQL 实现用同一事务创建 Run、首事件及其执行凭证。 */
  createWithEvent?(
    run: Run,
    event: Omit<RunEvent, "eventId">,
    credential?: ExecutionCredential,
  ): Promise<RunEvent>;
  /** 首个入口用同一事务创建 Session、Run、首事件和执行凭证。 */
  createSessionWithRun?(
    session: Session,
    run: Run,
    event: Omit<RunEvent, "eventId">,
    credential?: ExecutionCredential,
  ): Promise<RunEvent>;
  /** 按 ID 读取 Run。 */
  get(runId: string): Promise<Run | undefined>;
  /** 按创建时间返回指定 Session 下的 Run。 */
  listBySession(sessionId: string): Promise<Run[]>;
  /** 从最新一页向更早历史翻页；limit 按 Run/对话轮次计算。 */
  listPageBySession(input: {
    sessionId: string;
    limit: number;
    before?: RunPageCursor;
  }): Promise<RunPage>;
  /** 按 owner 关联查询 Run，越权与不存在都返回 undefined。 */
  getOwned(runId: string, owner: CallerPrincipal): Promise<Run | undefined>;
}

export interface DelegationRepository {
  /** 新建或覆盖保存一次子 Agent 委派。 */
  save(delegation: Delegation, claim?: RunExecutionClaim): Promise<void>;
  /** PostgreSQL 用同一事务保存委派状态并追加其对外事件。 */
  saveWithEvent?(
    delegation: Delegation,
    event: Omit<RunEvent, "eventId">,
    claim?: RunExecutionClaim,
  ): Promise<RunEvent>;
  /** 按 ID 读取 Delegation。 */
  get(delegationId: string): Promise<Delegation | undefined>;
  /** 按创建时间返回指定 Run 下的全部 Delegation。 */
  listByRun(runId: string): Promise<Delegation[]>;
}

export interface RunEventStore {
  /** 为 Run 追加事件，并由存储层分配单调递增的事件 ID。 */
  append(event: Omit<RunEvent, "eventId">): Promise<RunEvent>;
  /** 执行期事件必须在同一事务验证当前 lease/fencing。 */
  appendForClaim?(
    event: Omit<RunEvent, "eventId">,
    claim: RunExecutionClaim,
  ): Promise<RunEvent>;
  /** 查询指定事件 ID 之后的历史事件，用于 SSE 回放。 */
  list(runId: string, afterEventId?: number): Promise<RunEvent[]>;
  /** 先回放历史事件，再持续输出新事件，直到 Run 关闭或订阅被取消。 */
  stream(runId: string, afterEventId?: number, signal?: AbortSignal): AsyncIterable<RunEvent>;
  /** 标记 Run 事件流已经终结，并唤醒所有等待中的订阅者。 */
  close(runId: string): void;
}

/** 外部入站 Session ID 到内部业务 Session 的持久映射。 */
export interface IngressSessionBindingRepository {
  get(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
  }): Promise<string | undefined>;
  bind(input: {
    source: string;
    userCode: string;
    externalSessionId: string;
    sessionId: string;
    now: number;
  }): Promise<void>;
}

/** 跨实例运行租约；fencingToken 是任何执行期写入必须携带的栅栏。 */
export interface RunExecutionClaim {
  runId: string;
  sessionId: string;
  ownerInstanceId: string;
  attemptNo: number;
  fencingToken: number;
  leaseExpiresAt: number;
}

/** 因回调超时而脱离 ResumeCommand 上下文的最终结果投递任务。 */
interface CallbackTimeoutDeliveryResult {
  runId: string;
  runStatus: "COMPLETED" | "FAILED" | "CANCELLED";
  finalAnswer?: string;
  error?: string;
}

export type CallbackTimeoutDelivery = CallbackTimeoutDeliveryResult &
  (
    | {
        externalSessionId: string;
        traceId: string;
        parentMessageId: string;
      }
    | {
        /** 部分存在的 by-framework 路由损坏时不得静默确认，保留 Outbox 供修复后重试。 */
        routingError: string;
        externalSessionId?: string;
        traceId?: string;
        parentMessageId?: string;
      }
  );

/**
 * 持久化层对一次终态回调的原子裁决。
 *
 * 单一 outcome 同时表达是否写入、为何忽略以及是否已把 Run 放回队列，调用方无需再组合
 * accepted/runId/wakeRun 三个可选状态。
 */
export type WaitingCallbackSettlementResult =
  | { outcome: "delegation_not_found" }
  | {
      outcome: "delegation_already_settled";
      runId: string;
      delegationStatus: DelegationStatus;
    }
  | { outcome: "callback_expired"; runId: string }
  | { outcome: "run_not_resumable"; runId: string; runStatus: RunStatus }
  | {
      outcome: "delegation_settled";
      runId: string;
      runStatus: RunStatus;
      executionStage: RunExecutionStage;
    }
  | { outcome: "run_resumed"; runId: string };

export interface RunExecutionQueue {
  /** 通知队列存在新工作；PostgreSQL 实现可使用 NOTIFY，本地实现直接入队。 */
  enqueue(run: Run): Promise<void>;
  /** 领取全局最早且其 Session 没有更早非终态 Run 的工作。 */
  claimNext(instanceId: string, leaseMs: number): Promise<RunExecutionClaim | undefined>;
  /** 续约成功表示调用方仍是当前 owner；false 表示必须立即停止写入。 */
  heartbeat(claim: RunExecutionClaim, leaseMs: number): Promise<boolean>;
  /** 仅当前 fencing owner 可以释放，避免旧实例删除新实例的租约。 */
  release(claim: RunExecutionClaim): Promise<void>;
  /**
   * 与终态 Resume 使用相同数据库锁，原子提交 WAITING_AGENT 和 run.suspended。
   * 若终态回调已经先到，只返回其 QUEUED 结果，禁止旧执行覆盖。
   */
  suspendRunForDelegation?(input: {
    runId: string;
    delegationId: string;
    expectedRunVersion: number;
    claim?: RunExecutionClaim;
  }): Promise<{ runStatus: Run["status"]; suspended: boolean }>;
  /**
   * 原子结算到期的外部回调并直接终结 WAITING_AGENT Run。
   * 超时不能依赖 Leader 再执行一次，否则恢复队列或模型异常会继续占住前端流。
   * 多实例实现必须使用行锁或等价 CAS，且状态、事件在同一事务提交。
   */
  expireWaitingCallbacks?(input: {
    limit: number;
  }): Promise<Array<{ runId: string; delegationId: string }>>;
  /** 与超时扫描使用同一锁协议，原子保存终态 Resume 并唤醒挂起 Run。 */
  settleWaitingCallback?(input: {
    delegationId: string;
    status: "COMPLETED" | "FAILED" | "CANCELLED";
    finalAnswer: string;
    /** false 时忽略历史 callback_deadline_at，用于临时关闭回调超时。 */
    enforceDeadline?: boolean;
  }): Promise<WaitingCallbackSettlementResult>;
  /** 领取已经到终态、但因没有 ResumeCommand 上下文而尚未对外投递的 Run。 */
  claimCallbackTimeoutDeliveries?(input: {
    instanceId: string;
    leaseMs: number;
    limit: number;
  }): Promise<CallbackTimeoutDelivery[]>;
  /** 投递成功后按 owner 确认；失败时不确认，租约到期后由任一实例重试。 */
  completeCallbackTimeoutDelivery?(input: {
    runId: string;
    instanceId: string;
  }): Promise<boolean>;
}

/** PostgreSQL 中的 Pi 原生 header + append-only entries。 */
export interface LeaderCheckpointStore {
  load(sessionId: string): Promise<{
    revision: number;
    checkpoint: PiSessionCheckpoint;
  } | undefined>;
  /** 保存当前 attempt 相对 committed 前缀新增的 Pi entries，供进程崩溃后恢复。 */
  stagePending(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
    baseRevision: number;
    checkpoint: PiSessionCheckpoint;
    now: number;
    claim?: RunExecutionClaim;
  }): Promise<void>;
  /** 加载 committed 前缀与指定 attempt 的 PENDING 尾部。 */
  loadWorking(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
  }): Promise<{
    revision: number;
    checkpoint: PiSessionCheckpoint;
  } | undefined>;
  commit(input: {
    sessionId: string;
    runId: string;
    attemptNo: number;
    expectedRevision: number;
    checkpoint: PiSessionCheckpoint;
    now: number;
    claim?: RunExecutionClaim;
    /** 提供时，adapter 必须在同一事务提交 Run 终态、事件和 checkpoint。 */
    completion?: {
      run: Run;
      event: Omit<RunEvent, "eventId">;
    };
  }): Promise<{ revision: number; event?: RunEvent }>;
  discardPending(
    runId: string,
    attemptNo: number,
    claim?: RunExecutionClaim,
  ): Promise<void>;
}

/** Run 执行凭证存储；loadForLease 必须在 SQL 中校验当前 lease 和 fencing。 */
export interface ExecutionCredentialRepository {
  save(credential: ExecutionCredential): Promise<void>;
  loadForLease(input: {
    runId: string;
    instanceId: string;
    fencingToken: number;
  }): Promise<ExecutionCredential | undefined>;
  delete(runId: string): Promise<void>;
}
