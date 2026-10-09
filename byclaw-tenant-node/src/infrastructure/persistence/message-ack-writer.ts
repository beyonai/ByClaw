import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first } from "./sql-utils.js";
import { messageAcknowledgements } from "./message-ack-reader.js";

/** 只记录当前被 @ 用户的确认，复用命令事务和会话锁，不生成聊天消息。 */
export async function acknowledgeMessage(context: CommandContext) {
  const { command, db } = context;
  const messageId = requireId(command.payload.messageId);
  if (Object.keys(command.payload).some((key) => !["messageId", "userName"].includes(key)))
    throw new DomainError("INVALID_COMMAND");
  const member = await context.member();
  const message = await first(
    db,
    "SELECT m.creator_id FROM byai.byai_message m JOIN byai.byai_session s ON s.session_id=m.session_id WHERE m.message_id=$1 AND m.session_id=$2 AND s.enterprise_id=$3 AND m.enterprise_id=$3 AND s.session_type='hs_as' AND m.recalled_at IS NULL",
    [messageId, command.sessionId, command.enterpriseId],
  );
  if (!member || !message) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const mentioned = await first(
    db,
    "SELECT 1 FROM byai.byai_group_chat_mention WHERE group_session_id=$1 AND message_id=$2 AND mentioned_user_id=$3",
    [command.sessionId, messageId, command.userId],
  );
  if (String(message.creatorId) === command.userId || !mentioned)
    throw new DomainError("FORBIDDEN");
  const args = [command.sessionId, messageId, command.userId];
  if (command.operation === "ACK_MESSAGE") {
    const userName = text(command.payload.userName ?? member.memName ?? "群成员", 255);
    await db.query(
      "INSERT INTO byai.byai_group_chat_message_ack(session_id,message_id,user_id,user_name,acknowledged_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(session_id,message_id,user_id) DO NOTHING",
      [...args, userName.trim() || "群成员"],
    );
  } else {
    await db.query(
      "DELETE FROM byai.byai_group_chat_message_ack WHERE session_id=$1 AND message_id=$2 AND user_id=$3",
      args,
    );
  }
  return {
    messageId,
    acknowledgements: await messageAcknowledgements(db, command.enterpriseId, command.sessionId, [
      messageId,
    ]),
  };
}
