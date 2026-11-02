import { DomainError } from "../../domain/errors.js";
import type { CommandContext } from "./command-context.js";

/** 以成员关系为边界领取个人欢迎资格；不生成群消息、事件或已读游标。 */
export default async function claimWelcome(context: CommandContext) {
  const { command, db } = context;
  const session = await context.session();
  const member = await context.member();
  if (
    session?.sessionType !== "hs_as" ||
    ["GROUP_DISSOLVED", "CLOSED"].includes(session.state) ||
    !member
  ) {
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  }
  const handledAt = new Date();
  // 主键绑定本次入群，租户和操作者条件进一步限制更新；同一资格只有一个请求能返回记录。
  const updated = await db.query(
    `UPDATE byai.byai_session_member
     SET welcome_handled_at=$1
     WHERE byai_session_member_id=$2 AND session_id=$3 AND mem_obj_type='USER'
       AND mem_obj_id=$4 AND com_acct_id=$5 AND welcome_handled_at IS NULL
     RETURNING byai_session_member_id`,
    [
      handledAt,
      member.byaiSessionMemberId,
      command.sessionId,
      command.userId,
      command.enterpriseId,
    ],
  );
  const granted = updated.length === 1;
  return {
    data: {
      granted,
      sessionId: command.sessionId,
      memberId: String(member.byaiSessionMemberId),
      handledAt: granted ? handledAt.getTime() : null,
    },
  };
}
