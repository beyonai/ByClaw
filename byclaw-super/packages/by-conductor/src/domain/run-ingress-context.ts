import type { ProjectContext } from "./project-context.js";
import type { LeaderModelSelection } from "../ports/leader.js";
import type { GroupChatContextV1 } from "./group-chat-context.js";
import type { ExpertTeamRuntimeSnapshotV1 } from "./orchestrator.js";

/**
 * 入口动态上下文属于 Run 的不可变快照；执行和实例接管只读取该快照，
 * 不在中途重新访问权限、Prompt、模型或群聊上游。
 */
export interface RunIngressContextV1 {
  /** by-framework 入站会话 ID，同时是子 Agent 应使用的会话空间 ID。 */
  externalSessionId?: string;
  /** 本轮 BE 项目信息快照。 */
  projectContext?: ProjectContext;
  /** by-framework 入站消息 ID；后续委派将其作为 parentMessageId 建立级联取消关系。 */
  parentMessageId?: string;
  /** by-framework 入站执行链路 ID；用于任务计划快照与 STOP_CHAT 关联。 */
  traceId?: string;
  groupChat?: GroupChatContextV1;
  groupChatFingerprint?: string;
  /** 超级助手 Agent 目录回源失败的诊断；专家团配置失败不会创建 Run。 */
  agentCatalogError?: string;
  /** 入口资源在本次 Run 开始前解析的 Leader 模型快照。 */
  leaderModel?: LeaderModelSelection;
  /** 专家团经 BE 验权后的不可变运行时配置；超级助手请求不写该字段。 */
  orchestrator?: ExpertTeamRuntimeSnapshotV1;
}
