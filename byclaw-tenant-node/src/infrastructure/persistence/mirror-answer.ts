import type { SqlSession } from "../../application/database-ports.js";
import type { InputState } from "../../application/mirror-ports.js";
import type { AnswerState, MirrorEnvelope } from "../../domain/mirror.js";
import { indexGroupMessage } from "./group-message-index.js";
import { DomainError } from "../../domain/errors.js";
import { first, insert } from "./sql-utils.js";
import { nextSequence, answerFields } from "./message-fields.js";
/** 稳定回答行的读取与版本条件更新；回答终态和问答关系由外层事务一起提交。 */
export class MirrorAnswerWriter {
  constructor(
    private readonly db: SqlSession,
    private readonly enterpriseId: string,
  ) {}
  async answer(event: MirrorEnvelope): Promise<AnswerState | null> {
    const row = await first(
      this.db,
      "SELECT * FROM byai.byai_message WHERE message_id=$1 AND enterprise_id=$2 FOR UPDATE",
      [event.answerMessageId, this.enterpriseId],
    );
    if (!row) return null;
    if (row.usage !== 2) throw new DomainError("MIRROR_CONTEXT_MISMATCH");
    const metadata = JSON.parse(row.metadata || "{}");
    return {
      id: row.id,
      messageId: row.messageId,
      sessionId: row.sessionId,
      runId: row.runId,
      content: row.messageContent ?? "",
      finalContent: row.finalContent,
      metadata,
      version: row.storageVersion,
      lastSourceId: row.lastMirrorEventId,
      lastSeq: row.lastMirrorEventSeq,
      complete: row.isComplete,
      status: row.msgStatus,
      eventId: row.persistCommandId,
      hash: row.persistHash,
    };
  }
  async saveAnswer(
    event: MirrorEnvelope,
    state: AnswerState,
    previous: AnswerState | null,
  ): Promise<void> {
    const values = {
      id: state.id,
      message_id: state.messageId,
      session_id: state.sessionId,
      enterprise_id: this.enterpriseId,
      usage: 2,
      role: "assistant",
      run_id: state.runId,
      ...answerFields(event.payload, !previous),
      message_content: state.content,
      final_content: state.finalContent,
      metadata: JSON.stringify(state.metadata),
      storage_version: state.version,
      last_mirror_event_id: state.lastSourceId,
      last_mirror_event_seq: state.lastSeq,
      persist_command_id: state.eventId,
      persist_hash: state.hash,
      is_complete: state.complete,
      msg_status: state.status,
      update_time: new Date(),
    };
    if (!previous) {
      await insert(this.db, "byai_message", {
        ...values,
        created_seq: await nextSequence(this.db, this.enterpriseId, event.sessionId),
        create_time: event.payload.createTime ? new Date(event.payload.createTime) : new Date(),
      });
      await indexGroupMessage(
        this.db,
        this.enterpriseId,
        state.messageId,
        event.userMessageId,
        event,
      );
      return;
    }
    const entries = Object.entries(values).filter(
      ([name]) => !["id", "message_id", "session_id", "enterprise_id"].includes(name),
    );
    const rows = await this.db.query(
      `UPDATE byai.byai_message SET ${entries.map(([name], index) => `${name}=$${index + 1}`).join(",")}
      WHERE message_id=$${entries.length + 1} AND enterprise_id=$${entries.length + 2} AND storage_version=$${entries.length + 3} RETURNING message_id`,
      [...entries.map(([, value]) => value), state.messageId, this.enterpriseId, previous.version],
    );
    if (!rows.length) throw new DomainError("VERSION_CONFLICT");
  }
  async saveRelation(event: MirrorEnvelope, input: InputState, answer: AnswerState): Promise<void> {
    const existing = await first(
      this.db,
      "SELECT * FROM byai.byai_message_relobj WHERE ask_msg_id=$1 AND res_msg_id=$2",
      [input.messageId, answer.messageId],
    );
    if (existing) {
      if (
        existing.id !== event.payload.relationId ||
        existing.sessionId !== event.sessionId ||
        existing.comAcctId !== this.enterpriseId
      )
        throw new DomainError("IDEMPOTENCY_CONFLICT");
      return;
    }
    await insert(this.db, "byai_message_relobj", {
      id: event.payload.relationId,
      session_id: event.sessionId,
      com_acct_id: this.enterpriseId,
      ask_msg_id: input.messageId,
      res_msg_id: answer.messageId,
      ask_obj_id: input.userId,
      ask_obj_type: "USER",
      ask_content: input.content,
      res_content: answer.content,
      request_status: 0,
      create_time: new Date(),
    });
  }
}
