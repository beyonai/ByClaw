import type { AgentProfile, CallerPrincipal } from "../domain/types.js";
import type { ExpertTeamRuntimeSnapshotV1 } from "../domain/orchestrator.js";
import type { SessionContextV1 } from "../domain/session-context.js";
import type { GroupChatContextV1 } from "../domain/group-chat-context.js";
import type { TaskPlanSnapshot } from "../domain/task-plan.js";

/** 一次上下文编译所需的原始快照；读取外部数据应在进入编译器之前完成。 */
export interface ContextBuildInput {
  /** 稳定的 Supervisor 角色与平台规则，始终位于最终 system prompt 最前面。 */
  baseSystemPrompt: string;
  /** by-framework 入站会话 ID；存在时声明用户可见的规范会话空间。 */
  externalSessionId?: string;
  /** 当前 Run 冻结的授权 Agent 快照。 */
  authorizedAgents: readonly AgentProfile[];
  /** Agent 目录回源失败；此时授权快照为空不代表用户确实没有可用数字员工。 */
  authorizedAgentsUnavailable?: boolean;
  /** 当前业务 Session 的稳定环境快照。 */
  sessionContext: SessionContextV1;
  /** 已在入口读取、校验并持久化的本轮群聊快照。 */
  groupChatContext?: GroupChatContextV1;
  /** 本轮上下文构建时间，由 Runtime 显式提供以保持可测试。 */
  currentTime: number;
  /** 当前调用者身份；缺省时不渲染用户区段。 */
  user?: CallerPrincipal;
  /** 缺省表示原有超级助手；存在时由编译路由选择独立 Prompt 和上下文策略。 */
  orchestrator?: ExpertTeamRuntimeSnapshotV1;
  /** 当前执行的 BE 权威计划快照；仅在任务计划 Port 可用时注入。 */
  activeTaskPlan?: TaskPlanSnapshot;
  taskPlanAvailable?: boolean;
}

/** 动态追加到稳定 system prompt 后面的一个具名上下文区段。 */
export interface SystemContextSection {
  id: string;
  content: string;
}

/** Processor 之间传递的中间表示。 */
export interface ContextBuildState {
  stableSystemPrompt: string;
  dynamicSystemSections: readonly SystemContextSection[];
}

/** 单个编译阶段的非敏感诊断信息。 */
export interface ContextProcessorDiagnostic {
  name: string;
  durationMs: number;
  charactersAdded: number;
  totalCharacters: number;
}

/** 一次编译的摘要；只记录大小和指纹，不记录完整上下文正文。 */
export interface ContextBuildDiagnostics {
  fingerprint: string;
  totalCharacters: number;
  estimatedTokens: number;
  processors: readonly ContextProcessorDiagnostic[];
}

/** 交给 Runtime Adapter 的初版编译结果。 */
export interface CompiledContext {
  /** 稳定前缀，便于后续单独分析缓存命中。 */
  stableSystemPrompt: string;
  /** 本次 Run/Step 的动态 system 上下文。 */
  dynamicSystemContext: string;
  /** 当前 Pi Adapter 实际使用的完整 system prompt。 */
  systemPrompt: string;
  diagnostics: ContextBuildDiagnostics;
}

/** 同步、无外部 I/O 的上下文编译阶段。 */
export interface ContextProcessor {
  readonly name: string;
  process(state: ContextBuildState, input: ContextBuildInput): ContextBuildState;
}

/** Pi Adapter 依赖的最小上下文编译协议，允许按编排类型选择不同流水线。 */
export interface SystemContextCompiler {
  compile(input: ContextBuildInput): CompiledContext;
}
