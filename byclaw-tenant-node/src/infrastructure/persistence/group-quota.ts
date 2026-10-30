import type { QuotaMember } from "../../application/shared-quota.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { CommandContext } from "./command-context.js";
import { lockBusiness, lockSessions } from "./session-locks.js";

/** Renewable transaction Redis locks serialize quota counts and writes in the tenant database. */
export async function requireGroupMemberCapacity(
  context: CommandContext,
  members: QuotaMember[],
): Promise<void> {
  if (!context.quotas) return;
  const { db, command } = context;
  if (command.operation === "CREATE_GROUP") {
    // The session is already inserted in this transaction; serialize enterprise counts until commit.
    await lockBusiness(db, `enterprise-workgroup:${command.enterpriseId}`);
    let groupQuota = await context.quotas.read(command.enterpriseId);
    if (groupQuota && groupQuota.mode !== "UNLIMITED") {
      const count = await db.query(
        "SELECT COUNT(*)::text AS current_count FROM byai.byai_session WHERE enterprise_id=$1 AND session_type='hs_as' AND (state IS NULL OR state NOT IN('CLOSED','GROUP_DISSOLVED'))",
        [command.enterpriseId],
      );
      // Direct SQL queries preserve column aliases; only the first() helper converts them to camelCase.
      const current = String(count[0]?.current_count ?? "");
      if (!/^\d+$/.test(current)) throw new DomainError("QUOTA_UNAVAILABLE");
      if (BigInt(current) > BigInt(groupQuota.limits.groupLimit))
        throw new DomainError("GROUP_LIMIT_EXCEEDED");
    }
  }
  await lockSessions(db, [command.sessionId]);
  let quota = await context.quotas.read(command.enterpriseId);
  if (!quota || quota.mode === "UNLIMITED") return;
  // Validate ownership after the Redis lock; no dummy database write is needed.
  const guarded = await db.query(
    "SELECT session_id FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2 AND session_type='hs_as'",
    [command.sessionId, command.enterpriseId],
  );
  if (guarded.length !== 1) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  // Honor policy changes published while waiting for the Redis lock.
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
