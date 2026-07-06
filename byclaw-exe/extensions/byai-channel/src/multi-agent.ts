import type { ByaiLaneMetadata, ByaiSdkInboundMessage } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMaybeRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringField(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    const text =
      typeof value === "string"
        ? value.trim()
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : "";
    if (text) {
      return text;
    }
  }
  return undefined;
}

function stripEmptyMetadata(metadata: ByaiLaneMetadata): ByaiLaneMetadata | undefined {
  const hasLaneIdentity = [
    metadata.laneId,
    metadata.traceId,
    metadata.agentId,
    metadata.agentCode,
    metadata.agentName,
    metadata.clientRequestId,
    metadata.answerMessageId,
    metadata.queryMessageId,
  ].some((value) => value !== undefined);
  return hasLaneIdentity ? metadata : undefined;
}

function parseLaneRecord(
  laneRecord: Record<string, unknown>,
  root: Pick<ByaiLaneMetadata, "turnId" | "mode"> = {},
): ByaiLaneMetadata | undefined {
  return stripEmptyMetadata({
    turnId: stringField(laneRecord, "turnId", "turn_id") ?? root.turnId,
    laneId: stringField(laneRecord, "laneId", "lane_id"),
    mode: stringField(laneRecord, "mode") ?? root.mode,
    traceId: stringField(laneRecord, "traceId", "trace_id"),
    agentId: stringField(laneRecord, "agentId", "agent_id"),
    agentCode: stringField(laneRecord, "agentCode", "agent_code"),
    agentName: stringField(laneRecord, "agentName", "agent_name"),
    clientRequestId: stringField(laneRecord, "clientRequestId", "client_request_id"),
    answerMessageId: stringField(laneRecord, "answerMessageId", "answer_message_id"),
    queryMessageId: stringField(laneRecord, "queryMessageId", "query_message_id"),
  });
}

export function parseByaiLaneMetadata(
  extraPayload: Record<string, unknown> | undefined,
): ByaiLaneMetadata | undefined {
  if (!extraPayload) {
    return undefined;
  }

  const source = parseMaybeRecord(extraPayload.multi_agent) ?? parseMaybeRecord(extraPayload.multiAgent);
  if (!source) {
    return undefined;
  }

  return parseLaneRecord(source);
}

export interface ByaiMultiAgentBatchMetadata {
  turnId?: string;
  mode?: string;
  lanes: ByaiLaneMetadata[];
}

export function parseByaiMultiAgentBatchMetadata(
  extraPayload: Record<string, unknown> | undefined,
): ByaiMultiAgentBatchMetadata | undefined {
  if (!extraPayload) {
    return undefined;
  }

  const source = parseMaybeRecord(extraPayload.multi_agent) ?? parseMaybeRecord(extraPayload.multiAgent);
  if (!source || !Array.isArray(source.lanes)) {
    return undefined;
  }

  const root = {
    turnId: stringField(source, "turnId", "turn_id"),
    mode: stringField(source, "mode"),
  };
  const lanes = source.lanes
    .map((lane) => parseMaybeRecord(lane))
    .filter((lane): lane is Record<string, unknown> => Boolean(lane))
    .map((lane) => parseLaneRecord(lane, root))
    .filter((lane): lane is ByaiLaneMetadata => Boolean(lane));

  if (lanes.length === 0) {
    return undefined;
  }

  return {
    ...root,
    lanes,
  };
}

export function buildByaiMultiAgentLaneMessages(
  baseMessage: ByaiSdkInboundMessage,
  batch: ByaiMultiAgentBatchMetadata | undefined,
): ByaiSdkInboundMessage[] {
  if (!batch || batch.lanes.length === 0) {
    return [baseMessage];
  }

  return batch.lanes.map((lane) => ({
    ...baseMessage,
    messageId:
      lane.answerMessageId ?? lane.clientRequestId ?? lane.queryMessageId ?? baseMessage.messageId,
    traceId: lane.traceId ?? baseMessage.traceId,
    laneMetadata: lane,
    extraPayload: {
      ...(baseMessage.extraPayload ?? {}),
      ...(lane.agentId ? { agent_id: lane.agentId } : {}),
      ...(lane.agentCode ? { agent_code: lane.agentCode } : {}),
      ...(lane.agentName ? { agent_name: lane.agentName } : {}),
      multi_agent: lane,
    },
  }));
}

export function resolveByaiLaneKey(laneMetadata: ByaiLaneMetadata | undefined): string {
  return (
    laneMetadata?.laneId ??
    laneMetadata?.clientRequestId ??
    laneMetadata?.answerMessageId ??
    laneMetadata?.queryMessageId ??
    laneMetadata?.turnId ??
    ""
  );
}

export function appendByaiLaneToSessionKey(
  sessionKey: string,
  laneMetadata: ByaiLaneMetadata | undefined,
): string {
  const laneKey = resolveByaiLaneKey(laneMetadata);
  if (!laneKey) {
    return sessionKey;
  }
  return `${sessionKey}:lane:${encodeURIComponent(laneKey)}`;
}

export function appendByaiLaneToTarget(
  target: string,
  laneMetadata: ByaiLaneMetadata | undefined,
): string {
  const laneKey = resolveByaiLaneKey(laneMetadata);
  if (!laneKey) {
    return target;
  }
  return `${target}:lane:${encodeURIComponent(laneKey)}`;
}
