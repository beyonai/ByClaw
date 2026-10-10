import type { SessionRepository } from "../../application/session-queries.js";
import type { SqlSession } from "../../application/database-ports.js";
/** 个人会话 SQL 查询；排除关闭、路由中及群任务私有会话，避免混入普通列表。 */
export class SqlSessionRepository implements SessionRepository {
  constructor(
    private readonly db: SqlSession,
    private readonly enterpriseId: string,
  ) {}
  async children(actor: string, parentId: string, page: number, size: number) {
    const params = [this.enterpriseId, actor, parentId];
    const where =
      "enterprise_id=$1 AND creator_id=$2 AND parent_session_id=$3 AND COALESCE(state,'ACTIVE') NOT IN('CLOSED','GROUP_CHAT_ROUTING','GROUP_TASK_CANDIDATE','GROUP_CHAT_DISPATCH')";
    const [total] = await this.db.query(
      `SELECT COUNT(*) AS count FROM byai.byai_session WHERE ${where}`,
      params,
    );
    const list = await this.db.query(
      `SELECT session_id::text AS "sessionId",parent_session_id::text AS "parentSessionId",object_id::text AS "objectId",object_type AS "objectType",state,session_name AS "sessionName",session_type AS "sessionType",session_content AS "sessionContent",creator_id::text AS "creatorId",enterprise_id::text AS "enterpriseId",project_id::text AS "projectId",create_time AS "createTime",update_time AS "updateTime" FROM byai.byai_session WHERE ${where} ORDER BY update_time DESC,session_id DESC LIMIT $4 OFFSET $5`,
      [...params, size, (page - 1) * size],
    );
    return { list, total: Number(total?.count ?? 0), pageNum: page, pageSize: size };
  }
  async list(
    actor: string,
    page: number,
    size: number,
    keyword: string,
    types: string[],
    projectId?: string,
    agentId?: string,
    parentSessionId?: string,
  ) {
    const params = projectId
      ? [this.enterpriseId, actor, `%${keyword}%`, types, projectId]
      : [this.enterpriseId, actor, `%${keyword}%`, types];
    let where =
      "enterprise_id=$1 AND session_type=ANY($4::text[]) AND (creator_id=$2 OR EXISTS(SELECT 1 FROM byai.byai_session_member m WHERE m.session_id=byai_session.session_id AND m.mem_obj_type='USER' AND m.mem_obj_id=$2 AND m.com_acct_id=$1)) AND COALESCE(state,'ACTIVE') NOT IN('CLOSED','GROUP_CHAT_ROUTING','GROUP_TASK_CANDIDATE','GROUP_CHAT_DISPATCH') AND COALESCE(session_name,'') LIKE $3 ESCAPE '\\' AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_task t WHERE t.task_session_id=byai_session.session_id)" +
      (projectId ? " AND project_id::text=$5" : "");
    if (agentId) {
      params.push(agentId);
      const agentParam = `$${params.length}`;
      where += ` AND creator_id=$2 AND (object_id::text=${agentParam} OR EXISTS(SELECT 1 FROM byai.byai_session_member a WHERE a.session_id=byai_session.session_id AND a.mem_obj_type='AGENT' AND a.mem_obj_id::text=${agentParam} AND a.com_acct_id=$1))`;
    }
    if (parentSessionId) {
      params.push(parentSessionId);
      where += ` AND parent_session_id=$${params.length}`;
    } else {
      where += " AND parent_session_id IS NULL";
    }
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    const [total] = await this.db.query(
      `SELECT COUNT(*) AS count FROM byai.byai_session WHERE ${where}`,
      params,
    );
    const list = await this.db.query(
      `SELECT session_id::text AS "sessionId",parent_session_id::text AS "parentSessionId",session_name AS "sessionName",session_type AS "sessionType",session_content AS "sessionContent",creator_id::text AS "creatorId",enterprise_id::text AS "enterpriseId",project_id::text AS "projectId",create_time AS "createTime",update_time AS "updateTime" FROM byai.byai_session WHERE ${where} ORDER BY update_time DESC,session_id DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, size, (page - 1) * size],
    );
    return { list, total: Number(total?.count ?? 0), pageNum: page, pageSize: size };
  }
}
