import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text, truncateUtf8 } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
import { directSessionsOfGroup, findDirectTask, requireGroupAgent } from "./group-direct-task.js";

export async function nickname(context: CommandContext) {
  const { db, command } = context;
  const name = text(command.payload.nickname, 100, true).trim();
  if (!name || (await context.session())?.sessionType !== "hs_as" || !(await context.member()))
    throw new DomainError("INVALID_NICKNAME");
  await db.query(
    "UPDATE byai.byai_session_member SET mem_name=$1 WHERE session_id=$2 AND mem_obj_type='USER' AND mem_obj_id=$3 AND com_acct_id=$4",
    [name, command.sessionId, command.userId, command.enterpriseId],
  );
  return { data: await context.member() };
}

/** 两个群内私聊入口解析同一会话。旧入口沿用会话 DTO，任务入口返回 PRIVATE 任务。 */
export async function directSession(context: CommandContext) {
  const { db, command } = context;
  const id = await ensureDirectTask(context);
  return {
    data: await first(
      db,
      "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [id, command.enterpriseId],
    ),
  };
}

async function createDirectSession(
  context: CommandContext,
  projectId: string,
  agentId: string,
  taskName: string,
) {
  const { db, command } = context;
  const id = await nextId(db, command.enterpriseId);
  await insert(db, "byai_session", {
    session_id: id,
    parent_session_id: command.sessionId,
    project_id: projectId,
    enterprise_id: command.enterpriseId,
    creator_id: command.userId,
    object_id: agentId,
    session_type: "h_as",
    session_name: taskName,
    state: "ACTIVE",
    last_seq: "0",
    create_time: new Date(),
    update_time: new Date(),
  });
  const latest = await first(
    db,
    "SELECT MAX(message_id)::text AS id FROM byai.byai_message WHERE session_id=$1 AND enterprise_id=$2",
    [command.sessionId, command.enterpriseId],
  );
  for (const [code, value] of [
    ["group_source_session_id", command.sessionId],
    ["group_source_boundary_message_id", latest?.id ?? "0"],
  ])
    await insert(db, "byai_session_ext", {
      ext_id: await nextId(db, command.enterpriseId),
      session_id: id,
      ext_param_name: code,
      ext_param_code: code,
      ext_param_value: value,
    });
  return id;
}

/** 私聊任务与普通单聊同源，只额外写入群任务表，不进入群任务执行链路。 */
export async function directTask(context: CommandContext) {
  const id = await ensureDirectTask(context);
  return {
    data: await first(
      context.db,
      "SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1",
      [id],
    ),
  };
}

async function ensureDirectTask(context: CommandContext) {
  const { db, command } = context;
  const group = await context.session();
  const agentId = requireId(command.payload.agentId);
  if (group?.sessionType !== "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const agent = await requireGroupAgent(db, command.sessionId, agentId, command.enterpriseId);
  const existing = await findDirectTask(
    db,
    command.enterpriseId,
    command.sessionId,
    command.userId,
    agentId,
  );
  const legacy = existing
    ? null
    : await first(
        db,
        `SELECT s.session_id,s.state FROM byai.byai_session s WHERE s.enterprise_id=$1 AND s.creator_id=$2
      AND s.parent_session_id=$3 AND s.object_id=$4 AND s.session_type='h_as' AND COALESCE(s.state,'ACTIVE') IN('ACTIVE','CLOSED')
      AND s.session_id IN (${directSessionsOfGroup})
      AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_task t WHERE t.task_session_id=s.session_id)
      ORDER BY s.create_time,s.session_id LIMIT 1`,
        [command.enterpriseId, command.userId, command.sessionId, agentId],
      );
  const taskName = truncateUtf8(`与${agent.name || "数字员工"}的私聊`, 255);
  const id =
    existing?.taskSessionId ??
    legacy?.sessionId ??
    (await createDirectSession(context, group.projectId, agentId, taskName));
  if (!existing) await insertDirectTask(context, id, agentId, taskName);
  if (!existing?.boundId)
    await insert(db, "byai_group_chat_direct_binding", {
      group_session_id: command.sessionId,
      initiator_user_id: command.userId,
      target_agent_id: agentId,
      task_session_id: id,
    });
  // 旧客户端可关闭会话或取消私聊任务。沿用原始 ID 和消息历史恢复入口。
  if (
    existing?.sessionState === "CLOSED" ||
    legacy?.state === "CLOSED" ||
    (existing && existing.sessionAgentId == null)
  )
    await db.query(
      "UPDATE byai.byai_session SET state=CASE WHEN state='CLOSED' THEN 'ACTIVE' ELSE state END,object_id=$3,update_time=CURRENT_TIMESTAMP WHERE session_id=$1 AND enterprise_id=$2",
      [id, command.enterpriseId, agentId],
    );
  if (existing)
    await db.query(
      "UPDATE byai.byai_group_chat_task SET status='PRIVATE',turn_status='PRIVATE',update_time=CURRENT_TIMESTAMP WHERE task_session_id=$1 AND status='CANCELLED' AND turn_status='PRIVATE'",
      [id],
    );
  return id;
}

async function insertDirectTask(
  context: CommandContext,
  id: string,
  agentId: string,
  taskName: string,
) {
  const { db, command } = context;
  await insert(db, "byai_group_chat_task", {
    task_session_id: id,
    group_session_id: command.sessionId,
    // 私聊是独立会话。每轮输入的镜像另外冻结原群的公开历史边界。
    source_message_id: "0",
    dispatch_id: await nextId(db, command.enterpriseId),
    initiator_user_id: command.userId,
    target_agent_id: agentId,
    task_name: taskName,
    status: "PRIVATE",
    turn_status: "PRIVATE",
    create_time: new Date(),
    update_time: new Date(),
  });
}
