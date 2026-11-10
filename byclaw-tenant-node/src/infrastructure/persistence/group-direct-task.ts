import type { SqlSession } from "../../application/database-ports.js";
import { DomainError } from "../../domain/errors.js";
import { first } from "./sql-utils.js";

/** 旧私聊入口写入此服务端扩展，普通个人会话或执行器子会话均不能作为旧私聊接管。 */
export const directSessionsOfGroup = `SELECT x.session_id FROM byai.byai_session_ext x
  WHERE x.ext_param_code='group_source_session_id' AND x.ext_param_value=$3::text AND x.session_id IS NOT NULL`;

export async function isLegacyDirectSession(db: SqlSession, sessionId: string, parentId: string) {
  return !!(await first(
    db,
    "SELECT 1 FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code='group_source_session_id' AND ext_param_value=$2",
    [sessionId, parentId],
  ));
}

/** 群命令持有同一群的事务锁。历史私聊按创建时间和 ID 选定，后续直接使用持久绑定。 */
export const rankedDirectTasks = `
  SELECT t.task_session_id,b.task_session_id AS bound_id,s.state AS session_state,s.object_id AS session_agent_id,
    ROW_NUMBER() OVER (PARTITION BY t.target_agent_id ORDER BY
      CASE WHEN t.status='PRIVATE' THEN 0 ELSE 1 END,t.create_time,t.task_session_id) AS preference
  FROM byai.byai_group_chat_task t
  JOIN byai.byai_session s ON s.session_id=t.task_session_id AND s.enterprise_id=$1
    AND s.creator_id=t.initiator_user_id AND s.parent_session_id=t.group_session_id
    AND (s.object_id IS NULL OR s.object_id=t.target_agent_id) AND s.session_type='h_as'
  LEFT JOIN byai.byai_group_chat_direct_binding b ON b.group_session_id=t.group_session_id
    AND b.initiator_user_id=t.initiator_user_id AND b.target_agent_id=t.target_agent_id
  WHERE t.group_session_id=$3 AND t.initiator_user_id=$2
    AND (t.status='PRIVATE' OR (t.status='CANCELLED' AND t.turn_status='PRIVATE'))
    AND (b.task_session_id IS NULL OR t.task_session_id=b.task_session_id)`;

export function findDirectTask(
  db: SqlSession,
  tenant: string,
  groupId: string,
  actor: string,
  agentId: string,
) {
  return first(
    db,
    `SELECT * FROM (${rankedDirectTasks} AND t.target_agent_id=$4) ranked WHERE preference=1`,
    [tenant, actor, groupId, agentId],
  );
}

/** 历史重复会话保留消息，只有固定的私聊会话可以继续发送或准备新的群成果。 */
export async function requireWritableDirectTask(
  db: SqlSession,
  tenant: string,
  group: string,
  actor: string,
  agent: string,
  taskId: string,
) {
  await requireGroupAgent(db, group, agent, tenant);
  const direct = await findDirectTask(db, tenant, group, actor, agent);
  if (direct?.taskSessionId !== taskId || direct.sessionState === "CLOSED")
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
}

/** 群成员移除后不能凭已有私聊 ID 继续向该员工派发或发布。 */
export async function requireGroupAgent(
  db: SqlSession,
  groupId: string,
  agentId: string,
  tenant: string,
) {
  const member = await first(
    db,
    "SELECT mem_name AS name FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
    [groupId, agentId, tenant],
  );
  if (!member) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  return member;
}
