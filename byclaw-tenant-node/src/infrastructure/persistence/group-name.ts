import type { SqlSession } from "../../application/database-ports.js";
import { first } from "./sql-utils.js";

// Java trims U+0000..U+0020; PostgreSQL text cannot contain U+0000.
const nameTrimCharacters = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i + 1)).join(
  "",
);

/** Only dissolved groups release their names; NULL state is a legacy active group. */
export async function groupNameExists(
  db: SqlSession,
  tenantId: string,
  creatorId: string,
  name: string,
): Promise<boolean> {
  return !!(await first(
    db,
    "SELECT session_id FROM byai.byai_session WHERE enterprise_id=$1 AND creator_id=$2 AND session_type='hs_as' AND BTRIM(session_name,$4)=$3 AND COALESCE(state,'ACTIVE')<>'GROUP_DISSOLVED' LIMIT 1",
    [tenantId, creatorId, name, nameTrimCharacters],
  ));
}
