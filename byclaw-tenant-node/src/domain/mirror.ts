import { DomainError } from "./errors.js";
import type { TenantIdentity } from "./tenant.js";
import { text } from "./values.js";

export interface MirrorEnvelope extends TenantIdentity {
  protocolVersion: 1;
  sessionId: string;
  clientRequestId: string;
  runId: string;
  traceId: string;
  userMessageId: string;
  answerMessageId: string;
  eventId: string;
  sourceStreamId: string | null;
  childOrdinal: number;
  eventSeq: string;
  eventType: "INPUT" | "DELTA" | "TERMINAL" | "ERROR" | "CANCEL";
  payloadHash: string;
  payload: Record<string, any>;
}
export interface AnswerState {
  id: string;
  messageId: string;
  sessionId: string;
  runId: string;
  content: string;
  finalContent: string | null;
  metadata: Record<string, any>;
  version: string;
  lastSourceId: string | null;
  lastSeq: string;
  complete: boolean;
  status: number;
  eventId: string;
  hash: string;
}
function sourceParts(value: string): bigint[] {
  return value.split(/[-:]/).map(BigInt);
}
function compareSource(left: string, right: string): number {
  const a = sourceParts(left),
    b = sourceParts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}
export function reduceAnswer(state: AnswerState, event: MirrorEnvelope): AnswerState | null {
  const source = event.sourceStreamId ? `${event.sourceStreamId}:${event.childOrdinal}` : null;
  if (state.version !== "0" && Boolean(source) !== Boolean(state.lastSourceId))
    throw new DomainError("MIRROR_ORDER_MODE_MISMATCH");
  const order =
    source && state.lastSourceId
      ? compareSource(source, state.lastSourceId)
      : !source
        ? Number(BigInt(event.eventSeq) - BigInt(state.lastSeq))
        : 1;
  if (state.eventId === event.eventId || order === 0) {
    if (state.hash !== event.payloadHash) throw new DomainError("IDEMPOTENCY_CONFLICT");
    return null;
  }
  if (order < 0) return null;
  if (!source && BigInt(event.eventSeq) !== BigInt(state.lastSeq) + 1n)
    throw new DomainError("MIRROR_SEQUENCE_GAP");
  if (state.complete) {
    if (event.eventType === "TERMINAL" && event.payload.messageContent === state.content)
      return null;
    throw new DomainError("ANSWER_ALREADY_TERMINAL");
  }
  const content =
    event.eventType === "DELTA"
      ? state.content + text(event.payload.text, 1048576, true)
      : event.payload.messageContent === undefined
        ? state.content
        : text(event.payload.messageContent, 1048576, true);
  text(content, 1048576, true);
  return {
    ...state,
    content,
    finalContent:
      event.eventType === "DELTA"
        ? null
        : text(event.payload.finalContent ?? content, 1048576, true),
    metadata: {
      ...state.metadata,
      ...(event.payload.metadata ?? {}),
      clientRequestId: event.clientRequestId,
      nodeMirror: { eventId: event.eventId, status: event.eventType },
    },
    version: (BigInt(state.version) + 1n).toString(),
    lastSourceId: source,
    lastSeq: event.eventSeq,
    complete: event.eventType !== "DELTA",
    status: ["ERROR", "CANCEL"].includes(event.eventType) ? -1 : 0,
    eventId: event.eventId,
    hash: event.payloadHash,
  };
}
