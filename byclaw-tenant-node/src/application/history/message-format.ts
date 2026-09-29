import type { Row } from "./contracts.js";

export const objectJson = (value: unknown): Row => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
export const arrayJson = (value: unknown): any[] => {
  try {
    const result = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
};
export const time = (value: unknown) =>
  value instanceof Date ? value.getTime() : new Date(value as string).getTime();
export const recalled = (row: Row) => row.recalledAt != null;
/** 撤回消息清除正文、附件及非展示元数据，仅保留撤回身份和安全展示字段。 */
export function safeMessage(row: Row): Row {
  if (!recalled(row)) return { ...row, complete: row.isComplete };
  const meta = objectJson(row.metadata);
  return {
    messageId: row.messageId,
    id: row.id,
    sessionId: row.sessionId,
    enterpriseId: row.enterpriseId,
    topicId: row.topicId,
    messageRef: row.messageRef,
    usage: row.usage,
    role: row.role,
    creatorId: row.creatorId,
    creatorName: row.creatorName,
    createTime: row.createTime,
    recalled: true,
    recalledAt: row.recalledAt,
    recalledBy: row.recalledBy,
    isComplete: true,
    complete: true,
    messageContent: "消息已撤回",
    metadata: JSON.stringify(
      Object.fromEntries(
        ["scene", "kind", "taskId", "clientRequestId", "agentId"]
          .filter((k) => ["string", "number"].includes(typeof meta[k]))
          .map((k) => [k, meta[k]]),
      ),
    ),
  };
}
