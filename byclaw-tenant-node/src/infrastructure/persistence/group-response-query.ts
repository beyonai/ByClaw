import type { SqlSession } from "../../application/database-ports.js";
import type { Row } from "../../application/history/contracts.js";

/** Group-scoped execution projection. No candidate answer body is selected. */
export async function readGroupResponses(
  db: SqlSession,
  enterpriseId: string,
  groupId: string,
  after: string,
  limit: number,
  responseIds?: string[],
): Promise<Row[]> {
  const rows = await db.query(
    `
    SELECT 'execution:' || e.execution_id AS response_id, e.execution_id, e.group_session_id,
      e.source_message_id, e.target_agent_id, e.initiator_user_id, e.status, e.disposition,
      e.create_time, e.candidate_session_id, e.trace_id, e.answer_message_id,
      s.message_content AS source_content, s.metadata AS source_metadata,
      s.creator_name AS source_name, s.creator_id AS source_creator_id,
      s.create_time AS source_create_time, s.recalled_at AS source_recalled_at,
      m.mem_name AS agent_name, t.task_session_id, t.task_name, t.status AS task_status,
      t.turn_status AS task_turn_status, r.message_id AS result_message_id,
      r.message_content AS result_content, r.metadata AS result_metadata,
      r.create_time AS result_create_time, r.recalled_at AS result_recalled_at
    FROM byai.byai_group_chat_execution e
    JOIN byai.byai_session g ON g.session_id=e.group_session_id AND g.enterprise_id=$1
    JOIN byai.byai_message s ON s.message_id=e.source_message_id AND s.session_id=g.session_id AND s.enterprise_id=$1
    LEFT JOIN byai.byai_session_member m ON m.session_id=g.session_id AND m.mem_obj_type='AGENT' AND m.mem_obj_id=e.target_agent_id AND m.com_acct_id=$1
    LEFT JOIN byai.byai_group_chat_task t ON t.task_session_id=e.candidate_session_id AND t.group_session_id=g.session_id
    LEFT JOIN byai.byai_message r ON r.message_id=e.ack_message_id AND r.session_id=g.session_id AND r.enterprise_id=$1
    WHERE e.group_session_id=$2 AND (t.status IS NULL OR t.status<>'PRIVATE')
      AND ${responseIds ? "('execution:' || e.execution_id)=ANY($3::text[])" : "e.execution_id>$3::bigint AND e.status IN ('QUEUED','RUNNING') AND e.disposition<>'TASK'"}
    ORDER BY e.execution_id LIMIT $4`,
    [enterpriseId, groupId, responseIds || after, limit],
  );
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        value,
      ]),
    ),
  );
}
