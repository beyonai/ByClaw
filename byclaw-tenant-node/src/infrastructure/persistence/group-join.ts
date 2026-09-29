import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { text } from "../../domain/values.js";
import { first, insert, nextId } from "./sql-utils.js";
export async function joinGroup(context: CommandContext): Promise<void> {
  const { command, db } = context;
  if (command.payload.joinLinkAuthorized !== true) throw new DomainError("FORBIDDEN");
  const setting = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code='group_join_link_enabled'",
    [command.sessionId],
  );
  if (setting?.extParamValue === "false") throw new DomainError("GROUP_JOIN_DISABLED");
  if (await context.member()) return;
  await insert(db, "byai_session_member", {
    byai_session_member_id: await nextId(db),
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
