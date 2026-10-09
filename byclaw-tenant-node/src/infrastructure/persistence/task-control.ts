import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import { first } from "./sql-utils.js";

/** 先持久化取消，迟到回答不得再次发布；停止运行由 BE 在提交后完成。 */
export async function cancelTask(context: CommandContext) {
  const { db, command } = context;
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 AND group_session_id=$2 FOR UPDATE",
    [requireId(command.payload.taskSessionId), command.sessionId],
  );
  if (!task) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (task.initiatorUserId !== command.userId) await context.requireRole(["OWNER", "ADMIN"]);
  if (task.status === "PUBLISHED") throw new DomainError("TASK_ALREADY_TERMINAL");
  await db.query(
    "UPDATE byai.byai_group_chat_task SET status='CANCELLED',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1",
    [task.taskSessionId],
  );
  await db.query("DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1", [
    task.taskSessionId,
  ]);
  return { data: { ...task, status: "CANCELLED" } };
}

/** 文件仍由 BE 上传，只将可重试的上传进度写入当前版本的待发布卡片。 */
export async function checkpointPublication(context: CommandContext) {
  const { command, db } = context;
  const p = command.payload;
  const taskId = requireId(p.taskSessionId);
  const task = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1 AND group_session_id=$2 FOR UPDATE",
    [taskId, command.sessionId],
  );
  if (!task || task.initiatorUserId !== command.userId || task.status !== "ACTIVE")
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const pending = await first(
    db,
    "SELECT * FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1 FOR UPDATE",
    [taskId],
  );
  if (!pending || pending.pendingPublicationId !== requireId(p.pendingPublicationId))
    throw new DomainError("PENDING_PUBLICATION_CHANGED");
  const cloudId = requireId(p.cloudResourceId);
  if (pending.cloudResourceId && pending.cloudResourceId !== cloudId)
    throw new DomainError("PUBLICATION_CLOUD_CHANGED");
  if (!p.uploadedFiles || typeof p.uploadedFiles !== "object" || Array.isArray(p.uploadedFiles))
    throw new DomainError("INVALID_PUBLICATION_FILES");
  await db.query(
    "UPDATE byai.byai_group_chat_pending_publication SET cloud_resource_id=$1,uploaded_files_json=$2 WHERE task_session_id=$3 AND pending_publication_id=$4",
    [cloudId, JSON.stringify(p.uploadedFiles), taskId, pending.pendingPublicationId],
  );
}
