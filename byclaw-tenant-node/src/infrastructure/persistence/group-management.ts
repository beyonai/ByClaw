import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";

export async function nickname(context: CommandContext) {
  const { db, command } = context;
  const name = text(command.payload.nickname, 100, true).trim();
  if (!name || (await context.session())?.sessionType !== "hs_as" || !(await context.member()))
    throw new DomainError("INVALID_NICKNAME");
  await db.query(
    "UPDATE byai.byai_session_member SET mem_name=$1 WHERE session_id=$2 AND mem_obj_type='USER' AND mem_obj_id=$3 AND com_acct_id=$4",
    [name, command.sessionId, command.userId, command.enterpriseId],
  );
  return { data: await context.member() };
}

/** 固定群历史边界和目标 Agent，不能用通用个人会话创建绕过群成员校验。 */
export async function directSession(context: CommandContext) {
  const { db, command } = context;
  const group = await context.session();
  const agentId = requireId(command.payload.agentId);
  if (
    group?.sessionType !== "hs_as" ||
    !(await first(
      db,
      "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='AGENT' AND mem_obj_id=$2 AND com_acct_id=$3",
      [command.sessionId, agentId, command.enterpriseId],
    ))
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const id = await nextId(db, command.enterpriseId);
  await insert(db, "byai_session", {
    session_id: id,
    parent_session_id: command.sessionId,
    project_id: group.projectId,
    enterprise_id: command.enterpriseId,
    creator_id: command.userId,
    object_id: agentId,
    session_type: "h_as",
    session_name: "Group chat direct",
    state: "ACTIVE",
    last_seq: "0",
    create_time: new Date(),
    update_time: new Date(),
  });
  const latest = await first(
    db,
    "SELECT MAX(message_id)::text AS id FROM byai.byai_message WHERE session_id=$1 AND enterprise_id=$2",
    [command.sessionId, command.enterpriseId],
  );
  for (const [code, value] of [
    ["group_source_session_id", command.sessionId],
    ["group_source_boundary_message_id", latest?.id ?? "0"],
  ])
    await insert(db, "byai_session_ext", {
      ext_id: await nextId(db, command.enterpriseId),
      session_id: id,
      ext_param_name: code,
      ext_param_code: code,
      ext_param_value: value,
    });
  return {
    data: await first(
      db,
      "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [id, command.enterpriseId],
    ),
  };
}
