import type { CommandContext } from "./command-context.js";
import type { SqlSession } from "../../application/database-ports.js";
import { DomainError } from "../../domain/errors.js";
import { first, camel } from "./sql-utils.js";

const CODE = "group_invitation";
function decode(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new DomainError("INVALID_INVITATION");
  }
}

async function validate(db: SqlSession, tenantId: string, sessionId: string, record: any) {
  if (!record || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now())
    throw new DomainError("INVALID_INVITATION");
  const group = await first(
    db,
    "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2 AND session_type='hs_as' AND COALESCE(state,'ACTIVE') NOT IN ('GROUP_DISSOLVED','CLOSED')",
    [sessionId, tenantId],
  );
  const inviter = await first(
    db,
    "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
    [sessionId, record.inviterId, tenantId],
  );
  const settings = (
    await db.query(
      "SELECT ext_param_code,ext_param_value FROM byai.byai_session_ext WHERE session_id=$1",
      [sessionId],
    )
  ).map(camel);
  const values = new Map(settings.map((row) => [row.extParamCode, row.extParamValue]));
  if (
    !group ||
    !inviter ||
    values.get("group_join_link_enabled") === "false" ||
    (!["OWNER", "ADMIN"].includes(inviter.userRole) &&
      values.get("group_member_invite_user_enabled") !== "true")
  )
    throw new DomainError("INVALID_INVITATION");
  return { group, inviter };
}

/** BE 生成随机码，Node 在群锁内持久化并校验成员权限；记录复用群扩展表。 */
export async function createInvitation(context: CommandContext) {
  const { command, db } = context;
  const token = command.payload.token;
  if (typeof token !== "string" || !/^[A-Za-z0-9]{8}$/.test(token))
    throw new DomainError("INVALID_INVITATION");
  // 跨群创建也串行化，确保同租户的邀请码唯一。
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `invitation:${command.enterpriseId}`,
  ]);
  let record = { token, inviterId: command.userId, expiresAt: Date.now() + 7 * 86400000 };
  await validate(db, command.enterpriseId, command.sessionId, record);
  const old = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
    [command.sessionId, CODE],
  );
  if (old) {
    const existing = decode(old.extParamValue);
    if (existing.expiresAt > Date.now()) {
      await validate(db, command.enterpriseId, command.sessionId, existing);
      record = { ...existing, expiresAt: record.expiresAt };
    }
  }
  const collision = await first(
    db,
    "SELECT e.session_id FROM byai.byai_session_ext e JOIN byai.byai_session s ON s.session_id=e.session_id WHERE s.enterprise_id=$1 AND e.ext_param_code=$2 AND CASE WHEN e.ext_param_code=$2 THEN e.ext_param_value::jsonb->>'token' END=$3 AND e.session_id<>$4",
    [command.enterpriseId, CODE, record.token, command.sessionId],
  );
  if (collision) throw new DomainError("INVITATION_TOKEN_CONFLICT");
  await context.setExtension(CODE, JSON.stringify(record));
  return { data: { token: record.token, expiresAt: record.expiresAt } };
}

export async function invitationPreview(
  db: SqlSession,
  tenantId: string,
  actor: string,
  token: unknown,
) {
  if (typeof token !== "string" || !/^[A-Za-z0-9]{8}$/.test(token))
    throw new DomainError("INVALID_INVITATION");
  const row = await first(
    db,
    "SELECT e.session_id,e.ext_param_value FROM byai.byai_session_ext e JOIN byai.byai_session s ON s.session_id=e.session_id WHERE s.enterprise_id=$1 AND e.ext_param_code=$2 AND CASE WHEN e.ext_param_code=$2 THEN e.ext_param_value::jsonb->>'token' END=$3",
    [tenantId, CODE, token],
  );
  if (!row) throw new DomainError("INVALID_INVITATION");
  const record = decode(row.extParamValue);
  const { group, inviter } = await validate(db, tenantId, row.sessionId, record);
  const members = (
    await db.query(
      "SELECT mem_obj_type,mem_obj_id,mem_name FROM byai.byai_session_member WHERE session_id=$1 AND com_acct_id=$2 ORDER BY byai_session_member_id",
      [row.sessionId, tenantId],
    )
  ).map(camel);
  return {
    groupNumber: group.sessionId,
    groupName: group.sessionName,
    inviterName: inviter.memName,
    inviterId: String(record.inviterId),
    memberCount: members.length,
    memberPreviews: members
      .slice(0, 9)
      .map((m) => ({ type: m.memObjType, displayName: m.memName })),
    expiresAt: record.expiresAt,
    allowJoinByLink: true,
    alreadyMember: members.some((m) => m.memObjType === "USER" && String(m.memObjId) === actor),
  };
}
