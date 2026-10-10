import type { SqlSession } from "../../application/database-ports.js";
import {
  GROUP_COORDINATION_SCOPE,
  parseGroupCoordination,
} from "../../domain/group-coordination.js";
import { first } from "./sql-utils.js";

export async function readGroupCoordination(db: SqlSession, sessionId: string) {
  const row = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
    [sessionId, GROUP_COORDINATION_SCOPE],
  );
  return parseGroupCoordination(row?.extParamValue);
}
