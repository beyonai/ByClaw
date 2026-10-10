import type { ConnectionManager } from "../../application/connection-manager.js";
import type { SqlSession } from "../../application/database-ports.js";
import type {
  InputState,
  MirrorTransaction,
  MirrorTransactions,
} from "../../application/mirror-ports.js";
import type { AnswerState, MirrorEnvelope } from "../../domain/mirror.js";
import { DomainError } from "../../domain/errors.js";
import { MirrorInputWriter } from "./mirror-input.js";
import { MirrorAnswerWriter } from "./mirror-answer.js";
import { first } from "./sql-utils.js";
import { projectGroupTaskAnswer } from "./group-task-answer.js";
import { readGroupCandidate } from "./group-candidate.js";

/** 将镜像业务端口接到租户事务，INPUT、回答与关系写入共用同一连接。 */
export class SqlMirrorTransactions implements MirrorTransactions {
  constructor(private readonly connection: ConnectionManager) {}
  run<T>(work: (tx: MirrorTransaction) => Promise<T>): Promise<T> {
    return this.connection.write((db) =>
      work(new SqlMirrorTransaction(db, this.connection.identity.enterpriseId)),
    );
  }
}
class SqlMirrorTransaction implements MirrorTransaction {
  constructor(
    private readonly db: SqlSession,
    private readonly enterpriseId: string,
  ) {
    this.inputWriter = new MirrorInputWriter(db, enterpriseId);
    this.answerWriter = new MirrorAnswerWriter(db, enterpriseId);
  }
  private readonly inputWriter: MirrorInputWriter;
  private readonly answerWriter: MirrorAnswerWriter;
  async lock(sessionId: string): Promise<void> {
    const candidate = await readGroupCandidate(this.db, sessionId);
    if (candidate)
      // Group lifecycle/recall commands lock the group first; use the same order before promotion.
      await this.db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `session:${candidate.groupSessionId}`,
      ]);
    await this.db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`session:${sessionId}`]);
    const session = await first(
      this.db,
      "SELECT enterprise_id FROM byai.byai_session WHERE session_id=$1 FOR UPDATE",
      [sessionId],
    );
    if (!session) throw new DomainError("SESSION_NOT_COMMITTED");
    if (session.enterpriseId !== this.enterpriseId)
      throw new DomainError("SESSION_TENANT_MISMATCH");
  }
  input(event: MirrorEnvelope) {
    return this.inputWriter.input(event);
  }
  assertInputAccess(event: MirrorEnvelope) {
    return this.inputWriter.assertInputAccess(event);
  }
  insertInput(event: MirrorEnvelope) {
    return this.inputWriter.insertInput(event);
  }
  answer(event: MirrorEnvelope) {
    return this.answerWriter.answer(event);
  }
  async saveAnswer(event: MirrorEnvelope, state: AnswerState, previous: AnswerState | null) {
    await this.answerWriter.saveAnswer(event, state, previous);
    if (
      ["ERROR", "CANCEL"].includes(event.eventType) ||
      (event.eventType === "DELTA" && event.payload.metadata?.groupDisposition)
    )
      await projectGroupTaskAnswer(this.db, this.enterpriseId, event, state);
  }
  async saveRelation(event: MirrorEnvelope, input: InputState, answer: AnswerState) {
    await this.answerWriter.saveRelation(event, input, answer);
    await projectGroupTaskAnswer(this.db, this.enterpriseId, event, answer);
  }
}
