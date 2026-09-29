import type { Row } from "../../application/history.js";
type ReadRows = (sql: string, args?: unknown[]) => Promise<Row[]>;

export async function groupList(
  read: ReadRows,
  tenantId: string,
  actor: string,
  page: number,
  size: number,
) {
  const predicate = `FROM byai.byai_session s JOIN byai.byai_session_member u ON u.session_id=s.session_id
      WHERE s.enterprise_id=$1 AND s.session_type='hs_as' AND u.mem_obj_type='USER' AND u.mem_obj_id=$2 AND u.com_acct_id=$1
      AND (s.state IS DISTINCT FROM 'GROUP_DISSOLVED' OR (u.user_role!='OWNER' AND NOT EXISTS (SELECT 1 FROM byai.byai_session_ext x WHERE x.session_id=s.session_id AND x.ext_param_code='group_dissolution_ack_'||$2::text AND x.ext_param_value='true')))`;
  const latest = (column: string) =>
    `(SELECT m.${column} FROM byai.byai_message m WHERE m.session_id=s.session_id AND m.archived_at IS NULL ORDER BY m.create_time DESC,m.message_id DESC LIMIT 1)`;
  const unread = `(SELECT COUNT(*) FROM byai.byai_message m WHERE m.session_id=s.session_id AND m.archived_at IS NULL AND m.creator_id!=$2 AND m.message_id>COALESCE(u.last_read_message_id,0))`;
  const mention = `FROM byai.byai_group_chat_mention x JOIN byai.byai_message m ON m.message_id=x.message_id AND m.session_id=x.group_session_id WHERE x.group_session_id=s.session_id AND x.mentioned_user_id=$2 AND m.archived_at IS NULL AND m.message_id>COALESCE(u.last_read_message_id,0)`;
  const [list, count] = await Promise.all([
    read(
      `SELECT s.session_id,s.session_name AS name,s.project_id,u.user_role AS role,u.last_read_message_id,
        ${latest("message_id")} AS latest_message_id,${latest("message_content")} AS latest_message_content,
        ${latest("create_time")} AS latest_message_time,${latest("creator_id")} AS latest_message_creator_id,
        ${latest("creator_name")} AS latest_message_creator_name,${latest("metadata")} AS latest_message_metadata,${latest("recalled_at")} AS latest_message_recalled_at,
        ${unread} AS unread_count,${unread} AS unread_message_count,(SELECT COUNT(*) ${mention}) AS unread_mention_count,
        (SELECT MAX(x.message_id) ${mention}) AS latest_mention_message_id ${predicate}
        ORDER BY COALESCE(${latest("create_time")},s.update_time,s.create_time) DESC,s.session_id DESC LIMIT $3 OFFSET $4`,
      [tenantId, actor, size, (page - 1) * size],
    ),
    read(`SELECT COUNT(*) AS total ${predicate}`, [tenantId, actor]),
  ]);
  return {
    list: list.map((r) => ({
      ...r,
      unreadCount: Number(r.unreadCount),
      unreadMessageCount: Number(r.unreadMessageCount),
      unreadMentionCount: Number(r.unreadMentionCount),
    })),
    total: Number(count[0]!.total),
  };
}
