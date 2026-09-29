import type { AnswerState, MirrorEnvelope } from "../domain/mirror.js";
export interface InputState {
  messageId: string;
  sessionId: string;
  runId: string;
  answerMessageId: string;
  hash: string;
  userId: string;
  content: string;
}
/** 镜像事务端口；INPUT、回答版本及问答关系都复用既有租户表。 */
export interface MirrorTransaction {
  lock(sessionId: string): Promise<void>;
  input(event: MirrorEnvelope): Promise<InputState | null>;
  assertInputAccess(event: MirrorEnvelope): Promise<void>;
  insertInput(event: MirrorEnvelope): Promise<void>;
  answer(event: MirrorEnvelope): Promise<AnswerState | null>;
  saveAnswer(
    event: MirrorEnvelope,
    state: AnswerState,
    previous: AnswerState | null,
  ): Promise<void>;
  saveRelation(event: MirrorEnvelope, input: InputState, answer: AnswerState): Promise<void>;
}
export interface MirrorTransactions {
  run<T>(work: (tx: MirrorTransaction) => Promise<T>): Promise<T>;
}
