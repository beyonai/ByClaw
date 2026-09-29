import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

/** BE uploads and authorizes files; Node commits the publication and group message together. */
export async function publishTask(context: CommandContext): Promise<void> {
  const { db, command } = context,
    p = command.payload,
    taskId = requireId(p.taskSessionId);
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 AND group_session_id=$2 FOR UPDATE",
    [taskId, command.sessionId],
  );
  if (!task || task.initiatorUserId !== command.userId)
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (task.status !== "ACTIVE" || task.turnStatus === "RUNNING")
    throw new DomainError("TASK_NOT_READY_FOR_PUBLICATION");
  if (p.pendingPublicationId !== undefined) {
    const pending = await first(
      db,
      "SELECT pending_publication_id FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1 FOR UPDATE",
      [taskId],
    );
    if (pending?.pendingPublicationId !== requireId(p.pendingPublicationId))
      throw new DomainError("PENDING_PUBLICATION_CHANGED");
  }
  const content = text(p.text ?? "", 1048576, true),
    files = p.files ?? [];
  if (
    !Array.isArray(files) ||
    files.length > 100 ||
    files.some((file) => !file || file.resourceAuthorized !== true)
  )
    throw new DomainError("INVALID_PUBLICATION_FILES");
  if (!content.trim() && !files.length) throw new DomainError("INVALID_PUBLICATION_CONTENT");
  const messageId = requireId(p.messageId),
    now = new Date();
  await insert(db, "byai_message", {
    id: requireId(p.id),
    message_id: messageId,
    session_id: command.sessionId,
    enterprise_id: command.enterpriseId,
    creator_id: task.targetAgentId,
    creator_name: p.creatorName ?? null,
    usage: 2,
    role: "assistant",
    message_content: content,
    final_content: content,
    is_complete: true,
    msg_status: 0,
    created_seq: await nextSequence(db, command.enterpriseId, command.sessionId),
    storage_version: "1",
    metadata: JSON.stringify({
      ...(p.metadata ?? {}),
      scene: "GROUP_CHAT",
      kind: "TASK_RESULT",
      taskId,
      files,
    }),
    create_time: now,
    update_time: now,
  });
  await indexGroupMessage(db, command.enterpriseId, messageId, task.sourceMessageId);
  await insert(db, "byai_group_chat_task_publication", {
    task_session_id: taskId,
    group_session_id: command.sessionId,
    pending_publication_id: p.pendingPublicationId ?? null,
    message_id: messageId,
    publisher_user_id: command.userId,
    text_content: content,
    files_json: JSON.stringify(files),
    create_time: now,
  });
  await db.query(
    "UPDATE byai.byai_group_chat_task SET status='PUBLISHED',publish_message_id=$1,publish_by=$2,update_time=CURRENT_TIMESTAMP WHERE task_session_id=$3 AND group_session_id=$4",
    [messageId, command.userId, taskId, command.sessionId],
  );
  await db.query("DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1", [
    taskId,
  ]);
}
