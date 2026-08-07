import type { AgentProfile } from "./types.js";

/** `filterDelegableAgents` 的输入。所有过滤条件都是可选的，缺省即原样返回。 */
export interface FilterDelegableAgentsInput {
  agents: readonly AgentProfile[];
  /**
   * 当前入口 Agent ID（来自 by-framework `extraPayload.agent_id`）。
   * 提供时按 `AgentProfile.id` 精确排除。只会缩小集合、不会扩大权限。
   */
  sourceAgentId?: string;
  /**
   * 鉴权主体 userCode。无精确 ID 时按 `"{userCode}_main"` 兜底排除超级助手自身。
   */
  principalUserCode?: string;
}

/**
 * 从授权 Agent 列表中排除"超级助手自身"，避免 Pi Leader 把自己当作可委派目标形成递归委派。
 *
 * 优先级：
 * 1. 提供 `sourceAgentId` 时，按 `AgentProfile.id` 精确排除；
 * 2. 无精确 ID 时，按 `principalUserCode` 排除 `code === "{userCode}_main"`；
 * 3. 两者同时存在取并集。
 *
 * 只做精确比较，**绝不使用 `endsWith("_main")`**，避免误删 code 中恰好含 `main` 的普通业务 Agent。
 * 过滤后为空是合法状态（Leader 可直接回答，不视为异常）。
 */
export function filterDelegableAgents(
  input: FilterDelegableAgentsInput,
): AgentProfile[] {
  const sourceId = trimToEmpty(input.sourceAgentId);
  const fallbackCode = trimToEmpty(input.principalUserCode)
    ? `${trimToEmpty(input.principalUserCode)}_main`
    : "";
  if (!sourceId && !fallbackCode) {
    return [...input.agents];
  }
  return input.agents.filter((agent) => {
    if (sourceId && agent.id === sourceId) {
      return false;
    }
    if (fallbackCode && agent.code === fallbackCode) {
      return false;
    }
    return true;
  });
}

/** 去空白；空串视为未提供。 */
function trimToEmpty(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
