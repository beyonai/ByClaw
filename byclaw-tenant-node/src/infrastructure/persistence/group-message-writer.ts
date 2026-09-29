import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

/** Commits a human group message in the owning tenant database, keyed by client request ID. */
export async function sendGroupMessage(context: CommandContext): Promise<string> {
  const { command, db } = context;
  const session = await context.session();
  if (session?.sessionType !== "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const payload = command.payload;
  if (
    Object.keys(payload).some(
      (key) =>
        !["chatContent", "resourceList", "files", "replyToMessageId", "creatorName"].includes(key),
    ) ||
    !Array.isArray(payload.resourceList) ||
    payload.resourceList.length > 100 ||
    (payload.files !== undefined && (!Array.isArray(payload.files) || payload.files.length > 20))
  )
    throw new DomainError("INVALID_GROUP_MESSAGE");
  const content = text(payload.chatContent ?? "", 262144, true);
  if (!content.trim() && (!payload.files || !payload.files.length))
    throw new DomainError("INVALID_GROUP_MESSAGE");
  const mentionedUsers: string[] = [];
  for (const resource of payload.resourceList) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource))
      throw new DomainError("INVALID_GROUP_MESSAGE");
    if (resource.resourceType === "DIG_EMPLOYEE")
      throw new DomainError("TENANT_GROUP_AGENT_NOT_READY");
    if (resource.resourceType !== "HUMAN") continue;
    const id = requireId(resource.resourceId);
    const member = await first(
      db,
      "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
      [command.sessionId, id, command.enterpriseId],
    );
    if (!member) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    mentionedUsers.push(id);
  }
  const existing = await first(
    db,
    "SELECT message_id FROM byai.byai_message WHERE session_id=$1 AND enterprise_id=$2 AND creator_id=$3 AND client_request_id=$4 AND usage=1",
    [command.sessionId, command.enterpriseId, command.userId, command.requestId],
  );
  if (existing) return String(existing.messageId);
  const id = await nextId(db);
  const reference = payload.replyToMessageId == null ? null : requireId(payload.replyToMessageId);
  await insert(db, "byai_message", {
    id,
    message_id: id,
    session_id: command.sessionId,
    enterprise_id: command.enterpriseId,
    creator_id: command.userId,
    creator_name: text(payload.creatorName ?? "", 255),
    usage: 1,
    role: "user",
    message_ref: reference,
    message_content: content,
    metadata: JSON.stringify({
      scene: "GROUP_CHAT",
      clientRequestId: command.requestId,
      resourceList: payload.resourceList,
    }),
    related_resources: payload.files?.length ? JSON.stringify({ files: payload.files }) : null,
    client_request_id: command.requestId,
    created_seq: await nextSequence(db, command.enterpriseId, command.sessionId),
    is_complete: true,
    msg_status: 0,
    create_time: new Date(),
    update_time: new Date(),
  });
  await indexGroupMessage(db, command.enterpriseId, id, reference);
  for (const user of new Set(mentionedUsers)) {
    if (user === command.userId) continue;
    await db.query(
      "INSERT INTO byai.byai_group_chat_mention(message_id,group_session_id,mentioned_user_id,creator_id,create_time) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(message_id,mentioned_user_id) DO NOTHING",
      [id, command.sessionId, user, command.userId],
    );
  }
  return id;
}
