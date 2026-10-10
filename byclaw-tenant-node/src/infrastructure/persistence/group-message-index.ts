import type { SqlSession } from "../../application/database-ports.js";
import type { MirrorEnvelope } from "../../domain/mirror.js";
import { DomainError } from "../../domain/errors.js";
import { first } from "./sql-utils.js";

/** 在外层会话锁与消息事务内维护回复链的话题归属和真人提及索引。 */
export async function indexGroupMessage(
  db: SqlSession,
  enterpriseId: string,
  messageId: string,
  reference: string | null,
  event?: MirrorEnvelope,
): Promise<void> {
  const message = await first(
    db,
    "SELECT m.*,s.session_type FROM byai.byai_message m JOIN byai.byai_session s ON s.session_id=m.session_id WHERE m.message_id=$1 AND m.enterprise_id=$2 AND s.enterprise_id=$2",
    [messageId, enterpriseId],
  );
  if (!message || message.sessionType !== "hs_as") return;
  const topic = reference
    ? await resolveTopic(db, enterpriseId, message.sessionId, reference, messageId)
    : messageId;
  if (event?.payload.topicId !== undefined && event.payload.topicId !== topic)
    throw new DomainError("MIRROR_CONTEXT_MISMATCH");
  await db.query(
    "UPDATE byai.byai_message SET topic_id=$1,message_ref=$2 WHERE message_id=$3 AND enterprise_id=$4",
    [topic, reference, messageId, enterpriseId],
  );
  if (reference)
    await db.query(
      `MERGE INTO byai.byai_group_chat_topic target
       USING (SELECT CAST($1 AS BIGINT) AS topic_id, CAST($2 AS BIGINT) AS group_session_id,
         CAST($1 AS BIGINT) AS root_message_id, CAST($3 AS BIGINT) AS last_message_id,
         CAST($4 AS TIMESTAMP(3)) AS last_activity_at, CAST($4 AS TIMESTAMP(3)) AS create_time) source
       ON (target.topic_id=source.topic_id AND target.group_session_id=source.group_session_id)
       WHEN MATCHED THEN UPDATE SET
         last_message_id=CASE WHEN source.last_activity_at>target.last_activity_at
           OR (source.last_activity_at=target.last_activity_at AND source.last_message_id>target.last_message_id)
           THEN source.last_message_id ELSE target.last_message_id END,
         last_activity_at=CASE WHEN source.last_activity_at>target.last_activity_at
           THEN source.last_activity_at ELSE target.last_activity_at END
       WHEN NOT MATCHED THEN INSERT
         (topic_id,group_session_id,root_message_id,last_message_id,last_activity_at,create_time)
       VALUES (source.topic_id,source.group_session_id,source.root_message_id,
         source.last_message_id,source.last_activity_at,source.create_time)`,
      [topic, message.sessionId, messageId, message.createTime],
    );
  if (!event || event.eventType !== "INPUT") return;
  for (const user of new Set<string>(event.payload.mentionedUserIds ?? [])) {
    if (user === event.payload.userId) continue;
    await indexGroupMention(db, messageId, message.sessionId, user, event.payload.userId);
  }
}

/** Same insert-if-absent contract as BE, serialized by the outer group transaction lock. */
export async function indexGroupMention(
  db: SqlSession,
  messageId: string,
  sessionId: string,
  userId: string,
  creatorId: string,
): Promise<void> {
  await db.query(
    `MERGE INTO byai.byai_group_chat_mention target
     USING (SELECT CAST($1 AS BIGINT) AS message_id, CAST($2 AS BIGINT) AS group_session_id,
       CAST($3 AS BIGINT) AS mentioned_user_id, CAST($4 AS BIGINT) AS creator_id,
       CURRENT_TIMESTAMP AS create_time) source
     ON (target.message_id=source.message_id AND target.mentioned_user_id=source.mentioned_user_id)
     WHEN NOT MATCHED THEN INSERT
       (message_id,group_session_id,mentioned_user_id,creator_id,create_time)
     VALUES (source.message_id,source.group_session_id,source.mentioned_user_id,source.creator_id,source.create_time)`,
    [messageId, sessionId, userId, creatorId],
  );
}
async function resolveTopic(
  db: SqlSession,
  enterpriseId: string,
  sessionId: string,
  parent: string,
  newId: string,
): Promise<string> {
  const visited = new Set([newId]),
    unassigned: string[] = [];
  let current = parent;
  while (true) {
    if (visited.has(current) || visited.size >= 1000) throw new DomainError("INVALID_REPLY_CHAIN");
    visited.add(current);
    const row = await first(
      db,
      "SELECT message_id,message_ref,topic_id,usage FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3",
      [current, sessionId, enterpriseId],
    );
    if (!row) throw new DomainError("REFERENCE_NOT_COMMITTED");
    if (![1, 2].includes(row.usage)) throw new DomainError("INVALID_REPLY_CHAIN");
    const topic = row.topicId ?? (row.messageRef ? null : current);
    if (topic) {
      if (unassigned.length)
        await db.query(
          "UPDATE byai.byai_message SET topic_id=$1 WHERE message_id=ANY($2::bigint[]) AND session_id=$3 AND enterprise_id=$4",
          [topic, unassigned, sessionId, enterpriseId],
        );
      return topic;
    }
    unassigned.push(current);
    current = row.messageRef;
  }
}
