import type { SqlSession } from "../../application/database-ports.js";
import { camel } from "./sql-utils.js";

/** 按页读取确认记录，ID 始终使用字符串，时间与 BE 的毫秒时间戳一致。 */
export async function messageAcknowledgements(
  db: SqlSession,
  tenantId: string,
  sessionId: string,
  messageIds: string[],
) {
  if (!messageIds.length) return [];
  const rows = await db.query(
    "SELECT a.* FROM byai.byai_group_chat_message_ack a JOIN byai.byai_session s ON s.session_id=a.session_id WHERE s.enterprise_id=$1 AND a.session_id=$2 AND a.message_id=ANY($3::bigint[]) ORDER BY a.acknowledged_at,a.user_id",
    [tenantId, sessionId, messageIds],
  );
  return rows.map((raw) => {
    const row = camel(raw);
    return {
      messageId: String(row.messageId),
      userId: String(row.userId),
      userName: row.userName,
      acknowledgedAt: new Date(row.acknowledgedAt).getTime(),
    };
  });
}
