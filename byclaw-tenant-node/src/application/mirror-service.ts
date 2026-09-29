import { DomainError } from "../domain/errors.js";
import { reduceAnswer, type AnswerState, type MirrorEnvelope } from "../domain/mirror.js";
import type { MirrorTransaction, MirrorTransactions } from "./mirror-ports.js";

export class MirrorService {
  constructor(private readonly transactions: MirrorTransactions) {}
  async apply(event: MirrorEnvelope, beforeCommit?: () => Promise<void>): Promise<void> {
    await this.transactions.run(async (tx) => {
      await tx.lock(event.sessionId);
      if (event.eventType === "INPUT") await this.input(tx, event);
      else await this.answer(tx, event);
      await beforeCommit?.();
    });
  }
  private async input(tx: MirrorTransaction, event: MirrorEnvelope): Promise<void> {
    const existing = await tx.input(event);
    if (existing) {
      if (
        existing.messageId !== event.userMessageId ||
        existing.sessionId !== event.sessionId ||
        existing.hash !== event.payloadHash ||
        existing.runId !== event.runId ||
        existing.answerMessageId !== event.answerMessageId
      )
        throw new DomainError("IDEMPOTENCY_CONFLICT");
      return;
    }
    await tx.assertInputAccess(event);
    await tx.insertInput(event);
  }
  private async answer(tx: MirrorTransaction, event: MirrorEnvelope): Promise<void> {
    const input = await tx.input(event);
    if (!input) throw new DomainError("INPUT_NOT_COMMITTED");
    if (
      input.sessionId !== event.sessionId ||
      input.runId !== event.runId ||
      input.messageId !== event.userMessageId ||
      input.answerMessageId !== event.answerMessageId
    )
      throw new DomainError("MIRROR_CONTEXT_MISMATCH");
    const previous = await tx.answer(event);
    if (
      previous &&
      (previous.id !== event.payload.id ||
        previous.runId !== event.runId ||
        previous.sessionId !== event.sessionId)
    )
      throw new DomainError("MIRROR_CONTEXT_MISMATCH");
    const initial: AnswerState = previous ?? {
      id: event.payload.id,
      messageId: event.answerMessageId,
      sessionId: event.sessionId,
      runId: event.runId,
      content: "",
      finalContent: null,
      metadata: {},
      version: "0",
      lastSourceId: null,
      lastSeq: "0",
      complete: false,
      status: 0,
      eventId: "",
      hash: "",
    };
    const answer = reduceAnswer(initial, event);
    if (!answer) return;
    await tx.saveAnswer(event, answer, previous);
    if (event.eventType === "TERMINAL") await tx.saveRelation(event, input, answer);
  }
}
