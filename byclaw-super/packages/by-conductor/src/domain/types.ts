import type { SessionContextV1 } from "./session-context.js";
import type { RunIngressContextV1 } from "./run-ingress-context.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Agent 的内部执行目标；不会被注入 Leader 的可见上下文。 */
export interface AgentExecutionTarget {
  connectorId: string;
  targetId: string;
  /** by-framework 的逻辑 Worker 路由名；未指定时由 Connector 使用默认个人 OpenClaw Worker。 */
  targetAgentType?: string;
}

/** 一次 Run 可授权给 Leader 的 Agent 描述。 */
export interface AgentProfile {
  id: string;
  code?: string;
  name: string;
  description?: string;
  /** 编排者为该 Agent 配置的团队职责，不影响 Connector 路由。 */
  role?: string;
  execution: AgentExecutionTarget;
}

/** Connector 可返回的外部产物引用。 */
export interface ArtifactRef {
  id: string;
  name?: string;
  uri: string;
  mimeType?: string;
}

/** 附件来源：by-framework Worker 入口或 HTTP 入口。 */
export type AttachmentProvenance = "by-framework" | "http";

/**
 * 一次 Run 携带的附件引用。`url`/`path` 是连接器兼容字段，
 * 不是超级助手自由访问网络或宿主机的授权；凭据永远不进入此结构。
 */
export interface RunAttachment {
  id: string;
  name: string;
  mediaType?: string;
  size?: number;
  sourceType?: string;
  useType?: string;
  datasetId?: string;
  url?: string;
  path?: string;
  provenance: AttachmentProvenance;
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
  /** 固定结构的业务 Session 环境；与 Pi transcript 分开持久化。 */
  sessionContext: SessionContextV1;
  /** Session 业务上下文版本，不得与 Pi contextRevision 混用。 */
  sessionContextVersion: number;
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
  | "WAITING_USER"
  | "SYNTHESIZING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RunExecutionStage =
  | "QUEUED"
  | "LEADER_RUNNING"
  | "CONNECTOR_WAITING"
  | "USER_INTERACTION_WAITING"
  | "LEADER_SYNTHESIZING"
  | "SETTLED";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

/** 一次用户请求的输入、授权快照和执行状态。 */
export interface Run {
  id: string;
  sessionId: string;
  input: string;
  /** 本次 Run 携带的附件引用；进入 Run 前已规范化，重启/接管后仍存在。 */
  attachments: RunAttachment[];
  /** 入口拉取并验证后冻结的动态上下文；恢复时复用，不重新访问上游。 */
  ingressContext?: RunIngressContextV1;
  /** 本次 Run 使用的模型思考等级；未指定时为 off。 */
  thinkingLevel?: ThinkingLevel;
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
  | "WAITING_USER"
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
  /** 创建时快照的 Agent 名称，供终态事件与对外 DTO 展示，不依赖 Run 的 agentList。 */
  agentName?: string;
  connectorId: string;
  task: string;
  expectedOutput?: string;
  status: DelegationStatus;
  externalRef?: ExternalExecutionRef;
  connectorCursor?: string;
  /** 已确认 cursor 之前的 Connector 输出，供跨实例 resume 后继续聚合。 */
  partialOutput?: string;
  /** 最近一次经 Connector 校验、属于本委派的活动时间。 */
  lastActivityAt?: number;
  version: number;
  result?: AgentResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

/** 用户交互工具可展示的一个候选项。 */
export interface UserInteractionOption {
  label: string;
  value?: string;
  description: string;
}

/** 一次用户交互中的单个问题。 */
export interface UserInteractionQuestion {
  header: string;
  question: string;
  options: UserInteractionOption[];
  multiSelect?: boolean;
}

/** Agent 或 Connector 请求前端展示的结构化问题。 */
export interface UserInteractionRequest {
  /** 交互展示类型；缺失时按既有 form 处理。 */
  kind?: "form" | "external_page";
  questions: UserInteractionQuestion[];
  /** 兼容既有 by-framework 3013 表单的原始 UI 数据。 */
  uiPayload?: Record<string, JsonValue>;
}

/** 用户对待处理交互的响应；生命周期动作由 UI 发出，不由模型调用。 */
export interface UserInteractionResponse {
  action: "submit" | "skip" | "cancel";
  answers?: Record<string, JsonValue>;
  text?: string;
}

export type RunEventType =
  | "run.created"
  | "run.attempt"
  | "run.status"
  | "leader.reasoning.delta"
  | "leader.delta"
  | "delegation.started"
  | "delegation.progress"
  | "delegation.display.progress"
  | "delegation.tool.started"
  | "delegation.tool.detail"
  | "delegation.tool.completed"
  | "delegation.tool.failed"
  | "delegation.output.delta"
  | "delegation.completed"
  | "delegation.failed"
  | "interaction.requested"
  | "interaction.responded"
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
export const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

/** Delegation 的不可逆终态集合。 */
export const TERMINAL_DELEGATION_STATUSES = new Set<DelegationStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);
