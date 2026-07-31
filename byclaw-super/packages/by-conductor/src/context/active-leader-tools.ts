import type { AgentProfile } from "../types.js";

export const DELEGATE_AGENT_TOOL_NAME = "delegateAgent";
export const ASK_USER_QUESTION_TOOL_NAME = "askUserQuestion";
/** Leader 读取当前 Run 附件内容的受控工具；仅允许引用本轮附件 ID。 */
export const INSPECT_ATTACHMENT_TOOL_NAME = "inspectAttachment";
/** Leader 把当前 Run 附件原始字节下载到会话工作区的受控工具。 */
export const DOWNLOAD_ATTACHMENT_TOOL_NAME = "downloadAttachment";
// Ask User 暂时下线：保留实现和协议链路，待前端交互问题修复后可集中恢复。
export const ASK_USER_QUESTION_ENABLED = false;
// Download Attachment 暂时下线：BE 下载接口待重新对接，期间 Leader 需要读文件时
// 委派给专家 Agent。保留实现与注入链路，接口就绪后置 true 即可集中恢复。
export const DOWNLOAD_ATTACHMENT_ENABLED = false;

/**
 * Leader 放开的 Pi 内置文件/检索工具，运行在 Session 的 cwd 下。
 * 当前全部禁用（空列表）；如需恢复，逐项取消注释并评估影响。
 * bash 始终不在此列：它会让任意调用者在服务宿主机上执行任意命令（RCE）。
 */
export const LEADER_FILE_TOOL_NAMES = [
  // "read",
  // "write",
  // "edit",
  // "grep",
  // "find",
  // "ls",
] as const;

/**
 * 允许进入长期 Pi checkpoint 的完整 Leader 工具白名单。
 * 持久化层必须与运行时实际暴露的工具保持同步，同时继续拒绝任意未知工具。
 */
export const LEADER_CHECKPOINT_TOOL_NAMES = [
  DELEGATE_AGENT_TOOL_NAME,
  // ASK_USER_QUESTION_TOOL_NAME,
  INSPECT_ATTACHMENT_TOOL_NAME,
  // DOWNLOAD_ATTACHMENT_TOOL_NAME,
  ...LEADER_FILE_TOOL_NAMES,
] as const;

/**
 * 让 Provider 实际收到的 Leader 工具与本轮授权 Agent 快照保持一致。
 * 真实委派仍必须经过 DelegationService 校验。
 */
export function resolveActiveLeaderToolNames(
  authorizedAgents: readonly AgentProfile[],
): string[] {
  return [
    ...(authorizedAgents.length > 0 ? [DELEGATE_AGENT_TOOL_NAME] : []),
    ...(ASK_USER_QUESTION_ENABLED ? [ASK_USER_QUESTION_TOOL_NAME] : []),
  ];
}
