import type { SqlSession } from "../../application/database-ports.js";

/** 仅读取附件相关列；时间边界由数据库比较，保留 PostgreSQL 时间戳精度。 */
export async function groupFileMessagePage(
  db: SqlSession,
  tenantId: string,
  sessionId: string,
  before: string | undefined,
  inclusive: boolean,
  limit: number,
) {
  const parameters: unknown[] = [tenantId, sessionId];
  let boundary = "";
  let condition = "";
  if (before !== undefined) {
    parameters.push(before);
    boundary =
      "JOIN byai.byai_message boundary ON boundary.session_id=m.session_id AND boundary.message_id=$3::bigint";
    const comparison = inclusive ? "<=" : "<";
    condition = `AND ((m.create_time,m.message_id)${comparison}(boundary.create_time,boundary.message_id)
      OR (m.create_time IS NULL AND (boundary.create_time IS NOT NULL OR m.message_id${comparison}boundary.message_id)))`;
  }
  parameters.push(limit);
  return db.query(
    `SELECT m.message_id,m.session_id,m.create_time,m.related_resources,m.metadata
    FROM byai.byai_message m
    JOIN byai.byai_session s ON s.session_id=m.session_id
    ${boundary}
    WHERE s.enterprise_id=$1 AND m.session_id=$2
      AND m.archived_at IS NULL AND m.recalled_at IS NULL AND m.usage IN(1,2)
      AND (NULLIF(TRIM(m.related_resources),'') IS NOT NULL OR NULLIF(TRIM(m.metadata),'') IS NOT NULL)
      ${condition}
    ORDER BY m.create_time DESC NULLS LAST,m.message_id DESC
    LIMIT $${parameters.length}`,
    parameters,
  );
}
