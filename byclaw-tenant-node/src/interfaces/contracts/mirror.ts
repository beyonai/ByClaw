import { DomainError } from "../../domain/errors.js";
import type { MirrorEnvelope } from "../../domain/mirror.js";
import { assertTenant, type TenantIdentity } from "../../domain/tenant.js";
import { requireId } from "../../domain/values.js";
import { canonical, digest, opaqueId, record, sha256 } from "./validation.js";

export function mirrorHash(envelope: Omit<MirrorEnvelope, "payloadHash"> | MirrorEnvelope): string {
  const {
    payloadHash: _,
    generation: _generation,
    dbSandboxRecordId: _record,
    ...value
  } = envelope as MirrorEnvelope;
  return sha256(canonical(value));
}
export function validateMirror(input: unknown, identity: TenantIdentity): MirrorEnvelope {
  const event = record(input) as MirrorEnvelope;
  assertTenant(event, identity);
  const keys = [
    "protocolVersion",
    "enterpriseId",
    "generation",
    "dbSandboxRecordId",
    "sessionId",
    "clientRequestId",
    "runId",
    "traceId",
    "userMessageId",
    "answerMessageId",
    "eventId",
    "sourceStreamId",
    "childOrdinal",
    "eventSeq",
    "eventType",
    "payloadHash",
    "payload",
  ];
  if (Object.keys(event).some((key) => !keys.includes(key)))
    throw new DomainError("INVALID_MIRROR");
  if (
    event.protocolVersion !== 1 ||
    !["INPUT", "DELTA", "TERMINAL", "ERROR", "CANCEL"].includes(event.eventType) ||
    !Number.isSafeInteger(event.childOrdinal) ||
    event.childOrdinal < 0 ||
    typeof event.eventSeq !== "string" ||
    !/^(0|[1-9]\d{0,18})$/.test(event.eventSeq) ||
    (event.sourceStreamId !== null &&
      (typeof event.sourceStreamId !== "string" ||
        !/^(0|[1-9]\d{0,19})-(0|[1-9]\d{0,19})$/.test(event.sourceStreamId)))
  )
    throw new DomainError("INVALID_MIRROR");
  for (const id of [
    event.enterpriseId,
    event.generation,
    event.dbSandboxRecordId,
    event.sessionId,
    event.userMessageId,
    event.answerMessageId,
  ])
    requireId(id);
  for (const id of [event.eventId, event.clientRequestId, event.runId]) opaqueId(id);
  opaqueId(event.traceId, 128);
  digest(event.payloadHash);
  if (BigInt(event.eventSeq) > 9223372036854775807n || event.childOrdinal > 65535)
    throw new DomainError("INVALID_MIRROR");
  const payload = record(event.payload);
  if (
    payload.createTime !== undefined &&
    (typeof payload.createTime !== "string" || !Number.isFinite(Date.parse(payload.createTime)))
  )
    throw new DomainError("INVALID_MIRROR");
  requireId(payload.id);
  if (event.userMessageId === event.answerMessageId) throw new DomainError("INVALID_MIRROR");
  if (event.eventType === "INPUT") requireId(payload.userId);
  if (event.eventType === "TERMINAL") {
    requireId(payload.relationId);
    if (typeof payload.messageContent !== "string") throw new DomainError("INVALID_MIRROR");
  }
  for (const key of ["creatorId", "messageRef", "topicId"])
    if (payload[key] !== undefined && payload[key] !== null) requireId(payload[key]);
  if (payload.mentionedUserIds !== undefined) {
    if (!Array.isArray(payload.mentionedUserIds) || payload.mentionedUserIds.length > 1000)
      throw new DomainError("INVALID_MIRROR");
    payload.mentionedUserIds.forEach(requireId);
  }
  if (payload.metadata !== undefined) record(payload.metadata);
  if (mirrorHash(event) !== event.payloadHash) throw new DomainError("HASH_MISMATCH");
  return event;
}
