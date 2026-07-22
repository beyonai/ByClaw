import type { AgentProfile, AgentResult } from "./types.js";

/** Leader 执行单次 Run 所需的授权快照和边界回调。 */
export interface LeaderRunInput {
  message: string;
  agents: AgentProfile[];
  signal: AbortSignal;
  /** 接收最终可见回答的文本增量。 */
  onDelta(text: string): Promise<void> | void;
  /** 执行一次经过授权校验的 Agent 委派。 */
  delegate(input: {
    agentId: string;
    task: string;
    expectedOutput?: string;
    signal?: AbortSignal;
  }): Promise<AgentResult>;
}

/** Leader 单次 Run 的最终可见结果。 */
export interface LeaderRunResult {
  text: string;
}

/** 每个 Thread 独享并复用的 Leader 会话协议。 */
export interface LeaderSession {
  /** 在当前 Thread 会话中执行一个 Run，并返回 Leader 的最终可见回答。 */
  run(input: LeaderRunInput): Promise<LeaderRunResult>;
  /** 中止当前模型生成和正在执行的工具。 */
  abort(): Promise<void>;
  /** 释放 Pi Session 及事件订阅等进程内资源。 */
  dispose(): void;
}

/** Leader 会话的创建和健康检查 Port。 */
export interface LeaderSessionFactory {
  /** 为指定 Thread 创建独立、可复用的 Leader 会话。 */
  create(threadId: string): Promise<LeaderSession>;
  /** 检查 Leader Runtime 与模型是否已经就绪。 */
  health(): Promise<{ healthy: boolean; message?: string; model?: string }>;
}
