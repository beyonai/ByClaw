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

/** 连续对话和 FIFO 调度的边界。 */
export interface Thread {
  id: string;
  tenantId: string;
  userCode: string;
  userName?: string;
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

/** 一次用户请求的输入、授权快照和执行状态。 */
export interface Run {
  id: string;
  threadId: string;
  input: string;
  agentList: AgentProfile[];
  status: RunStatus;
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
  result?: AgentResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type RunEventType =
  | "run.created"
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
  threadId: string;
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
