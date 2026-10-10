import type { SqlSession } from "../../application/database-ports.js";
import type { AnswerState, MirrorEnvelope } from "../../domain/mirror.js";
import { DomainError } from "../../domain/errors.js";
import { readGroupCandidate } from "./group-candidate.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

/** Single mentions remain private executions until the running agent declares TASK. */
export async function projectGroupCandidateAnswer(
  db: SqlSession,
  enterpriseId: string,
  event: MirrorEnvelope,
  answer: AnswerState,
): Promise<boolean> {
  const candidate = await readGroupCandidate(db, event.sessionId, true);
  if (!candidate) return false;
  if (
    candidate.disposition === "TASK" &&
    (candidate.status !== "RUNNING" ||
      candidate.traceId !== event.traceId ||
      candidate.answerMessageId !== event.answerMessageId)
  ) {
    if (answer.metadata.agentId != null) {
      const member = await first(
        db,
        "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
        [candidate.groupSessionId, String(answer.metadata.agentId), enterpriseId],
      );
      if (!member) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    }
    // New inputs to a promoted task belong to a new turn, never to the initial classification.
    if (["TERMINAL", "ERROR", "CANCEL"].includes(event.eventType))
      await db.query(
        "UPDATE byai.byai_group_chat_task SET turn_status=$1,update_time=CURRENT_TIMESTAMP WHERE task_session_id=$2 AND status='ACTIVE' AND turn_status='RUNNING' AND current_turn_trace_id=$3",
        [
          event.eventType === "TERMINAL" ? "WAITING_USER" : "FAILED",
          event.sessionId,
          event.traceId,
        ],
      );
    return true;
  }
  if (candidate.status !== "RUNNING") return true;
  if (
    answer.metadata.agentId != null &&
    String(answer.metadata.agentId) !== candidate.targetAgentId
  )
    throw new DomainError("GROUP_COORDINATION_AGENT_MISMATCH");
  if (candidate.traceId !== event.traceId || candidate.answerMessageId !== event.answerMessageId)
    throw new DomainError("MIRROR_CONTEXT_MISMATCH");
  const terminal = ["TERMINAL", "ERROR", "CANCEL"].includes(event.eventType);
  if (["ERROR", "CANCEL"].includes(event.eventType)) {
    await finish(db, event.sessionId, "FAILED");
    if (candidate.disposition === "TASK")
      await db.query(
        "UPDATE byai.byai_group_chat_task SET turn_status='FAILED',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1 AND status='ACTIVE' AND current_turn_trace_id=$2",
        [event.sessionId, event.traceId],
      );
    return true;
  }
  const value = event.payload.metadata?.groupDisposition;
  const sameDispatch =
    value?.schemaVersion === "1" && String(value.dispatchId) === String(candidate.executionId);
  const declaredTask =
    candidate.disposition === "UNKNOWN" &&
    sameDispatch &&
    value.kind === "TASK" &&
    typeof value.taskName === "string" &&
    Boolean(value.taskName.trim()) &&
    (value.ackText == null ||
      (typeof value.ackText === "string" && value.ackText.length <= 1048576));
  const taskName = declaredTask ? value.taskName.trim().slice(0, 255) : null;
  if (candidate.disposition === "UNKNOWN" && sameDispatch && value.kind === "CHAT" && !terminal) {
    await db.query(
      "UPDATE byai.byai_group_chat_execution SET disposition='CHAT',disposition_time=CURRENT_TIMESTAMP WHERE candidate_session_id=$1 AND disposition='UNKNOWN' AND status='RUNNING'",
      [event.sessionId],
    );
    return true;
  }
  if (candidate.disposition !== "TASK" && !declaredTask && !terminal) return true;
  const member = await first(
    db,
    "SELECT mem_name FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
    [candidate.groupSessionId, candidate.targetAgentId, enterpriseId],
  );
  const group = await first(
    db,
    "SELECT state FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2 AND session_type='hs_as'",
    [candidate.groupSessionId, enterpriseId],
  );
  const initiator = await first(
    db,
    "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
    [candidate.groupSessionId, candidate.initiatorUserId, enterpriseId],
  );
  const source = await first(
    db,
    "SELECT message_id,recalled_at FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3 AND usage=1",
    [candidate.sourceMessageId, candidate.groupSessionId, enterpriseId],
  );
  if (
    !member ||
    !initiator ||
    !group ||
    ["CLOSED", "GROUP_DISSOLVED"].includes(group.state) ||
    !source ||
    source.recalledAt
  ) {
    await finish(db, event.sessionId, "FAILED");
    return true;
  }
  if (candidate.disposition === "TASK") {
    if (terminal) {
      await db.query(
        "UPDATE byai.byai_group_chat_task SET turn_status='WAITING_USER',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1 AND status='ACTIVE' AND current_turn_trace_id=$2",
        [event.sessionId, event.traceId],
      );
      await finish(db, event.sessionId, "COMPLETED");
    }
    return true;
  }
  const kind = declaredTask ? "TASK" : "CHAT";
  if (kind === "TASK") {
    await insert(db, "byai_group_chat_task", {
      task_session_id: event.sessionId,
      group_session_id: candidate.groupSessionId,
      source_message_id: candidate.sourceMessageId,
      dispatch_id: candidate.executionId,
      initiator_user_id: candidate.initiatorUserId,
      target_agent_id: candidate.targetAgentId,
      task_name: taskName,
      status: "ACTIVE",
      turn_status: terminal ? "WAITING_USER" : "RUNNING",
      current_turn_id: candidate.executionId,
      current_turn_trace_id: event.traceId,
      create_time: new Date(),
      update_time: new Date(),
    });
  }
  await db.query(
    "UPDATE byai.byai_session SET state=$1,session_name=COALESCE($2,session_name),update_time=CURRENT_TIMESTAMP WHERE session_id=$3 AND enterprise_id=$4",
    [
      kind === "TASK" ? "GROUP_TASK" : "GROUP_CHAT_DISPATCH",
      taskName,
      event.sessionId,
      enterpriseId,
    ],
  );
  const messageId = await nextId(db, enterpriseId);
  const content =
    kind === "TASK"
      ? value.ackText?.trim() || "已接收任务"
      : (answer.finalContent ?? answer.content);
  await insert(db, "byai_message", {
    id: messageId,
    message_id: messageId,
    session_id: candidate.groupSessionId,
    enterprise_id: enterpriseId,
    creator_id: candidate.targetAgentId,
    creator_name: member.memName ?? null,
    usage: 2,
    role: "assistant",
    message_ref: candidate.sourceMessageId,
    message_content: content,
    final_content: content,
    is_complete: true,
    msg_status: 0,
    created_seq: await nextSequence(db, enterpriseId, candidate.groupSessionId),
    storage_version: "1",
    metadata: JSON.stringify({
      scene: "GROUP_CHAT",
      kind: kind === "TASK" ? "TASK_ACK" : "CHAT_REPLY",
      targetAgentId: candidate.targetAgentId,
      sourceMessageId: candidate.sourceMessageId,
      replyToMessageId: candidate.sourceMessageId,
      ...(kind === "TASK" ? { taskId: event.sessionId } : {}),
    }),
    create_time: new Date(),
    update_time: new Date(),
  });
  await indexGroupMessage(db, enterpriseId, messageId, candidate.sourceMessageId);
  await db.query(
    "UPDATE byai.byai_group_chat_execution SET disposition=$1,task_name=$2,ack_text=$3,ack_message_id=$4,disposition_time=CURRENT_TIMESTAMP,status=$5,finish_time=CASE WHEN $5='COMPLETED' THEN CURRENT_TIMESTAMP ELSE finish_time END WHERE candidate_session_id=$6",
    [
      kind,
      taskName,
      kind === "TASK" ? content : null,
      messageId,
      terminal ? "COMPLETED" : "RUNNING",
      event.sessionId,
    ],
  );
  return true;
}

async function finish(db: SqlSession, sessionId: string, status: string) {
  await db.query(
    "UPDATE byai.byai_group_chat_execution SET status=$1,finish_time=CURRENT_TIMESTAMP WHERE candidate_session_id=$2",
    [status, sessionId],
  );
}
