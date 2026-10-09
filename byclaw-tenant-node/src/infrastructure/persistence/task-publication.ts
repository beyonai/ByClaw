import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";

/** BE 负责文件上传与授权；Node 原子写入群消息、publication、PUBLISHED 状态并清理待发布卡片。 */
export async function publishTask(context: CommandContext): Promise<Record<string, any>> {
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
  const existing = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task_publication WHERE task_session_id=$1",
    [taskId],
  );
  if (existing) {
    if (
      p.pendingPublicationId !== undefined &&
      existing.pendingPublicationId !== p.pendingPublicationId
    )
      throw new DomainError("PENDING_PUBLICATION_CHANGED");
    return {
      messageId: existing.messageId,
      data: {
        taskId,
        messageId: existing.messageId,
        pendingPublicationId: existing.pendingPublicationId,
        text: existing.textContent,
        files: JSON.parse(existing.filesJson ?? "[]"),
      },
    };
  }
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
    rawFiles = p.files ?? [];
  if (
    !Array.isArray(rawFiles) ||
    rawFiles.length > 100 ||
    rawFiles.some((file) => !file || file.resourceAuthorized !== true)
  )
    throw new DomainError("INVALID_PUBLICATION_FILES");
  const files = rawFiles.map(
    ({ resourceAuthorized: _authorized, ...file }: Record<string, any>) => file,
  );
  if (!content.trim() && !files.length) throw new DomainError("INVALID_PUBLICATION_CONTENT");
  const messageId = await nextId(db, command.enterpriseId),
    now = new Date();
  await insert(db, "byai_message", {
    id: messageId,
    message_ref: task.sourceMessageId,
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
  return {
    messageId,
    data: {
      taskId,
      messageId,
      pendingPublicationId: p.pendingPublicationId ?? null,
      text: content,
      files,
    },
  };
}
