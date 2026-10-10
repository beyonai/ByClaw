import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { invitationPreview } from "./group-invitation.js";
import { text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
/** BE 验证链接后，Node 再检查群状态与链接开关，仅把当前用户加入为 MEMBER。 */
export async function joinGroup(context: CommandContext): Promise<void> {
  const { command, db } = context;
  if ((await context.session())?.sessionType !== "hs_as")
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const invitation = await invitationPreview(
    db,
    command.enterpriseId,
    command.userId,
    command.payload.token,
  );
  if (invitation.groupNumber !== command.sessionId) throw new DomainError("INVALID_INVITATION");
  if (command.payload.joinLinkAuthorized !== true) throw new DomainError("FORBIDDEN");
  const setting = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code='group_join_link_enabled'",
    [command.sessionId],
  );
  if (setting?.extParamValue === "false") throw new DomainError("GROUP_JOIN_DISABLED");
  if (await context.member()) return;
  await insert(db, "byai_session_member", {
    byai_session_member_id: await nextId(db, command.enterpriseId),
    session_id: command.sessionId,
    mem_obj_type: "USER",
    mem_obj_id: command.userId,
    user_role: "MEMBER",
    mem_name: text(command.payload.memName ?? "", 255),
    creator_id: command.userId,
    com_acct_id: command.enterpriseId,
    create_time: new Date(),
  });
}
