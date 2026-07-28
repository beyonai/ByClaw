import type { AgentProfile } from "../types.js";

export const DELEGATE_AGENT_TOOL_NAME = "delegateAgent";
export const ASK_USER_QUESTION_TOOL_NAME = "askUserQuestion";
// Ask User 暂时下线：保留实现和协议链路，待前端交互问题修复后可集中恢复。
export const ASK_USER_QUESTION_ENABLED = false;

/**
 * Leader 放开的 Pi 内置文件/检索工具，始终启用，运行在 Session 的 cwd 下。
 * bash 不在此列：它会让任意调用者在服务宿主机上执行任意命令（RCE），
 * 如确需请单独评估后再加入。
 */
export const LEADER_FILE_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
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
