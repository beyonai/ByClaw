import type { QuotaMember } from "../../application/shared-quota.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { CommandContext } from "./command-context.js";
import { lockSessions } from "./session-locks.js";

/** A database row write serializes count and insert even if a paused worker loses its Redis lease. */
export async function requireGroupMemberCapacity(
  context: CommandContext,
  members: QuotaMember[],
): Promise<void> {
  if (!context.quotas) return;
  const { db, command } = context;
  await lockSessions(db, [command.sessionId]);
  let quota = await context.quotas.read(command.enterpriseId);
  if (!quota || quota.mode === "UNLIMITED") return;
  // The write lock lives until commit/rollback; CREATE_GROUP has inserted this row in the same transaction.
  const guarded = await db.query(
    "UPDATE byai.byai_session SET session_id=session_id WHERE session_id=$1 AND enterprise_id=$2 AND session_type='hs_as' RETURNING session_id",
    [command.sessionId, command.enterpriseId],
  );
  if (guarded.length !== 1) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  // The row write may wait behind another transaction; honor policy changes published during that wait.
  quota = await context.quotas.read(command.enterpriseId);
  if (!quota || quota.mode === "UNLIMITED") return;
  const users = new Set<string>(),
    agents = new Set<string>();
  for (const member of members) {
    if (!["USER", "AGENT"].includes(member.memObjType))
      throw new DomainError("INVALID_GROUP_MEMBERS");
    (member.memObjType === "USER" ? users : agents).add(requireId(member.memObjId));
  }
  const counts = await db.query(
    "SELECT mem_obj_type,COUNT(*)::text AS current_count FROM byai.byai_session_member WHERE session_id=$1 AND com_acct_id=$2 AND mem_obj_type IN('USER','AGENT') GROUP BY mem_obj_type",
    [command.sessionId, command.enterpriseId],
  );
  const existing = await db.query(
    "SELECT mem_obj_type,mem_obj_id::text AS mem_obj_id FROM byai.byai_session_member WHERE session_id=$1 AND com_acct_id=$2 AND ((mem_obj_type='USER' AND mem_obj_id=ANY($3::bigint[])) OR (mem_obj_type='AGENT' AND mem_obj_id=ANY($4::bigint[])))",
    [command.sessionId, command.enterpriseId, [...users], [...agents]],
  );
  for (const member of existing)
    (member.mem_obj_type === "USER" ? users : agents).delete(String(member.mem_obj_id));
  const current = (type: string): bigint => {
    const count = String(counts.find((row) => row.mem_obj_type === type)?.current_count ?? "0");
    if (!/^\d+$/.test(count)) throw new DomainError("QUOTA_UNAVAILABLE");
    return BigInt(count);
  };
  // A reduced limit restricts only new identities; retries and existing memberships remain valid.
  if (users.size && current("USER") + BigInt(users.size) > BigInt(quota.limits.groupMemberLimit))
    throw new DomainError("GROUP_MEMBER_LIMIT_EXCEEDED");
  if (agents.size && current("AGENT") + BigInt(agents.size) > BigInt(quota.limits.agentLimit))
    throw new DomainError("GROUP_AGENT_LIMIT_EXCEEDED");
}
