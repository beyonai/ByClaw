import type { AgentProfile } from "../types.js";

export const DELEGATE_AGENT_TOOL_NAME = "delegateAgent";
export const ASK_USER_QUESTION_TOOL_NAME = "askUserQuestion";

/**
 * 让 Provider 实际收到的 Leader 工具与本轮授权 Agent 快照保持一致。
 * 用户交互不依赖 Agent 授权；真实委派仍必须经过 DelegationService 校验。
 */
export function resolveActiveLeaderToolNames(
  authorizedAgents: readonly AgentProfile[],
): string[] {
  return authorizedAgents.length > 0
    ? [DELEGATE_AGENT_TOOL_NAME, ASK_USER_QUESTION_TOOL_NAME]
    : [ASK_USER_QUESTION_TOOL_NAME];
}
