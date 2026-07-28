import type { AttachmentInspection, AttachmentInspectionMode } from "./attachment-inspection.js";
import type { PiSessionCheckpoint } from "./pi-session-checkpoint.js";
import type { SessionContextV1 } from "./session-context.js";
import type { GroupChatContextV1 } from "./group-chat-context.js";
import type {
  AgentProfile,
  AgentResult,
  CallerPrincipal,
  RunAttachment,
  ThinkingLevel,
  UserInteractionQuestion,
  UserInteractionResponse,
} from "./types.js";

/** Leader 执行单次 Run 所需的授权快照和边界回调。 */
export interface LeaderRunInput {
  message: string;
  /** 本次 Run 的附件；Leader 可据此生成摘要，工具按 ID 引用，不直接抓取内容。 */
  attachments: readonly RunAttachment[];
  thinkingLevel: ThinkingLevel;
  agents: AgentProfile[];
  sessionContext: SessionContextV1;
  /** 当前 Run 冻结的群聊快照；只进入本轮动态 system context。 */
  groupChatContext?: GroupChatContextV1;
  currentTime: number;
  /** 当前调用者身份；经 before_agent_start 临时注入 system prompt，不进入长期 transcript。 */
  user?: CallerPrincipal;
  signal: AbortSignal;
  /** 接收最终可见回答的文本增量。 */
  onDelta(text: string): Promise<void> | void;
  /** Pi 每追加一个原生 entry 后保存 PENDING 工作检查点。 */
  onCheckpoint?(checkpoint: PiSessionCheckpoint): Promise<void> | void;
  /** 执行一次经过授权校验的 Agent 委派。 */
  delegate(input: {
    agentId: string;
    task: string;
    expectedOutput?: string;
    /** 选中要随委派透传的附件 ID；undefined=全部，[]=不带，未知 ID 会被拒绝。 */
    attachmentIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<AgentResult>;
  /** 暂停当前工具调用，等待用户通过固定 UI 回答结构化问题。 */
  askUser(input: {
    toolCallId: string;
    questions: UserInteractionQuestion[];
    signal?: AbortSignal;
  }): Promise<UserInteractionResponse>;
  /**
   * 受控读取当前 Run 某个附件的有界内容。仅当本轮存在附件且注入了 Resolver 时可用；
   * 工具层只能传 attachmentId，真正的附件对象由服务端从本轮附件集合解析。
   */
  inspectAttachment?(input: {
    attachmentId: string;
    mode?: AttachmentInspectionMode;
    signal?: AbortSignal;
  }): Promise<AttachmentInspection>;
}

/** Leader 单次 Run 的最终可见结果。 */
export interface LeaderRunResult {
  text: string;
}

/** 每个业务 Session 独享并复用的 Pi Leader 会话协议。 */
export interface LeaderSession {
  /** 当前实例加载的数据库 committed context revision。 */
  readonly contextRevision: number;
  /** 在当前业务 Session 的连续上下文中执行一个 Run。 */
  run(input: LeaderRunInput): Promise<LeaderRunResult>;
  /** Pi settled 后导出原生 header + append-only entries。 */
  checkpoint(): PiSessionCheckpoint | undefined;
  /** checkpoint 原子提交成功后推进本地缓存版本。 */
  markCommitted(revision: number): void;
  /** 中止当前模型生成和正在执行的工具。 */
  abort(): Promise<void>;
  /** 释放 Pi Session 及事件订阅等进程内资源。 */
  dispose(): Promise<void> | void;
}

/** Leader 会话的创建和健康检查 Port。 */
export interface LeaderSessionFactory {
  /** 为指定业务 Session 创建独立、可复用的 Pi 会话。 */
  create(sessionId: string): Promise<LeaderSession>;
  /** 检查 Leader Runtime 与模型是否已经就绪。 */
  health(): Promise<{ healthy: boolean; message?: string; model?: string }>;
}
