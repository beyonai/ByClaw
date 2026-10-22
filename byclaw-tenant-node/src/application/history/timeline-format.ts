import { isSnapshotOnly, forwardResources, publicForward } from "./forward-projection.js";
import { messageAttachments } from "./attachments.js";
import type { HistoryRepository, Row } from "./contracts.js";
import { safeMessage, objectJson, arrayJson, recalled, time } from "./message-format.js";

/** 组合历史展示字段和引用摘要，所有被展示的消息都使用撤回安全投影。 */
export async function displayMessages(
  repository: HistoryRepository,
  rows: Row[],
  actor?: string,
): Promise<Row[]> {
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
  // 群昵称属于消息所在群，不能使用发送时保存的 creatorName 或转发内部的发言人快照。
  const userSessions = [
    ...new Set([...rows, ...byId.values()].filter((r) => r.usage === 1).map((r) => r.sessionId)),
  ].filter(Boolean);
  const nicknames = new Map(
    await Promise.all(
      userSessions.map(
        async (sessionId) =>
          [
            sessionId,
            new Map(
              (await repository.members(sessionId))
                .filter((m) => m.memObjType === "USER" && m.memName?.trim())
                .map((m) => [String(m.memObjId), m.memName]),
            ),
          ] as const,
      ),
    ),
  );
  const tasks = new Map(
    (rows.length ? await repository.tasks(rows[0]!.sessionId) : []).map((r) => [
      r.taskSessionId,
      r,
    ]),
  );
  const acknowledgements = rows.length
    ? await repository.acknowledgements(rows[0]!.sessionId, [
        ...new Set([...rows, ...byId.values()].map((r) => r.messageId)),
      ])
    : [];
  const projection = (source: Row, withReply = true): Row => {
    const row = safeMessage(source),
      meta = objectJson(row.metadata);
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
    const attachments = messageAttachments(source);
    const task = tasks.get(String(meta.taskId ?? ""));
    const passive = isSnapshotOnly(meta);
    const resources = recalled(source)
      ? []
      : passive
        ? forwardResources(meta)
        : arrayJson(meta.resourceList);
    const messageAcks =
      recalled(source) || passive
        ? []
        : acknowledgements.filter((ack) => ack.messageId === source.messageId);
    const reply = withReply && !passive ? byId.get(source.messageRef) : undefined;
    return {
      messageId: row.messageId,
      clientRequestId: meta.clientRequestId,
      topicId: row.topicId,
      taskId: passive ? undefined : meta.taskId,
      groupCoordination: passive ? undefined : meta.groupCoordination,
      initiatorUserId: passive ? undefined : task?.initiatorUserId,
      // Older automatic replies omitted kind but already recorded their published message ID.
      // Repair the read projection, preserving task ACKs and stored history.
      kind:
        row.usage === 5
          ? "SYSTEM_EVENT"
          : (meta.kind ??
            (meta.scene === "GROUP_CHAT" &&
            row.usage === 2 &&
            task?.publishMessageId === row.messageId
              ? "TASK_RESULT"
              : undefined)),
      usage: row.usage,
      systemEvent: row.usage === 5 ? meta.systemEvent : undefined,
      createdAt: time(row.createTime),
      role: row.usage === 5 ? "event" : row.usage === 1 ? "user" : "assistant",
      content: row.messageContent ?? "",
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      sourceMessageId: passive ? undefined : row.messageRef,
      speaker: {
        type: row.usage === 1 ? "user" : row.usage === 5 ? "system" : "agent",
        // Node 不持有平台用户资料；缺少群昵称时由 BE 按 creatorId 补齐当前 userName。
        displayName:
          row.usage === 1
            ? (nicknames.get(row.sessionId)?.get(String(row.creatorId)) ?? null)
            : row.usage === 5
              ? "系统"
              : row.creatorName,
        userCode: row.usage === 1 ? row.creatorId : undefined,
        agentId,
        agentName: row.usage === 2 ? row.creatorName || "Assistant" : undefined,
      },
      target:
        !passive && meta.targetAgentId
          ? { type: "agent", agentId: String(meta.targetAgentId) }
          : undefined,
      resourceList: resources,
      forward: recalled(source) ? undefined : publicForward(meta),
      acknowledgements: messageAcks,
      canAcknowledge:
        !recalled(source) &&
        !passive &&
        actor !== undefined &&
        actor !== String(source.creatorId) &&
        arrayJson(meta.resourceList).some(
          (r) => r?.resourceType === "HUMAN" && String(r.resourceId) === actor,
        ) &&
        !messageAcks.some((ack) => ack.userId === actor),
      attachments,
      recalled: recalled(source),
      recall: recalled(source) ? row.recall : null,
      replyTo: reply
        ? {
            ...projection(reply, false),
            ...(recalled(source) || recalled(reply)
              ? { attachments: [], forward: undefined, acknowledgements: [], canAcknowledge: false }
              : {}),
            content:
              recalled(source) || recalled(reply) ? "消息已撤回" : (reply.messageContent ?? ""),
            resourceList:
              recalled(source) || recalled(reply)
                ? []
                : isSnapshotOnly(reply.metadata)
                  ? forwardResources(objectJson(reply.metadata))
                  : arrayJson(objectJson(reply.metadata).resourceList),
          }
        : undefined,
    };
  };
  return rows.map((row, sequence) => ({ ...projection(row), sequence }));
}
