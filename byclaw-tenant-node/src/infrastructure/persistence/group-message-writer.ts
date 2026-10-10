import { createGroupTasks } from "./group-task-create.js";
import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage, indexGroupMention } from "./group-message-index.js";
import { GROUP_COORDINATOR_AGENT_ID } from "../../domain/group-coordination.js";
import { readGroupCoordination } from "./group-coordination.js";
import type { GroupDispatch } from "./group-task-create.js";

/** Commits a human group message in the owning tenant database, keyed by client request ID. */
export interface GroupMessageResult {
  messageId: string;
  dispatches: GroupDispatch[];
}

export async function sendGroupMessage(context: CommandContext): Promise<GroupMessageResult> {
  const { command, db } = context;
  const session = await context.session();
  if (session?.sessionType !== "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const payload = command.payload;
  if (
    Object.keys(payload).some(
      (key) =>
        ![
          "chatContent",
          "resourceList",
          "files",
          "replyToMessageId",
          "creatorName",
          "coordinatorAgentId",
          "coordinatorName",
          "coordinatorAuthorized",
        ].includes(key),
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
      "SELECT task_session_id,target_agent_id,dispatch_id FROM byai.byai_group_chat_task WHERE group_session_id=$1 AND source_message_id=$2 UNION ALL SELECT candidate_session_id AS task_session_id,target_agent_id,execution_id AS dispatch_id FROM byai.byai_group_chat_execution e WHERE group_session_id=$1 AND source_message_id=$2 AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_task t WHERE t.task_session_id=e.candidate_session_id)",
      [command.sessionId, existing.messageId],
    );
    return {
      messageId: String(existing.messageId),
      dispatches: await Promise.all(
        tasks.map(async (task) => {
          const taskSessionId = String(task.task_session_id ?? task.taskSessionId);
          const scope = await readGroupCoordination(db, taskSessionId);
          return {
            taskSessionId,
            targetAgentId: String(task.target_agent_id ?? task.targetAgentId),
            dispatchId: String(task.dispatch_id ?? task.dispatchId),
            ...(scope ? { groupCoordination: scope } : {}),
          };
        }),
      ),
    };
  }
  if (mentionedAgents.length && payload.coordinatorAgentId !== undefined) {
    const coordinatorAgentId = requireId(payload.coordinatorAgentId);
    const bound = await first(
      db,
      "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
      [command.sessionId, GROUP_COORDINATOR_AGENT_ID],
    );
    if (bound && bound.extParamValue !== coordinatorAgentId)
      throw new DomainError("GROUP_COORDINATOR_MISMATCH");
    if (!bound) {
      const member = await first(
        db,
        "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
        [command.sessionId, coordinatorAgentId, command.enterpriseId],
      );
      if (!member) {
        if (payload.coordinatorAuthorized !== true)
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
        await insert(db, "byai_session_member", {
          byai_session_member_id: await nextId(db, command.enterpriseId),
          session_id: command.sessionId,
          mem_obj_type: "AGENT",
          mem_obj_id: coordinatorAgentId,
          user_role: "MEMBER",
          mem_name: text(payload.coordinatorName ?? "", 255),
          creator_id: command.userId,
          com_acct_id: command.enterpriseId,
          create_time: new Date(),
        });
      }
      await context.setExtension(GROUP_COORDINATOR_AGENT_ID, coordinatorAgentId);
    }
  }
  const id = await nextId(db, command.enterpriseId);
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
    await indexGroupMention(db, id, command.sessionId, user, command.userId);
  }
  const dispatches = await createGroupTasks(context, id, content, mentionedAgents);
  const scope = dispatches.find(
    (dispatch) => dispatch.groupCoordination?.mode === "COORDINATED",
  )?.groupCoordination;
  if (scope)
    await db.query(
      "UPDATE byai.byai_message SET metadata=$1 WHERE message_id=$2 AND enterprise_id=$3",
      [
        JSON.stringify({
          scene: "GROUP_CHAT",
          clientRequestId: command.requestId,
          resourceList: payload.resourceList,
          groupCoordination: scope,
          taskId: scope.taskSessionId,
        }),
        id,
        command.enterpriseId,
      ],
    );
  return { messageId: id, dispatches };
}
