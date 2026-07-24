export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Agent 的内部执行目标；不会被注入 Leader 的可见上下文。 */
export interface AgentExecutionTarget {
  connectorId: string;
  targetId: string;
}

/** 一次 Run 可授权给 Leader 的 Agent 描述。 */
export interface AgentProfile {
  id: string;
  code?: string;
  name: string;
  description?: string;
  execution: AgentExecutionTarget;
}

/** Connector 可返回的外部产物引用。 */
export interface ArtifactRef {
  id: string;
  name?: string;
  uri: string;
  mimeType?: string;
}

export type AgentResultStatus = "completed" | "failed" | "cancelled" | "timed_out";

/** 子 Agent 经编排层归一化后的终态结果。 */
export interface AgentResult {
  status: AgentResultStatus;
  output: string;
  artifacts: ArtifactRef[];
  error?: string;
}

/** 从已验证凭证构造的调用者身份，也是 Session 的授权边界。 */
export interface CallerPrincipal {
  userCode: string;
  userName?: string;
}

/** 连续对话、Pi 上下文和 FIFO 调度的统一边界。 */
export interface Session {
  id: string;
  owner: CallerPrincipal;
  /** 已成功提交到长期 Pi 上下文的单调递增版本。 */
  contextRevision: number;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "WAITING_AGENT"
  | "SYNTHESIZING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RunExecutionStage =
  | "QUEUED"
  | "LEADER_RUNNING"
  | "CONNECTOR_WAITING"
  | "LEADER_SYNTHESIZING"
  | "SETTLED";

/** 一次用户请求的输入、授权快照和执行状态。 */
export interface Run {
  id: string;
  sessionId: string;
  input: string;
  agentList: AgentProfile[];
  status: RunStatus;
  /** 本次 Run 开始时所依赖的已提交 Pi 上下文版本。 */
  baseContextRevision: number;
  /** 每次跨实例接管都会增加，用于区分恢复前后的工作检查点。 */
  attemptNo: number;
  executionStage: RunExecutionStage;
  leaseFencingToken?: number;
  /** 乐观锁版本；每次状态更新递增。 */
  version: number;
  finalAnswer?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type DelegationStatus =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

/**
 * 可序列化的外部执行引用；metadata 不得保存凭证，便于未来进程恢复。
 */
export interface ExternalExecutionRef {
  connectorId: string;
  executionId: string;
  metadata?: Record<string, JsonValue>;
}

/** 一次 Leader 到子 Agent 的委派记录。 */
export interface Delegation {
  id: string;
  runId: string;
  agentId: string;
  connectorId: string;
  task: string;
  expectedOutput?: string;
  status: DelegationStatus;
  externalRef?: ExternalExecutionRef;
  connectorCursor?: string;
  /** 已确认 cursor 之前的 Connector 输出，供跨实例 resume 后继续聚合。 */
  partialOutput?: string;
  version: number;
  result?: AgentResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type RunEventType =
  | "run.created"
  | "run.attempt"
  | "run.status"
  | "leader.delta"
  | "delegation.started"
  | "delegation.progress"
  | "delegation.completed"
  | "delegation.failed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

/** 可回放、可通过 SSE 推送的对外 Run 事件。 */
export interface RunEvent {
  eventId: number;
  timestamp: number;
  runId: string;
  type: RunEventType;
  data: Record<string, JsonValue>;
}

/** Run 的不可逆终态集合。 */
export const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/** Delegation 的不可逆终态集合。 */
export const TERMINAL_DELEGATION_STATUSES = new Set<DelegationStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);
