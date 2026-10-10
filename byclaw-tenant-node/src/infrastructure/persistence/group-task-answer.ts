import type { SqlSession } from "../../application/database-ports.js";
import type { AnswerState, MirrorEnvelope } from "../../domain/mirror.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";
import { readGroupCoordination } from "./group-coordination.js";
import { DomainError } from "../../domain/errors.js";
import { projectGroupCandidateAnswer } from "./group-candidate-answer.js";

/** Project a completed private agent turn into its group, in the same tenant transaction. */
export async function projectGroupTaskAnswer(
  db: SqlSession,
  enterpriseId: string,
  event: MirrorEnvelope,
  answer: AnswerState,
): Promise<void> {
  if (await projectGroupCandidateAnswer(db, enterpriseId, event, answer)) return;
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 FOR UPDATE",
    [event.sessionId],
  );
  if (!task || task.status !== "ACTIVE" || task.turnStatus !== "RUNNING" || task.publishMessageId)
    return;
  const marker = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code='group_auto_dispatch'",
    [event.sessionId],
  );
  if (marker?.extParamValue !== task.sourceMessageId) return;
  if (event.eventType === "ERROR") {
    await db.query(
      "UPDATE byai.byai_group_chat_task SET turn_status='FAILED',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1",
      [event.sessionId],
    );
    return;
  }
  if (event.eventType !== "TERMINAL") return;
  const member = await first(
    db,
    "SELECT mem_name FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
    [task.groupSessionId, task.targetAgentId, enterpriseId],
  );
  const group = await first(
    db,
    "SELECT state FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2 AND session_type='hs_as'",
    [task.groupSessionId, enterpriseId],
  );
  if (!member || !group || ["CLOSED", "GROUP_DISSOLVED"].includes(group.state)) {
    await db.query(
      "UPDATE byai.byai_group_chat_task SET turn_status='FAILED',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1",
      [event.sessionId],
    );
    return;
  }
  const scope = await readGroupCoordination(db, event.sessionId);
  if (scope?.mode === "COORDINATED") {
    if (
      task.targetAgentId !== scope.coordinatorAgentId ||
      scope.taskSessionId !== event.sessionId ||
      scope.groupSessionId !== task.groupSessionId ||
      (answer.metadata.agentId != null &&
        String(answer.metadata.agentId) !== scope.coordinatorAgentId)
    )
      throw new DomainError("GROUP_COORDINATION_AGENT_MISMATCH");
    await db.query(
      "UPDATE byai.byai_group_chat_task SET turn_status='WAITING_USER',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1",
      [event.sessionId],
    );
    return;
  }
  const messageId = await nextId(db, enterpriseId);
  const content = answer.finalContent ?? answer.content;
  await insert(db, "byai_message", {
    id: messageId,
    message_id: messageId,
    session_id: task.groupSessionId,
    enterprise_id: enterpriseId,
    creator_id: task.targetAgentId,
    creator_name: member.memName ?? null,
    usage: 2,
    role: "assistant",
    message_ref: task.sourceMessageId,
    message_content: content,
    final_content: content,
    is_complete: true,
    msg_status: 0,
    created_seq: await nextSequence(db, enterpriseId, task.groupSessionId),
    storage_version: "1",
    metadata: JSON.stringify({
      scene: "GROUP_CHAT",
      targetAgentId: task.targetAgentId,
      sourceMessageId: task.sourceMessageId,
      replyToMessageId: task.sourceMessageId,
      taskId: event.sessionId,
    }),
    create_time: new Date(),
    update_time: new Date(),
  });
  await indexGroupMessage(db, enterpriseId, messageId, task.sourceMessageId);
  await db.query(
    "UPDATE byai.byai_group_chat_task SET turn_status='WAITING_USER',publish_message_id=$1,update_time=CURRENT_TIMESTAMP WHERE task_session_id=$2",
    [messageId, event.sessionId],
  );
}
