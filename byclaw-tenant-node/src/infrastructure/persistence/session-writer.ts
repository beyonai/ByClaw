import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";

/** 创建个人或群会话；群成员与默认设置在外层命令事务内一并写入，项目编排由 BE 负责。 */
export async function createSession(context: CommandContext): Promise<void> {
  const { command, db } = context,
    p = command.payload;
  if (await context.session()) throw new DomainError("SESSION_EXISTS");
  const group = command.operation === "CREATE_GROUP";
  const name = text(p.sessionName, 255, true);
  if (!name.trim()) throw new DomainError("INVALID_SESSION_NAME");
  if (!group && p.sessionType !== undefined && p.sessionType !== "h_as")
    throw new DomainError("INVALID_SESSION_TYPE");
  await insert(db, "byai_session", {
    session_id: command.sessionId,
    creator_id: command.userId,
    enterprise_id: command.enterpriseId,
    session_name: name,
    session_type: group ? "hs_as" : "h_as",
    project_id: group ? requireId(p.projectId) : "-1",
    state: "ACTIVE",
    last_seq: "0",
    create_time: new Date(),
    update_time: new Date(),
  });
  if (group) {
    await createMembers(context);
    for (const [code, value] of [
      ["group_join_link_enabled", "true"],
      ["group_member_add_agent_enabled", "false"],
      ["group_member_invite_user_enabled", "false"],
    ])
      await context.setExtension(code!, value!);
  }
}
async function createMembers(context: CommandContext): Promise<void> {
  const { command, db } = context,
    members = command.payload.members;
  if (
    !Array.isArray(members) ||
    !members.length ||
    members.length > 1000 ||
    members.some((member) => !member || typeof member !== "object" || Array.isArray(member)) ||
    members.filter((member) => member.userRole === "OWNER").length !== 1 ||
    !members.some(
      (member) =>
        member.memObjType === "USER" &&
        member.memObjId === command.userId &&
        member.userRole === "OWNER",
    )
  )
    throw new DomainError("INVALID_GROUP_MEMBERS");
  const seen = new Set<string>();
  for (const member of members) {
    requireId(member.memObjId);
    const key = `${member.memObjType}:${member.memObjId}`;
    if (
      seen.has(key) ||
      !["USER", "AGENT"].includes(member.memObjType) ||
      !["OWNER", "ADMIN", "MEMBER"].includes(member.userRole) ||
      (member.memObjType === "USER" && !command.tenantMemberUserIds.includes(member.memObjId)) ||
      (member.memObjType === "AGENT" &&
        (member.userRole !== "MEMBER" || member.resourceAuthorized !== true))
    )
      throw new DomainError("INVALID_GROUP_MEMBERS");
    seen.add(key);
    await insert(db, "byai_session_member", {
      byai_session_member_id: await nextId(db, command.enterpriseId),
      session_id: command.sessionId,
      mem_obj_type: member.memObjType,
      mem_obj_id: member.memObjId,
      user_role: member.userRole,
      mem_name: text(member.memName ?? "", 255),
      creator_id: command.userId,
      com_acct_id: command.enterpriseId,
      create_time: new Date(),
    });
  }
}
/** 个人删除写 CLOSED；群使用独立解散命令，群名称/内容修改要求 OWNER 或 ADMIN。 */
export async function changeSession(context: CommandContext): Promise<void> {
  const { command, db } = context,
    session = await context.session();
  if (session?.sessionType === "hs_as") {
    if (command.operation === "DELETE_SESSION") throw new DomainError("USE_GROUP_DISSOLUTION");
    await context.requireRole(["OWNER", "ADMIN"]);
  }
  if (command.operation === "DELETE_SESSION") {
    await db.query(
      "UPDATE byai.byai_session SET state='CLOSED',update_time=CURRENT_TIMESTAMP WHERE session_id=$1 AND enterprise_id=$2",
      [command.sessionId, command.enterpriseId],
    );
    return;
  }
  const p = command.payload;
  if (
    !Object.keys(p).length ||
    Object.keys(p).some((key) => !["sessionName", "sessionContent"].includes(key))
  )
    throw new DomainError("INVALID_SESSION_UPDATE");
  await db.query(
    "UPDATE byai.byai_session SET session_name=$1,session_content=$2,update_time=CURRENT_TIMESTAMP WHERE session_id=$3 AND enterprise_id=$4",
    [
      p.sessionName === undefined ? session!.sessionName : text(p.sessionName, 255, true),
      p.sessionContent === undefined ? session!.sessionContent : text(p.sessionContent, 4000, true),
      command.sessionId,
      command.enterpriseId,
    ],
  );
}
/** 确认消息属于本群后单调推进已读游标，旧请求不会把游标回退。 */
export async function readState(context: CommandContext): Promise<void> {
  const { command, db } = context,
    messageId = requireId(command.payload.messageId);
  if (
    !(await context.member()) ||
    !(await first(
      db,
      "SELECT 1 FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3",
      [command.sessionId, messageId, command.enterpriseId],
    ))
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  await db.query(
    "UPDATE byai.byai_session_member SET last_read_message_id=GREATEST(COALESCE(last_read_message_id,0),$1) WHERE session_id=$2 AND mem_obj_type='USER' AND mem_obj_id=$3 AND com_acct_id=$4",
    [messageId, command.sessionId, command.userId, command.enterpriseId],
  );
}
/** 消息作者或群管理员可撤回；保留原行并记录撤回身份，读取侧负责内容脱敏。 */
export async function recallMessage(context: CommandContext): Promise<void> {
  const { command, db } = context,
    messageId = requireId(command.payload.messageId);
  const message = await first(
    db,
    "SELECT creator_id FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3",
    [command.sessionId, messageId, command.enterpriseId],
  );
  if (!message) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  if (message.creatorId !== command.userId) await context.requireRole(["OWNER", "ADMIN"]);
  await db.query(
    "UPDATE byai.byai_message SET recalled_at=COALESCE(recalled_at,CURRENT_TIMESTAMP),recalled_by=COALESCE(recalled_by,$1) WHERE message_id=$2 AND session_id=$3 AND enterprise_id=$4",
    [command.userId, messageId, command.sessionId, command.enterpriseId],
  );
}
