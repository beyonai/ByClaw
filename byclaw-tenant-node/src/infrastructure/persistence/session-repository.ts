import type { SessionRepository } from "../../application/session-queries.js";
import type { SqlSession } from "../../application/database-ports.js";
export class SqlSessionRepository implements SessionRepository {
  constructor(
    private readonly db: SqlSession,
    private readonly enterpriseId: string,
  ) {}
  async list(actor: string, page: number, size: number, keyword: string) {
    const params = [this.enterpriseId, actor, `%${keyword}%`];
    const where =
      "enterprise_id=$1 AND creator_id=$2 AND session_type='h_as' AND COALESCE(state,'ACTIVE') NOT IN('CLOSED','GROUP_CHAT_ROUTING') AND session_name LIKE $3 ESCAPE '\\' AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_task t WHERE t.task_session_id=byai_session.session_id)";
    const [total] = await this.db.query(
      `SELECT COUNT(*) AS count FROM byai.byai_session WHERE ${where}`,
      params,
    );
    const list = await this.db.query(
      `SELECT session_id::text AS "sessionId",session_name AS "sessionName",session_type AS "sessionType",create_time AS "createTime",update_time AS "updateTime" FROM byai.byai_session WHERE ${where} ORDER BY update_time DESC,session_id DESC LIMIT $4 OFFSET $5`,
      [...params, size, (page - 1) * size],
    );
    return { list, total: Number(total?.count ?? 0), pageNum: page, pageSize: size };
  }
}
