import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";

/** 邀请用户须有 BE 的 ACTIVE 成员断言；邀请 AGENT 须有资源授权，普通成员还受群设置限制。 */
export async function addMembers(context: CommandContext): Promise<void> {
  const { command, db } = context,
    members = command.payload.members;
  if (
    !Array.isArray(members) ||
    !members.length ||
    members.length > 100 ||
    members.some((member) => !member || typeof member !== "object" || Array.isArray(member))
  )
    throw new DomainError("INVALID_GROUP_MEMBERS");
  await authorizeInvitation(context, members);
  for (const member of members) {
    requireId(member.memObjId);
    if (
      !["USER", "AGENT"].includes(member.memObjType) ||
      (member.memObjType === "USER" && !command.tenantMemberUserIds.includes(member.memObjId)) ||
      (member.memObjType === "AGENT" && member.resourceAuthorized !== true)
    )
      throw new DomainError("INVALID_GROUP_MEMBERS");
    if (
      await first(
        db,
        "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type=$2 AND mem_obj_id=$3",
        [command.sessionId, member.memObjType, member.memObjId],
      )
    )
      continue;
    await insert(db, "byai_session_member", {
      byai_session_member_id: await nextId(db),
      session_id: command.sessionId,
      mem_obj_type: member.memObjType,
      mem_obj_id: member.memObjId,
      user_role: "MEMBER",
      mem_name: text(member.memName ?? "", 255),
      creator_id: command.userId,
      com_acct_id: command.enterpriseId,
      create_time: new Date(),
    });
  }
}
/** 区分主动离群与管理移除；OWNER 先转让，ADMIN 不能移除另一个 ADMIN。 */
export async function removeMember(context: CommandContext): Promise<void> {
  const { command, db } = context,
    self = command.operation === "LEAVE_GROUP";
  const type = self ? "USER" : (command.payload.memObjType ?? "USER");
  const id = self ? command.userId : requireId(command.payload.memObjId);
  if (!["USER", "AGENT"].includes(type)) throw new DomainError("INVALID_GROUP_MEMBERS");
  const target = await first(
    db,
    "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type=$2 AND mem_obj_id=$3 AND com_acct_id=$4",
    [command.sessionId, type, id, command.enterpriseId],
  );
  if (!self) await context.requireRole(["OWNER", "ADMIN"]);
  if (!target) return;
  if (target.userRole === "OWNER") throw new DomainError("OWNER_TRANSFER_REQUIRED");
  if (!self)
    await context.requireRole(target.userRole === "ADMIN" ? ["OWNER"] : ["OWNER", "ADMIN"]);
  await db.query(
    "DELETE FROM byai.byai_session_member WHERE byai_session_member_id=$1 AND com_acct_id=$2",
    [target.byaiSessionMemberId, command.enterpriseId],
  );
}
/** 仅 OWNER 可调整角色或转让；降级原 OWNER 与升级新 OWNER 在同一命令事务完成。 */
export async function changeRole(context: CommandContext): Promise<void> {
  const { command, db } = context,
    targetId = requireId(command.payload.userId);
  await context.requireRole(["OWNER"]);
  if (!command.tenantMemberUserIds.includes(targetId) || !(await context.member(targetId)))
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (command.operation === "TRANSFER_OWNER") {
    if (targetId === command.userId) return;
    await db.query(
      "UPDATE byai.byai_session_member SET user_role='ADMIN' WHERE session_id=$1 AND user_role='OWNER' AND com_acct_id=$2",
      [command.sessionId, command.enterpriseId],
    );
  } else if (
    !["ADMIN", "MEMBER"].includes(command.payload.role) ||
    (await context.member(targetId))?.userRole === "OWNER"
  )
    throw new DomainError("INVALID_MEMBER_ROLE");
  await db.query(
    "UPDATE byai.byai_session_member SET user_role=$1 WHERE session_id=$2 AND mem_obj_type='USER' AND mem_obj_id=$3 AND com_acct_id=$4",
    [
      command.operation === "TRANSFER_OWNER" ? "OWNER" : command.payload.role,
      command.sessionId,
      targetId,
      command.enterpriseId,
    ],
  );
}
/** 统一处理群设置、解散及成员确认；不同操作各自核验角色和生命周期。 */
export async function groupSettings(context: CommandContext): Promise<void> {
  const { command, db } = context;
  if (command.operation === "ACK_DISSOLUTION") {
    const session = await context.session();
    if (
      session?.sessionType !== "hs_as" ||
      session.state !== "GROUP_DISSOLVED" ||
      !(await context.member())
    )
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await context.setExtension(`group_dissolution_ack_${command.userId}`, "true");
    return;
  }
  await context.requireRole(
    command.operation === "DISSOLVE_GROUP" ? ["OWNER"] : ["OWNER", "ADMIN"],
  );
  if (command.operation === "DISSOLVE_GROUP") {
    await db.query(
      "UPDATE byai.byai_session SET state='GROUP_DISSOLVED',update_time=CURRENT_TIMESTAMP WHERE session_id=$1 AND enterprise_id=$2",
      [command.sessionId, command.enterpriseId],
    );
    return;
  }
  const codes: Record<string, string> = {
    allowJoinByLink: "group_join_link_enabled",
    allowMemberAddAgent: "group_member_add_agent_enabled",
    allowMemberInviteUser: "group_member_invite_user_enabled",
  };
  for (const [key, value] of Object.entries(command.payload)) {
    if (!codes[key] || typeof value !== "boolean") throw new DomainError("INVALID_GROUP_SETTINGS");
    await context.setExtension(codes[key], String(value));
  }
}

async function authorizeInvitation(
  context: CommandContext,
  members: Record<string, any>[],
): Promise<void> {
  const actor = await context.member();
  if (["OWNER", "ADMIN"].includes(actor?.userRole)) return;
  if (!actor) throw new DomainError("FORBIDDEN");
  const settings = await context.db.query(
    "SELECT ext_param_code,ext_param_value FROM byai.byai_session_ext WHERE session_id=$1",
    [context.command.sessionId],
  );
  const values = new Map(settings.map((row) => [row.ext_param_code, row.ext_param_value]));
  for (const member of members) {
    const code =
      member.memObjType === "AGENT"
        ? "group_member_add_agent_enabled"
        : "group_member_invite_user_enabled";
    if (values.get(code) !== "true") throw new DomainError("FORBIDDEN");
  }
}
