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
  saveAnswer(event: MirrorEnvelope, state: AnswerState, previous: AnswerState | null) {
    return this.answerWriter.saveAnswer(event, state, previous);
  }
  saveRelation(event: MirrorEnvelope, input: InputState, answer: AnswerState) {
    return this.answerWriter.saveRelation(event, input, answer);
  }
}
