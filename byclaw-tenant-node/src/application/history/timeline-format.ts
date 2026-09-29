import type { HistoryRepository, Row } from "./contracts.js";
import { safeMessage, objectJson, arrayJson, recalled, time } from "./message-format.js";

/** 组合历史展示字段和引用摘要，所有被展示的消息都使用撤回安全投影。 */
export async function displayMessages(repository: HistoryRepository, rows: Row[]): Promise<Row[]> {
  const references = [...new Set(rows.map((r) => r.messageRef).filter(Boolean))];
  const byId = new Map(
    (references.length
      ? await repository.messages({
          sessionId: rows[0]?.sessionId,
          ids: references,
          visible: true,
        })
      : []
    ).map((r) => [r.messageId, r]),
  );
  const tasks = new Map(
    (rows.length ? await repository.tasks(rows[0]!.sessionId) : []).map((r) => [
      r.taskSessionId,
      r,
    ]),
  );
  const projection = (source: Row, withReply = true): Row => {
    const row = safeMessage(source),
      meta = objectJson(row.metadata),
      resources = objectJson(row.relatedResources);
    const agentId =
      source.usage === 2
        ? String(
            source.resComId ??
              (meta.scene === "GROUP_CHAT"
                ? (meta.targetAgentId ??
                  (["TASK_ACK", "TASK_RESULT"].includes(meta.kind) ? source.creatorId : undefined))
                : undefined) ??
              String(source.resComIds ?? "").match(/[1-9]\d*/)?.[0] ??
              "unknown",
          )
        : undefined;
    const attachments = recalled(source)
      ? []
      : [
          ...arrayJson(resources.files)
            .filter((f) => f && f.fileId && f.fileName)
            .map((f) => ({
              fileId: f.fileId,
              fileName: f.fileName,
              fileUrl: f.fileUrl,
              mediaType: f.fileType,
            })),
          ...(meta.scene === "GROUP_CHAT" && meta.kind === "TASK_RESULT"
            ? arrayJson(meta.files)
                .filter((f) => f && f.fileName && f.filePath)
                .map((f) => ({
                  fileId: f.fileId,
                  fileName: f.fileName,
                  filePath: f.filePath,
                  cloudResourceId: f.cloudResourceId,
                }))
            : []),
        ];
    const task = tasks.get(String(meta.taskId ?? ""));
    const reply = withReply ? byId.get(source.messageRef) : undefined;
    return {
      messageId: row.messageId,
      clientRequestId: meta.clientRequestId,
      topicId: row.topicId,
      taskId: meta.taskId,
      initiatorUserId: task?.initiatorUserId,
      kind: row.usage === 5 ? "SYSTEM_EVENT" : meta.kind,
      usage: row.usage,
      systemEvent: row.usage === 5 ? meta.systemEvent : undefined,
      createdAt: time(row.createTime),
      role: row.usage === 5 ? "event" : row.usage === 1 ? "user" : "assistant",
      content: row.messageContent ?? "",
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      sourceMessageId: row.messageRef,
      speaker: {
        type: row.usage === 1 ? "user" : row.usage === 5 ? "system" : "agent",
        displayName: row.usage === 5 ? "系统" : row.creatorName,
        userCode: row.usage === 1 ? row.creatorId : undefined,
        agentId,
        agentName: row.usage === 2 ? row.creatorName || "Assistant" : undefined,
      },
      target: meta.targetAgentId
        ? { type: "agent", agentId: String(meta.targetAgentId) }
        : undefined,
      resourceList: recalled(source) ? [] : arrayJson(meta.resourceList),
      attachments,
      recalled: recalled(source),
      recall: recalled(source)
        ? { operatorId: row.recalledBy, recalledAt: time(row.recalledAt) }
        : null,
      replyTo: reply
        ? {
            ...projection(reply, false),
            content:
              recalled(source) || recalled(reply) ? "消息已撤回" : (reply.messageContent ?? ""),
            resourceList:
              recalled(source) || recalled(reply)
                ? []
                : arrayJson(objectJson(reply.metadata).resourceList),
          }
        : undefined,
    };
  };
  return rows.map((row, sequence) => ({ ...projection(row), sequence }));
}
