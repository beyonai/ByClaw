import type { SqlSession } from "../../application/database-ports.js";
import { first } from "./sql-utils.js";
export async function nextSequence(
  db: SqlSession,
  enterpriseId: string,
  sessionId: string,
): Promise<string> {
  const row = await first(
    db,
    "UPDATE byai.byai_session SET last_seq=last_seq+1,update_time=CURRENT_TIMESTAMP WHERE session_id=$1 AND enterprise_id=$2 RETURNING last_seq",
    [sessionId, enterpriseId],
  );
  return row!.lastSeq;
}
export function answerFields(
  payload: Record<string, any>,
  inserting: boolean,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, column] of [
    ["creatorId", "creator_id"],
    ["creatorName", "creator_name"],
    ["topicId", "topic_id"],
    ["messageRef", "message_ref"],
  ]) {
    if (payload[key!] !== undefined || inserting) values[column!] = payload[key!] ?? null;
  }
  for (const [key, column] of [
    ["messageStruct", "message_struct"],
    ["relatedResources", "related_resources"],
  ]) {
    if (payload[key!] !== undefined || inserting)
      values[column!] = payload[key!] === undefined ? null : JSON.stringify(payload[key!]);
  }
  return values;
}
