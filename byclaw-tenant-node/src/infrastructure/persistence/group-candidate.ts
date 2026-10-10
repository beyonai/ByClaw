import type { SqlSession } from "../../application/database-ports.js";
import { first } from "./sql-utils.js";

/** The existing execution table owns single-mention classification and its stable dispatch identity. */
export function readGroupCandidate(db: SqlSession, sessionId: string, lock = false) {
  return first(
    db,
    `SELECT * FROM byai.byai_group_chat_execution WHERE candidate_session_id=$1${lock ? " FOR UPDATE" : ""}`,
    [sessionId],
  );
}
