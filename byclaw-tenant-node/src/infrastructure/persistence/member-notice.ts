import type { CommandContext } from "./command-context.js";
import { insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";

/** Called only for a new membership change, under the command's group lock and transaction. */
export async function membershipNotice(
  context: CommandContext,
  member: { memObjId: string; memObjType: string; memName: string },
  operatorId = context.command.userId,
  eventType: "MEMBER_INVITED" | "MEMBER_LEFT" | "MEMBER_REMOVED" = "MEMBER_INVITED",
): Promise<Record<string, any>> {
  const { command, db } = context;
  const operator = await context.member(operatorId);
  const operatorName = operator?.memName || operatorId;
  const memberName = member.memName || member.memObjId;
  const content =
    eventType === "MEMBER_LEFT"
      ? `${memberName} 离开了工作组`
      : eventType === "MEMBER_REMOVED"
        ? `${operatorName} 将 ${memberName} 移出工作组`
        : `${operatorName} 邀请 ${memberName} 加入工作组`;
  const systemEvent = {
    eventType,
    operatorId,
    operatorName,
    memberId: member.memObjId,
    memberType: member.memObjType,
    memberName,
  };
  const messageId = await nextId(db, command.enterpriseId);
  const now = new Date();
  await insert(db, "byai_message", {
    id: messageId,
    message_id: messageId,
    session_id: command.sessionId,
    project_id: (await context.session())?.projectId ?? null,
    enterprise_id: command.enterpriseId,
    creator_id: operatorId,
    creator_name: operatorName,
    usage: 5,
    role: "event",
    message_content: content,
    metadata: JSON.stringify({ scene: "GROUP_CHAT", kind: "SYSTEM_EVENT", systemEvent }),
    created_seq: await nextSequence(db, command.enterpriseId, command.sessionId),
    is_complete: true,
    msg_status: 0,
    create_time: now,
    update_time: now,
  });
  return {
    type: "GROUP_CHAT_EVENT",
    event: "MESSAGE_CREATED",
    sessionId: command.sessionId,
    messageId,
    usage: 5,
    kind: "SYSTEM_EVENT",
    role: "event",
    content,
    createdAt: now.getTime(),
    creatorId: operatorId,
    creatorName: operatorName,
    speaker: { type: "system", displayName: "系统" },
    systemEvent,
  };
}
