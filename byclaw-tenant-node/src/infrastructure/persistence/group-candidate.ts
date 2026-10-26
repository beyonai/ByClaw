import { lockBusiness } from "./session-locks.js";
import type { SqlSession } from "../../application/database-ports.js";
import { first } from "./sql-utils.js";

/** The existing execution table owns single-mention classification and its stable dispatch identity. */
export async function readGroupCandidate(db: SqlSession, sessionId: string, lock = false) {
  if (lock) await lockBusiness(db, `candidate:${sessionId}`);
  return first(db, `SELECT * FROM byai.byai_group_chat_execution WHERE candidate_session_id=$1`, [
    sessionId,
  ]);
}
