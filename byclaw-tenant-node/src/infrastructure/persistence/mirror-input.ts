import type { SqlSession } from "../../application/database-ports.js";
import type { InputState } from "../../application/mirror-ports.js";
import type { MirrorEnvelope } from "../../domain/mirror.js";
import { indexGroupMessage } from "./group-message-index.js";
import { DomainError } from "../../domain/errors.js";
import { text } from "../../domain/values.js";
import { first, insert } from "./sql-utils.js";
import { nextSequence } from "./message-fields.js";
/** 复用用户消息行保存 INPUT 身份与摘要，校验会话访问后同步更新群话题和提及索引。 */
export class MirrorInputWriter {
  constructor(
    private readonly db: SqlSession,
    private readonly enterpriseId: string,
  ) {}
  async input(event: MirrorEnvelope): Promise<InputState | null> {
    const row = await first(
      this.db,
      `SELECT * FROM byai.byai_message WHERE enterprise_id=$1 AND usage=1 AND
      (message_id=$2 OR persist_command_id=$3 OR (client_request_id=$4 AND creator_id=$5)) LIMIT 1`,
      [
        this.enterpriseId,
        event.userMessageId,
        event.eventType === "INPUT" ? event.eventId : "",
        event.clientRequestId,
        event.payload.userId ?? null,
      ],
    );
    return row
      ? {
          messageId: row.messageId,
          sessionId: row.sessionId,
          runId: row.runId,
          answerMessageId: row.answerMessageId,
          hash: row.persistHash,
          userId: row.creatorId,
          content: row.messageContent,
        }
      : null;
  }
  async assertInputAccess(event: MirrorEnvelope): Promise<void> {
    const session = await first(
      this.db,
      "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [event.sessionId, this.enterpriseId],
    );
    if (!session || ["CLOSED", "GROUP_DISSOLVED", "GROUP_CHAT_ROUTING"].includes(session.state))
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    if (session.sessionType === "hs_as") {
      const member = await first(
        this.db,
        "SELECT 1 FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
        [event.sessionId, event.payload.userId, this.enterpriseId],
      );
      if (!member) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    } else {
      if (session.creatorId !== event.payload.userId)
        throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      const task = await first(
        this.db,
        "SELECT group_session_id,initiator_user_id FROM byai.byai_group_chat_task WHERE task_session_id=$1",
        [event.sessionId],
      );
      if (task) {
        const member = await first(
          this.db,
          "SELECT 1 FROM byai.byai_session s JOIN byai.byai_session_member m ON m.session_id=s.session_id WHERE s.session_id=$1 AND s.enterprise_id=$2 AND s.session_type='hs_as' AND COALESCE(s.state,'ACTIVE') NOT IN('GROUP_DISSOLVED','CLOSED') AND m.mem_obj_type='USER' AND m.mem_obj_id=$3 AND m.com_acct_id=$2",
          [task.groupSessionId, this.enterpriseId, event.payload.userId],
        );
        if (!member || task.initiatorUserId !== event.payload.userId)
          throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
      }
    }
  }
  async insertInput(event: MirrorEnvelope): Promise<void> {
    await insert(this.db, "byai_message", {
      id: event.payload.id,
      message_id: event.userMessageId,
      session_id: event.sessionId,
      enterprise_id: this.enterpriseId,
      creator_id: event.payload.userId,
      creator_name: event.payload.creatorName ?? null,
      usage: 1,
      role: "user",
      message_ref: event.payload.messageRef ?? null,
      message_content: text(event.payload.messageContent, 262144, true),
      metadata: JSON.stringify({
        ...event.payload.metadata,
        clientRequestId: event.clientRequestId,
      }),
      message_struct:
        event.payload.messageStruct === undefined
          ? null
          : JSON.stringify(event.payload.messageStruct),
      related_resources:
        event.payload.relatedResources === undefined
          ? null
          : JSON.stringify(event.payload.relatedResources),
      client_request_id: event.clientRequestId,
      run_id: event.runId,
      answer_message_id: event.answerMessageId,
      persist_command_id: event.eventId,
      persist_hash: event.payloadHash,
      storage_version: "1",
      created_seq: await nextSequence(this.db, this.enterpriseId, event.sessionId),
      is_complete: true,
      msg_status: 0,
      create_time: event.payload.createTime ? new Date(event.payload.createTime) : new Date(),
      update_time: new Date(),
    });
    await indexGroupMessage(
      this.db,
      this.enterpriseId,
      event.userMessageId,
      event.payload.messageRef ?? null,
      event,
    );
  }
}
