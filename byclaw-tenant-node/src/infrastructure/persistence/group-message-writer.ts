import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

/** Commits a human group message in the owning tenant database, keyed by client request ID. */
export interface GroupMessageResult {
  messageId: string;
  dispatches: { taskSessionId: string; targetAgentId: string }[];
}

export async function sendGroupMessage(context: CommandContext): Promise<GroupMessageResult> {
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
  const mentionedAgents: string[] = [];
  for (const resource of payload.resourceList) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource))
      throw new DomainError("INVALID_GROUP_MESSAGE");
    if (resource.resourceType !== "HUMAN" && resource.resourceType !== "DIG_EMPLOYEE") continue;
    const id = requireId(resource.resourceId);
    const member = await first(
      db,
      "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type=$2 AND mem_obj_id=$3 AND com_acct_id=$4",
      [
        command.sessionId,
        resource.resourceType === "HUMAN" ? "USER" : "AGENT",
        id,
        command.enterpriseId,
      ],
    );
    if (!member) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (resource.resourceType === "HUMAN") mentionedUsers.push(id);
    else mentionedAgents.push(id);
  }
  const existing = await first(
    db,
    "SELECT message_id FROM byai.byai_message WHERE session_id=$1 AND enterprise_id=$2 AND creator_id=$3 AND client_request_id=$4 AND usage=1",
    [command.sessionId, command.enterpriseId, command.userId, command.requestId],
  );
  if (existing) {
    const tasks = await db.query(
      "SELECT task_session_id,target_agent_id FROM byai.byai_group_chat_task WHERE group_session_id=$1 AND source_message_id=$2",
      [command.sessionId, existing.messageId],
    );
    return {
      messageId: String(existing.messageId),
      dispatches: tasks.map((task) => ({
        taskSessionId: String(task.task_session_id ?? task.taskSessionId),
        targetAgentId: String(task.target_agent_id ?? task.targetAgentId),
      })),
    };
  }
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
  const dispatches: GroupMessageResult["dispatches"] = [];
  for (const agentId of new Set(mentionedAgents)) {
    const taskSessionId = await nextId(db);
    await insert(db, "byai_session", {
      session_id: taskSessionId,
      parent_session_id: command.sessionId,
      creator_id: command.userId,
      enterprise_id: command.enterpriseId,
      session_name: content.slice(0, 255) || "群聊任务",
      session_type: "h_as",
      state: "ACTIVE",
      last_seq: "0",
      create_time: new Date(),
      update_time: new Date(),
    });
    await insert(db, "byai_group_chat_task", {
      task_session_id: taskSessionId,
      group_session_id: command.sessionId,
      source_message_id: id,
      dispatch_id: await nextId(db),
      initiator_user_id: command.userId,
      target_agent_id: agentId,
      task_name: content.slice(0, 255) || "群聊任务",
      status: "ACTIVE",
      turn_status: "QUEUED",
      create_time: new Date(),
      update_time: new Date(),
    });
    await insert(db, "byai_session_ext", {
      ext_id: await nextId(db),
      session_id: taskSessionId,
      ext_param_name: "group_auto_dispatch",
      ext_param_code: "group_auto_dispatch",
      ext_param_value: id,
    });
    dispatches.push({ taskSessionId, targetAgentId: agentId });
  }
  return { messageId: id, dispatches };
}
