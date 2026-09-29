import { groupList } from "./group-list.js";
import type { SqlSession } from "../../application/database-ports.js";
import type { HistoryRepository, MessageFilter, Row } from "../../application/history.js";

const camel = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_m, c) => c.toUpperCase()),
      value,
    ]),
  );
const visible =
  "m.archived_at IS NULL AND m.usage IN (1,2) AND (m.message_content IS NOT NULL OR NULLIF(TRIM(m.related_resources),'') IS NOT NULL)";
/** 既有历史 SQL 的租户适配器；应用层先鉴权，消息查询同时限定所属会话的企业。 */
export class SqlHistoryRepository implements HistoryRepository {
  constructor(
    private readonly db: SqlSession,
    private readonly tenantId: string,
  ) {}
  private async read(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return (await this.db.query(sql, parameters)).map(camel);
  }
  async session(id: string) {
    return (
      (
        await this.read(
          "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
          [id, this.tenantId],
        )
      )[0] ?? null
    );
  }
  async member(sessionId: string, userId: string) {
    return (
      (
        await this.read(
          "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
          [sessionId, userId, this.tenantId],
        )
      )[0] ?? null
    );
  }
  members(sessionId: string) {
    return this.read(
      "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND com_acct_id=$2 ORDER BY CASE WHEN mem_obj_type='AGENT' THEN 3 ELSE CASE user_role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END END, byai_session_member_id",
      [sessionId, this.tenantId],
    );
  }
  extensions(sessionId: string) {
    return this.read("SELECT * FROM byai.byai_session_ext WHERE session_id=$1", [sessionId]);
  }
  private filter(filter: MessageFilter) {
    const parameters: unknown[] = [this.tenantId],
      conditions = ["s.enterprise_id=$1"];
    const add = (expression: string, value: unknown) => {
      parameters.push(value);
      conditions.push(expression.replace(/\?/g, `$${parameters.length}`));
    };
    if (filter.sessionId) add("m.session_id=?", filter.sessionId);
    if (filter.ids) add("m.message_id=ANY(?::bigint[])", filter.ids);
    if (filter.before) add("m.message_id<?::bigint", filter.before);
    if (filter.after) {
      if (filter.topicId)
        add(
          "(m.create_time,m.message_id)>((SELECT create_time FROM byai.byai_message WHERE session_id=m.session_id AND message_id=?),?::bigint)",
          filter.after,
        );
      else add("m.message_id>?::bigint", filter.after);
    }
    if (filter.topicId) add("m.topic_id=?", filter.topicId);
    if (filter.rootId) add("m.message_id<>?", filter.rootId);
    if (filter.visible || filter.timeline)
      conditions.push(filter.timeline ? visible.replace("IN (1,2)", "IN (1,2,5)") : visible);
    if (filter.search) conditions.push("m.recalled_at IS NULL AND m.message_content IS NOT NULL");
    if (filter.keyword)
      add(
        "m.recalled_at IS NULL AND m.message_content LIKE ? ESCAPE '\\'",
        `%${filter.keyword.replace(/[\\%_]/g, "\\$&")}%`,
      );
    if (filter.scope === "MINE") add("m.usage=1 AND m.creator_id=?", filter.actor);
    if (filter.scope === "MENTIONED_ME")
      add(
        "EXISTS (SELECT 1 FROM byai.byai_group_chat_mention x WHERE x.group_session_id=m.session_id AND x.message_id=m.message_id AND x.mentioned_user_id=?)",
        filter.actor,
      );
    if (filter.senderType === "USER") conditions.push("m.usage=1");
    if (filter.senderType === "AGENT") conditions.push("m.usage=2");
    if (filter.startTime !== undefined) add("m.create_time>=?", new Date(filter.startTime));
    if (filter.endTime !== undefined) add("m.create_time<=?", new Date(filter.endTime));
    return {
      parameters,
      from: `FROM byai.byai_message m JOIN byai.byai_session s ON s.session_id=m.session_id WHERE ${conditions.join(" AND ")}`,
    };
  }
  messages(filter: MessageFilter) {
    if (filter.outline)
      return this.read(
        `SELECT * FROM (
      SELECT m.*,ROW_NUMBER() OVER (ORDER BY m.create_time DESC,m.message_id DESC) AS position,
        COUNT(*) OVER () AS total_count FROM byai.byai_message m
        JOIN byai.byai_session s ON s.session_id=m.session_id
        WHERE s.enterprise_id=$1 AND m.session_id=$2
      ) outline WHERE archived_at IS NULL AND usage IN(1,2,4)
      ORDER BY create_time ASC,message_id ASC`,
        [this.tenantId, filter.sessionId],
      );
    const { parameters, from } = this.filter(filter),
      direction = filter.ascending ? "ASC" : "DESC";
    let sql = `SELECT m.* ${from} ORDER BY ${filter.orderById ? "" : `m.create_time ${direction},`}m.message_id ${direction}`;
    if (filter.limit !== undefined) {
      parameters.push(filter.limit);
      sql += ` LIMIT $${parameters.length}`;
    }
    if (filter.offset !== undefined) {
      parameters.push(filter.offset);
      sql += ` OFFSET $${parameters.length}`;
    }
    return this.read(sql, parameters);
  }
  async countMessages(filter: MessageFilter) {
    const { parameters, from } = this.filter(filter);
    return Number((await this.read(`SELECT COUNT(*) AS total ${from}`, parameters))[0]!.total);
  }
  groups(actor: string, page: number, size: number) {
    return groupList((sql, args) => this.read(sql, args), this.tenantId, actor, page, size);
  }
  tasks(sessionId: string) {
    return this.read(
      "SELECT * FROM byai.byai_group_chat_task WHERE group_session_id=$1 ORDER BY create_time DESC,task_session_id DESC",
      [sessionId],
    );
  }
  async task(taskId: string) {
    return (
      (
        await this.read("SELECT * FROM byai.byai_group_chat_task WHERE task_session_id=$1", [
          taskId,
        ])
      )[0] ?? null
    );
  }
  async pending(taskId: string) {
    return (
      (
        await this.read(
          "SELECT * FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1",
          [taskId],
        )
      )[0] ?? null
    );
  }
  topics(sessionId: string, limit: number, boundary?: string[]) {
    const parameters: unknown[] = [sessionId, limit];
    let filter = "";
    if (boundary) {
      parameters.push(new Date(Number(boundary[2])), boundary[3], boundary[4]);
      filter = " AND (last_activity_at,last_message_id,topic_id)<($3,$4::bigint,$5::bigint)";
    }
    return this.read(
      `SELECT * FROM byai.byai_group_chat_topic WHERE group_session_id=$1${filter} ORDER BY last_activity_at DESC,last_message_id DESC,topic_id DESC LIMIT $2`,
      parameters,
    );
  }
  async topic(sessionId: string, topicId: string) {
    return (
      (
        await this.read(
          "SELECT * FROM byai.byai_group_chat_topic WHERE group_session_id=$1 AND topic_id=$2",
          [sessionId, topicId],
        )
      )[0] ?? null
    );
  }
  participants(sessionId: string, topicIds: string[]) {
    if (!topicIds.length) return Promise.resolve([]);
    return this.read(
      `SELECT topic_id,CASE usage WHEN 1 THEN 'USER' ELSE 'AGENT' END AS member_type,creator_id AS member_id,
      MAX(creator_name) AS display_name FROM byai.byai_message WHERE session_id=$1 AND topic_id=ANY($2::bigint[])
      AND usage IN(1,2) AND creator_id IS NOT NULL GROUP BY topic_id,usage,creator_id ORDER BY topic_id,MIN(message_id)`,
      [sessionId, topicIds],
    );
  }
}
