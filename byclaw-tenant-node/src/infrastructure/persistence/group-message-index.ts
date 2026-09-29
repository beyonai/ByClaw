import type { SqlSession } from "../../application/database-ports.js";
import type { MirrorEnvelope } from "../../domain/mirror.js";
import { DomainError } from "../../domain/errors.js";
import { first } from "./sql-utils.js";

/** Group lock is held by the enclosing message transaction. */
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
      `INSERT INTO byai.byai_group_chat_topic(topic_id,group_session_id,root_message_id,last_message_id,last_activity_at,create_time)
    VALUES($1,$2,$1,$3,$4,$4) ON CONFLICT(topic_id) DO UPDATE SET last_message_id=EXCLUDED.last_message_id,last_activity_at=EXCLUDED.last_activity_at
    WHERE byai.byai_group_chat_topic.group_session_id=EXCLUDED.group_session_id AND (byai.byai_group_chat_topic.last_activity_at,byai.byai_group_chat_topic.last_message_id)<(EXCLUDED.last_activity_at,EXCLUDED.last_message_id)`,
      [topic, message.sessionId, messageId, message.createTime],
    );
  if (!event || event.eventType !== "INPUT") return;
  for (const user of new Set<string>(event.payload.mentionedUserIds ?? [])) {
    if (user === event.payload.userId) continue;
    await db.query(
      "INSERT INTO byai.byai_group_chat_mention(message_id,group_session_id,mentioned_user_id,creator_id,create_time) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(message_id,mentioned_user_id) DO NOTHING",
      [messageId, message.sessionId, user, event.payload.userId],
    );
  }
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
