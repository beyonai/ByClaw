import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert } from "./sql-utils.js";

/** 验证群内源消息与目标 AGENT，并在同一事务创建发起人私有会话和群任务。 */
export async function createTask(context: CommandContext): Promise<void> {
  const { command, db } = context,
    p = command.payload,
    taskId = requireId(p.taskSessionId);
  if ((await context.session())?.sessionType !== "hs_as")
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const sourceMessageId = requireId(p.sourceMessageId),
    agentId = requireId(p.targetAgentId);
  if (
    !(await first(
      db,
      "SELECT 1 FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3",
      [sourceMessageId, command.sessionId, command.enterpriseId],
    )) ||
    !(await first(
      db,
      "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
      [command.sessionId, agentId, command.enterpriseId],
    ))
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  await insert(db, "byai_session", {
    session_id: taskId,
    parent_session_id: command.sessionId,
    creator_id: command.userId,
    enterprise_id: command.enterpriseId,
    session_name: text(p.taskName, 255, true),
    session_type: "h_as",
    state: "ACTIVE",
    last_seq: "0",
    create_time: new Date(),
    update_time: new Date(),
  });
  await insert(db, "byai_group_chat_task", {
    task_session_id: taskId,
    group_session_id: command.sessionId,
    source_message_id: sourceMessageId,
    dispatch_id: requireId(p.dispatchId),
    initiator_user_id: command.userId,
    target_agent_id: agentId,
    task_name: text(p.taskName, 255, true),
    status: "ACTIVE",
    turn_status: "RUNNING",
    create_time: new Date(),
    update_time: new Date(),
  });
}

/** Only one worker may start a queued tenant group task, even across BE replicas. */
export async function claimTask(context: CommandContext): Promise<{ claimed: boolean }> {
  const { command, db } = context;
  const taskId = requireId(command.payload.taskSessionId);
  const rows = await db.query(
    "UPDATE byai.byai_group_chat_task SET turn_status='RUNNING',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1 AND group_session_id=$2 AND initiator_user_id=$3 AND status='ACTIVE' AND turn_status='QUEUED' RETURNING task_session_id",
    [taskId, command.sessionId, command.userId],
  );
  return { claimed: rows.length === 1 };
}
/** 仅发起人可修改任务或待发布卡片；已结束任务不复活，PUBLISHED 只能通过发布命令产生。 */
export async function changeTask(context: CommandContext): Promise<void> {
  const { command, db } = context,
    p = command.payload,
    taskId = requireId(p.taskSessionId);
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 AND group_session_id=$2 FOR UPDATE",
    [taskId, command.sessionId],
  );
  if (!task || task.initiatorUserId !== command.userId)
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (command.operation === "UPDATE_TASK") {
    if (
      !["ACTIVE", "PUBLISHED", "CANCELLED"].includes(p.status) ||
      !["WAITING_USER", "RUNNING", "FAILED"].includes(p.turnStatus ?? task.turnStatus)
    )
      throw new DomainError("INVALID_TASK_STATUS");
    if (p.status === "PUBLISHED") throw new DomainError("USE_TASK_PUBLICATION");
    if (task.status !== "ACTIVE" && p.status !== task.status)
      throw new DomainError("TASK_ALREADY_TERMINAL");
    await db.query(
      "UPDATE byai.byai_group_chat_task SET status=$1,turn_status=$2,update_time=CURRENT_TIMESTAMP WHERE task_session_id=$3 AND group_session_id=$4",
      [p.status, p.turnStatus ?? task.turnStatus, taskId, command.sessionId],
    );
    return;
  }
  if (command.operation === "DELETE_PENDING_PUBLICATION") {
    await db.query(
      "DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
      [taskId],
    );
    return;
  }
  if (task.status !== "ACTIVE") throw new DomainError("TASK_NOT_ACTIVE");
  if (
    !Array.isArray(p.sourcePaths) ||
    p.sourcePaths.length > 100 ||
    p.sourcePaths.some((value: unknown) => typeof value !== "string" || value.length > 2048)
  )
    throw new DomainError("INVALID_SOURCE_PATHS");
  const existing = await first(
    db,
    "SELECT pending_publication_id FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
    [taskId],
  );
  if (
    p.expectedPendingPublicationId !== undefined &&
    existing?.pendingPublicationId !== requireId(p.expectedPendingPublicationId)
  )
    throw new DomainError("PENDING_PUBLICATION_CHANGED");
  if (!String(p.text ?? "").trim() && !p.sourcePaths.length)
    throw new DomainError("INVALID_PUBLICATION_CONTENT");
  const args = [
    requireId(p.pendingPublicationId),
    text(p.text ?? "", 1048576, true),
    JSON.stringify(p.sourcePaths),
    taskId,
  ];
  if (existing)
    await db.query(
      "UPDATE byai.byai_group_chat_pending_publication SET pending_publication_id=$1,text_content=$2,source_files_json=$3,uploaded_files_json='{}',cloud_resource_id=NULL,create_time=CURRENT_TIMESTAMP WHERE task_session_id=$4",
      args,
    );
  else
    await insert(db, "byai_group_chat_pending_publication", {
      task_session_id: taskId,
      pending_publication_id: args[0],
      text_content: args[1],
      source_files_json: args[2],
      create_time: new Date(),
    });
}
