import type { AgentProfile } from "../types.js";
import type { SessionContextV1 } from "../session-context.js";

/** 一次上下文编译所需的原始快照；读取外部数据应在进入编译器之前完成。 */
export interface ContextBuildInput {
  /** 稳定的 Supervisor 角色与平台规则，始终位于最终 system prompt 最前面。 */
  baseSystemPrompt: string;
  /** 当前 Run 冻结的授权 Agent 快照。 */
  authorizedAgents: readonly AgentProfile[];
  /** 当前业务 Session 的稳定环境快照。 */
  sessionContext: SessionContextV1;
  /** 本轮上下文构建时间，由 Runtime 显式提供以保持可测试。 */
  currentTime: number;
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
