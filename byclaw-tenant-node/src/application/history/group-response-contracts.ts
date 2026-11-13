import type { Row } from "./contracts.js";
import { objectJson } from "./message-format.js";

/** Only allow-listed public fields cross the group boundary; candidate answers remain private. */
export function responseView(row: Row): Row {
  const recalled = row.sourceRecalledAt != null;
  const metadata = objectJson(row.sourceMetadata);
  const view: Row = {
    responseId: row.responseId,
    groupSessionId: String(row.groupSessionId),
    sourceMessageId: String(row.sourceMessageId),
    targetAgentId: String(row.targetAgentId),
    initiatorUserId: String(row.initiatorUserId),
    agentName: row.agentName || "数字员工",
    createdAt: row.createTime,
    sourceCreatedAt: row.sourceCreateTime,
    disposition: row.disposition || "UNKNOWN",
    phase: row.status === "QUEUED" ? "QUEUED" : "RUNNING",
    replyTo: {
      messageId: String(row.sourceMessageId),
      content: recalled ? "消息已撤回" : row.sourceContent || "",
      resourceList: recalled ? [] : metadata.resourceList || [],
      recalled,
      speaker: {
        type: "USER",
        userId: String(row.sourceCreatorId || row.initiatorUserId),
        displayName: row.sourceName || "",
      },
    },
  };
  if (recalled || row.status === "CANCELLED") view.phase = "CANCELLED";
  else if (row.taskSessionId && row.taskStatus !== "PRIVATE") {
    view.phase = "TASK";
    view.taskSessionId = String(row.taskSessionId);
    view.task = {
      responseId: row.responseId,
      taskSessionId: view.taskSessionId,
      groupSessionId: view.groupSessionId,
      sourceMessageId: view.sourceMessageId,
      targetAgentId: view.targetAgentId,
      initiatorUserId: view.initiatorUserId,
      taskName: row.taskName || "任务",
      status: row.taskStatus,
      turnStatus: row.taskTurnStatus,
      createTime: row.createTime,
    };
  } else if (["COMPLETED", "SUCCEEDED"].includes(row.status) && row.resultMessageId) {
    view.phase = "CHAT_COMPLETED";
    view.resultMessageId = String(row.resultMessageId);
    view.resultMessage = {
      messageId: view.resultMessageId,
      responseId: row.responseId,
      sessionId: view.groupSessionId,
      sourceMessageId: view.sourceMessageId,
      targetAgentId: view.targetAgentId,
      content: row.resultRecalledAt ? "消息已撤回" : row.resultContent || "",
      recalled: row.resultRecalledAt != null,
      replyTo: view.replyTo,
      resourceList: row.resultRecalledAt ? [] : objectJson(row.resultMetadata).resourceList || [],
      speaker: { type: "AGENT", agentId: view.targetAgentId, displayName: view.agentName },
      role: "ASSISTANT",
      createTime: row.resultCreateTime,
    };
  } else if (["FAILED", "BLOCKED", "COMPLETED", "SUCCEEDED"].includes(row.status))
    view.phase = "FAILED";
  return view;
}
