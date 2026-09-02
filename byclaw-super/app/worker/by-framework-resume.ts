import { AgentState, type ResumeCommand } from "@byclaw/by-framework";
import { recordString, recordValue, stringData } from "./by-framework-protocol.js";

const CHILD_REQUEST_SUFFIX = ":request";
const TERMINAL_AGENT_STATES = new Set<string>([
  AgentState.COMPLETED,
  AgentState.FAILED,
  AgentState.CANCELLED,
]);

/** 子 Agent 终态回调中，唤醒持久化 Delegation 所需的最小字段。 */
export interface ChildAgentResume {
  delegationId: string;
  requestMessageId: string;
  status: string;
  finalAnswer: string;
}

/** callAgent 子请求使用的确定性 messageId。 */
export function childRequestMessageId(delegationId: string): string {
  return `${delegationId}${CHILD_REQUEST_SUFFIX}`;
}

/**
 * 解析 by-framework 1.5.x 的真实 ResumeCommand：
 * - content 可以为空；COMPLETED 的正文直接位于字符串 replyData。
 * - metadata.delegation_id 优先标识等待中的 Delegation；旧回调缺失时可从确定性的
 *   `${delegationId}:request` parentMessageId 恢复。
 * - parentMessageId 必须回指 `${delegationId}:request`，防止串单。
 *
 * 非终态不是可消费的子 Agent 回调；终态只接受两种相互可校验的确定性来源，
 * 不从普通 messageId 或正文猜测关联关系。
 */
export function parseChildAgentResume(command: ResumeCommand): ChildAgentResume | undefined {
  const status = command.status.trim().toUpperCase();
  if (!TERMINAL_AGENT_STATES.has(status)) {
    return undefined;
  }

  const sourceAgentType = command.header.sourceAgentType.trim();
  if (!sourceAgentType) {
    throw new Error("ResumeCommand sourceAgentType is required for a child Agent callback");
  }

  const metadataDelegationId = recordString(command.header.metadata, "delegation_id");
  const requestMessageId = command.header.parentMessageId.trim();
  const parentDelegationId = delegationIdFromRequestMessageId(requestMessageId);
  const delegationId = metadataDelegationId || parentDelegationId;
  if (!delegationId) {
    throw new Error(
      "ResumeCommand delegation_id is required in metadata or a :request parentMessageId",
    );
  }

  const expectedRequestMessageId = childRequestMessageId(delegationId);
  if (requestMessageId !== expectedRequestMessageId) {
    throw new Error(
      `ResumeCommand parentMessageId must be ${expectedRequestMessageId}, received ${
        requestMessageId || "<empty>"
      }`,
    );
  }

  return {
    delegationId,
    requestMessageId,
    status,
    finalAnswer: resumeFinalAnswer(status, command.replyData),
  };
}

/** 只从 callAgent 生成的确定性请求 ID 恢复 Delegation，空前缀不是合法 ID。 */
function delegationIdFromRequestMessageId(requestMessageId: string): string {
  if (!requestMessageId.endsWith(CHILD_REQUEST_SUFFIX)) {
    return "";
  }
  return requestMessageId.slice(0, -CHILD_REQUEST_SUFFIX.length).trim();
}

function resumeFinalAnswer(status: string, replyData: unknown): string {
  if (typeof replyData === "string") {
    return replyData;
  }

  // by-framework 自身在异常/取消路径使用 { error } / { reason }，这仍属于终态，
  // 不是另一种成功正文协议。
  if (status === AgentState.FAILED || status === AgentState.CANCELLED) {
    const record = recordValue(replyData);
    const detail = stringData(record?.error) || stringData(record?.reason);
    if (detail) {
      return detail;
    }
  }

  throw new Error(
    `ResumeCommand replyData must be a string for terminal status ${status}`,
  );
}
