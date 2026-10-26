import { lockBusiness } from "./session-locks.js";
import {
  objectJson,
  recallIdentity,
  recallContent,
} from "../../application/history/message-format.js";
import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId, camel } from "./sql-utils.js";
import { GROUP_COORDINATOR_AGENT_ID } from "../../domain/group-coordination.js";
import { groupNameExists } from "./group-name.js";
import { workgroupName } from "../../domain/workgroup-name.js";

/** 创建个人或群会话；群成员与默认设置在外层命令事务内一并写入，项目编排由 BE 负责。 */
export async function createSession(context: CommandContext): Promise<void> {
  const { command, db } = context,
    p = command.payload;
  if (await context.session()) throw new DomainError("SESSION_EXISTS");
  const group = command.operation === "CREATE_GROUP";
  const name = group ? workgroupName(p.sessionName) : text(p.sessionName, 255, true);
  if (!name.trim()) throw new DomainError("INVALID_SESSION_NAME");
  if (group) {
    // Different session IDs can still compete for one name; serialize the availability check and insert.
    await lockBusiness(db, `group-name:${command.enterpriseId}:${command.userId}:${name}`);
    if (await groupNameExists(db, command.enterpriseId, command.userId, name))
      throw new DomainError("GROUP_NAME_EXISTS");
  }
  if (!group && p.sessionType !== undefined && p.sessionType !== "h_as")
    throw new DomainError("INVALID_SESSION_TYPE");
  await insert(db, "byai_session", {
    session_id: command.sessionId,
    creator_id: command.userId,
    enterprise_id: command.enterpriseId,
    session_name: name,
    session_content: text(p.sessionContent ?? "", 4000, true),
    session_type: group ? "hs_as" : "h_as",
    project_id: group
      ? requireId(p.projectId)
      : p.projectId == null || p.projectId === "-1"
        ? "-1"
        : requireId(p.projectId),
    ...(!group && p.agentId != null
      ? { object_id: requireId(p.agentId), object_type: "AGENT" }
      : {}),
    state: "ACTIVE",
    last_seq: "0",
    create_time: new Date(),
    update_time: new Date(),
  });
  if (group) {
    await createMembers(context);
    if (p.coordinatorAgentId !== undefined) {
      const coordinatorAgentId = requireId(p.coordinatorAgentId);
      if (
        !p.members.some(
          (member: any) => member.memObjType === "AGENT" && member.memObjId === coordinatorAgentId,
        )
      )
        throw new DomainError("INVALID_GROUP_COORDINATOR");
      await context.setExtension(GROUP_COORDINATOR_AGENT_ID, coordinatorAgentId);
    }
    for (const [code, value] of [
      ["group_join_link_enabled", "true"],
      ["group_member_add_agent_enabled", "false"],
      ["group_member_invite_user_enabled", "false"],
    ])
      await context.setExtension(code!, value!);
  }
}
async function createMembers(context: CommandContext): Promise<void> {
  const { command, db } = context,
    members = command.payload.members;
  if (
    !Array.isArray(members) ||
    !members.length ||
    members.length > 1000 ||
    members.some((member) => !member || typeof member !== "object" || Array.isArray(member)) ||
    members.filter((member) => member.userRole === "OWNER").length !== 1 ||
    !members.some(
      (member) =>
        member.memObjType === "USER" &&
        member.memObjId === command.userId &&
        member.userRole === "OWNER",
    )
  )
    throw new DomainError("INVALID_GROUP_MEMBERS");
  const seen = new Set<string>();
  for (const member of members) {
    requireId(member.memObjId);
    const key = `${member.memObjType}:${member.memObjId}`;
    if (
      seen.has(key) ||
      !["USER", "AGENT"].includes(member.memObjType) ||
      !["OWNER", "ADMIN", "MEMBER"].includes(member.userRole) ||
      (member.memObjType === "USER" && !command.tenantMemberUserIds.includes(member.memObjId)) ||
      (member.memObjType === "AGENT" &&
        (member.userRole !== "MEMBER" || member.resourceAuthorized !== true))
    )
      throw new DomainError("INVALID_GROUP_MEMBERS");
    seen.add(key);
    await insert(db, "byai_session_member", {
      byai_session_member_id: await nextId(db, command.enterpriseId),
      session_id: command.sessionId,
      mem_obj_type: member.memObjType,
      mem_obj_id: member.memObjId,
      user_role: member.userRole,
      mem_name: text(member.memName ?? "", 255),
      creator_id: command.userId,
      com_acct_id: command.enterpriseId,
      create_time: new Date(),
    });
  }
}
/** 个人删除写 CLOSED；群使用独立解散命令，群名称/内容修改要求 OWNER 或 ADMIN。 */
export async function changeSession(context: CommandContext): Promise<void> {
  const { command, db } = context,
    session = await context.session();
  if (session?.sessionType === "hs_as") {
    if (command.operation === "DELETE_SESSION") throw new DomainError("USE_GROUP_DISSOLUTION");
    await context.requireRole(["OWNER", "ADMIN"]);
  }
  if (command.operation === "DELETE_SESSION") {
    await db.query(
      "UPDATE byai.byai_session SET state='CLOSED',update_time=CURRENT_TIMESTAMP WHERE session_id=$1 AND enterprise_id=$2",
      [command.sessionId, command.enterpriseId],
    );
    return;
  }
  const p = command.payload;
  if (
    !Object.keys(p).length ||
    Object.keys(p).some((key) => !["sessionName", "sessionContent"].includes(key))
  )
    throw new DomainError("INVALID_SESSION_UPDATE");
  await db.query(
    "UPDATE byai.byai_session SET session_name=$1,session_content=$2,update_time=CURRENT_TIMESTAMP WHERE session_id=$3 AND enterprise_id=$4",
    [
      p.sessionName === undefined ? session!.sessionName : text(p.sessionName, 255, true),
      p.sessionContent === undefined ? session!.sessionContent : text(p.sessionContent, 4000, true),
      command.sessionId,
      command.enterpriseId,
    ],
  );
}
/** 确认消息属于本群后单调推进已读游标，旧请求不会把游标回退。 */
export async function readState(context: CommandContext): Promise<void> {
  const { command, db } = context,
    messageId = requireId(command.payload.messageId);
  if (
    !(await context.member()) ||
    !(await first(
      db,
      "SELECT 1 FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3",
      [command.sessionId, messageId, command.enterpriseId],
    ))
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  await db.query(
    "UPDATE byai.byai_session_member SET last_read_message_id=GREATEST(COALESCE(last_read_message_id,0),$1) WHERE session_id=$2 AND mem_obj_type='USER' AND mem_obj_id=$3 AND com_acct_id=$4",
    [messageId, command.sessionId, command.userId, command.enterpriseId],
  );
}
/** 消息作者或群管理员可撤回；保留原行并记录撤回身份，读取侧负责内容脱敏。 */
export async function recallMessage(context: CommandContext): Promise<Record<string, any>> {
  const { command, db } = context,
    messageId = requireId(command.payload.messageId);
  const message = await first(
    db,
    "SELECT creator_id,usage,metadata FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3 AND archived_at IS NULL",
    [command.sessionId, messageId, command.enterpriseId],
  );
  if (!message) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (![1, 2].includes(message.usage)) throw new DomainError("SYSTEM_MESSAGE_CANNOT_BE_RECALLED");
  if (message.usage !== 1 || message.creatorId !== command.userId)
    await context.requireRole(["OWNER", "ADMIN"]);
  const metadata = objectJson(message.metadata);
  const previousRecall = objectJson(metadata.recallUndo).recalledAt;
  // 毫秒时间也是撤销请求的版本，同一毫秒再次撤回必须前进，不能复用旧版本。
  const minimumRecallTime = new Date(
    Number.isSafeInteger(previousRecall) && previousRecall > 0 ? previousRecall + 1 : 0,
  );
  metadata.recall = {
    operatorId: command.userId,
    operatorName: (await context.member())?.memName || command.userId,
  };
  await db.query(
    "UPDATE byai.byai_message SET recalled_at=COALESCE(recalled_at,GREATEST(CURRENT_TIMESTAMP::timestamp,$6::timestamp)),recalled_by=COALESCE(recalled_by,$1),metadata=CASE WHEN recalled_at IS NULL THEN $5 ELSE metadata END WHERE message_id=$2 AND session_id=$3 AND enterprise_id=$4",
    [
      command.userId,
      messageId,
      command.sessionId,
      command.enterpriseId,
      JSON.stringify(metadata),
      minimumRecallTime,
    ],
  );
  // 按源消息取消任务；重复撤回仍返回取消任务，供 BE 重试未完成的外部停止。
  await db.query(
    "WITH RECURSIVE affected(message_id) AS (SELECT $2::bigint UNION SELECT m.message_id FROM byai.byai_message m JOIN affected a ON m.message_ref=a.message_id WHERE m.session_id=$1) UPDATE byai.byai_group_chat_execution SET status='CANCELLED',finish_time=CURRENT_TIMESTAMP WHERE group_session_id=$1 AND source_message_id IN (SELECT message_id FROM affected) AND status IN ('QUEUED','RUNNING')",
    [command.sessionId, messageId],
  );
  const tasks = (
    await db.query(
      "WITH RECURSIVE affected(message_id) AS (SELECT $2::bigint UNION SELECT m.message_id FROM byai.byai_message m JOIN affected a ON m.message_ref=a.message_id WHERE m.session_id=$1) UPDATE byai.byai_group_chat_task SET status='CANCELLED',update_time=CURRENT_TIMESTAMP WHERE group_session_id=$1 AND source_message_id IN (SELECT message_id FROM affected) AND status IN ('ACTIVE','CANCELLED') RETURNING *",
      [command.sessionId, messageId],
    )
  ).map(camel);
  await db.query(
    "DELETE FROM byai.byai_group_chat_pending_publication WHERE task_session_id=ANY($1::bigint[])",
    [tasks.map((task) => task.taskSessionId)],
  );
  const saved = await first(
    db,
    "SELECT recalled_at,recalled_by,metadata FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3",
    [command.sessionId, messageId, command.enterpriseId],
  );
  return {
    data: {
      messageId,
      tasks,
      recalled: true,
      recall: recallIdentity(saved!),
      content: recallContent(saved!),
    },
  };
}

/** 仅恢复原消息展示；取消过的执行、任务和停止补偿保持原状态。调用方持有会话事务锁。 */
export async function undoRecallMessage(context: CommandContext): Promise<Record<string, any>> {
  const { command, db } = context;
  const messageId = requireId(command.payload.messageId);
  const recalledAt = command.payload.recalledAt;
  if (!Number.isSafeInteger(recalledAt) || recalledAt <= 0)
    throw new DomainError("INVALID_RECALLED_AT");
  if (Object.keys(command.payload).some((key) => !["messageId", "recalledAt"].includes(key)))
    throw new DomainError("INVALID_COMMAND");
  const session = await context.session();
  if (session?.sessionType !== "hs_as" || !(await context.member()))
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const message = await first(
    db,
    "SELECT usage,recalled_at,recalled_by,metadata,clock_timestamp()::timestamp AS server_now FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3 AND archived_at IS NULL",
    [command.sessionId, messageId, command.enterpriseId],
  );
  if (!message || ![1, 2].includes(message.usage)) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const metadata = objectJson(message.metadata);
  const data = { messageId, recalled: false, recall: null };
  if (message.recalledAt == null) {
    const receipt = objectJson(metadata.recallUndo);
    if (receipt.recalledAt !== recalledAt) throw new DomainError("RECALL_UNDO_CONFLICT");
    if (receipt.operatorId !== command.userId) throw new DomainError("RECALL_UNDO_FORBIDDEN");
    return { data: { ...data, changed: false } };
  }
  if (String(message.recalledBy) !== command.userId) throw new DomainError("RECALL_UNDO_FORBIDDEN");
  const savedAt = new Date(message.recalledAt).getTime();
  if (savedAt !== recalledAt) throw new DomainError("RECALL_UNDO_CONFLICT");
  // 与无时区的 recalled_at 使用同一数据库时钟，避免 Node 与数据库时区不同影响窗口。
  const now = new Date(message.serverNow).getTime();
  if (savedAt > now || now - savedAt > 120000) throw new DomainError("RECALL_UNDO_EXPIRED");
  // 保留一次恢复凭据以识别重试；后续撤回仍先比较当前撤回时间，不会被旧请求恢复。
  metadata.recallUndo = { operatorId: command.userId, recalledAt };
  delete metadata.recall;
  const updated = await db.query(
    "UPDATE byai.byai_message SET recalled_at=NULL,recalled_by=NULL,metadata=$4,update_time=$7 WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3 AND recalled_by=$5 AND recalled_at=$6 AND recalled_at >= $8 AND recalled_at <= $7 AND archived_at IS NULL AND usage IN(1,2) RETURNING message_id",
    [
      command.sessionId,
      messageId,
      command.enterpriseId,
      JSON.stringify(metadata),
      command.userId,
      new Date(message.recalledAt),
      new Date(now),
      new Date(now - 120000),
    ],
  );
  if (updated.length !== 1) throw new DomainError("RECALL_UNDO_CONFLICT");
  return { data: { ...data, changed: true } };
}
