import { lockBusiness } from "./session-locks.js";
import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
import { indexGroupMessage } from "./group-message-index.js";
import { verifyPrivatePublicationFiles } from "./private-publication-files.js";

/** BE 可将草稿中的群成员提及转换为引用占位符，其他正文必须与当前草稿逐字一致。 */
function verifyPrivateText(raw: string, payload: Record<string, any>) {
  if ((payload.preparedText ?? payload.text ?? "") !== raw)
    throw new DomainError("PENDING_PUBLICATION_CHANGED");
  const resources = Array.isArray(payload.metadata?.resourceList)
    ? payload.metadata.resourceList
    : [];
  const mentions = new Set(resources.map((resource: Record<string, unknown>) => resource?.id));
  const normalized = raw.replace(
    /\[@([^\]\r\n]+)\]\(uid=((?:HUMAN|DIG_EMPLOYEE)_[1-9]\d*)\)/g,
    (literal, _name, uid) => (mentions.has(uid) ? `{{${uid}}}` : literal),
  );
  if (normalized !== (payload.text ?? "")) throw new DomainError("PENDING_PUBLICATION_CHANGED");
}

/** 在同一事务写入群消息、不可变发布回执并清理卡片。私聊按草稿版本发布，普通任务按任务完成。 */
export async function publishTask(context: CommandContext): Promise<Record<string, any>> {
  const { db, command } = context,
    p = command.payload,
    taskId = requireId(p.taskSessionId);
  await lockBusiness(db, `task:${taskId}`);
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 AND group_session_id=$2",
    [taskId, command.sessionId],
  );
  if (!task || task.initiatorUserId !== command.userId)
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const direct = task.status === "PRIVATE";
  const pendingId =
    direct || p.pendingPublicationId !== undefined ? requireId(p.pendingPublicationId) : null;
  const existing = await first(
    db,
    direct
      ? "SELECT * FROM byai.byai_group_chat_private_publication WHERE task_session_id=$1 AND pending_publication_id=$2"
      : "SELECT * FROM byai.byai_group_chat_task_publication WHERE task_session_id=$1",
    direct ? [taskId, pendingId] : [taskId],
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
        ...(direct ? { newlyPublished: false } : {}),
      },
    };
  }
  if (!direct && (task.status !== "ACTIVE" || task.turnStatus === "RUNNING"))
    throw new DomainError("TASK_NOT_READY_FOR_PUBLICATION");
  let pending = null;
  if (pendingId) {
    pending = await first(
      db,
      "SELECT * FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
      [taskId],
    );
    if (pending?.pendingPublicationId !== pendingId)
      throw new DomainError("PENDING_PUBLICATION_CHANGED");
    if (direct) verifyPrivateText(pending.textContent ?? "", p);
  }
  const content = text(p.text ?? "", 1048576, true),
    rawFiles = p.files ?? [];
  if (
    !Array.isArray(rawFiles) ||
    rawFiles.length > 100 ||
    rawFiles.some((file) => !file || file.resourceAuthorized !== true)
  )
    throw new DomainError("INVALID_PUBLICATION_FILES");
  const files = rawFiles.map(({ resourceAuthorized: _authorized, ...file }: Record<string, any>) =>
    direct
      ? {
          ...(file.fileId == null ? {} : { fileId: String(file.fileId) }),
          fileName: file.fileName,
          filePath: file.filePath,
          cloudResourceId: file.cloudResourceId,
        }
      : file,
  );
  if (direct) verifyPrivatePublicationFiles(pending!, files);
  if (!content.trim() && !files.length) throw new DomainError("INVALID_PUBLICATION_CONTENT");
  const messageId = await nextId(db, command.enterpriseId),
    now = new Date();
  const reference = direct ? null : task.sourceMessageId;
  await insert(db, "byai_message", {
    id: messageId,
    message_ref: reference,
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
      // 私聊的来源只写不可变回执，对群公开的消息不携带私聊会话入口。
      ...(direct
        ? { resourceList: p.metadata?.resourceList ?? [], targetAgentId: task.targetAgentId }
        : { ...(p.metadata ?? {}), taskId }),
      scene: "GROUP_CHAT",
      kind: "TASK_RESULT",
      files,
    }),
    create_time: now,
    update_time: now,
  });
  await indexGroupMessage(db, command.enterpriseId, messageId, reference);
  await insert(
    db,
    direct ? "byai_group_chat_private_publication" : "byai_group_chat_task_publication",
    {
      task_session_id: taskId,
      group_session_id: command.sessionId,
      pending_publication_id: pendingId,
      message_id: messageId,
      publisher_user_id: command.userId,
      text_content: content,
      files_json: JSON.stringify(files),
      create_time: now,
    },
  );
  if (!direct)
    await db.query(
      "UPDATE byai.byai_group_chat_task SET status='PUBLISHED',publish_message_id=$1,publish_by=$2,update_time=CURRENT_TIMESTAMP WHERE task_session_id=$3 AND group_session_id=$4",
      [messageId, command.userId, taskId, command.sessionId],
    );
  await db.query(
    direct
      ? "DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1 AND pending_publication_id=$2"
      : "DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
    direct ? [taskId, pendingId] : [taskId],
  );
  return {
    messageId,
    data: {
      taskId,
      messageId,
      pendingPublicationId: pendingId,
      text: content,
      files,
      ...(direct ? { newlyPublished: true } : {}),
    },
  };
}
