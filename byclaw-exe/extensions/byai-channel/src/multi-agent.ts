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

function explicitLaneTaskText(laneRecord: Record<string, unknown>): string | undefined {
  return stringField(
    laneRecord,
    "taskText",
    "task_text",
    "task",
    "prompt",
    "question",
    "content",
    "text",
    "message",
    "body",
  );
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
    metadata.taskText,
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
    taskText: explicitLaneTaskText(laneRecord),
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

  const laneTexts = resolveByaiLaneInboundTexts(baseMessage.text, batch.lanes);
  return batch.lanes.map((lane) => ({
    ...baseMessage,
    text: laneTexts.get(lane) ?? baseMessage.text,
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

interface LaneMentionMatch {
  lane: ByaiLaneMetadata;
  laneIndex: number;
  start: number;
  end: number;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isNumericAlias(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionAliasPattern(alias: string): string | undefined {
  const normalized = alias.trim().replace(/^@+/, "").trim();
  if (!normalized || isNumericAlias(normalized)) {
    return undefined;
  }
  const parts = normalized
    .split(/[\s_-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.map(escapeRegExp).join("[\\s_-]+");
}

function laneMentionAliases(lane: ByaiLaneMetadata): string[] {
  return uniqueNonEmpty([
    lane.agentName,
    lane.agentCode,
    lane.laneId,
  ]);
}

function collectLaneMentionMatches(
  text: string,
  lanes: ByaiLaneMetadata[],
): LaneMentionMatch[] {
  const matches: LaneMentionMatch[] = [];

  lanes.forEach((lane, laneIndex) => {
    for (const alias of laneMentionAliases(lane)) {
      const pattern = buildMentionAliasPattern(alias);
      if (!pattern) {
        continue;
      }
      const regex = new RegExp(`@\\s*${pattern}`, "giu");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          lane,
          laneIndex,
          start: match.index,
          end: match.index + match[0].length,
        });
        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
      }
    }
  });

  const selected: LaneMentionMatch[] = [];
  for (const match of matches.sort(
    (a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.laneIndex - b.laneIndex,
  )) {
    const previous = selected[selected.length - 1];
    if (previous && match.start < previous.end) {
      continue;
    }
    selected.push(match);
  }
  return selected;
}

function noLaneAssignmentText(lane: ByaiLaneMetadata): string {
  const agent = lane.agentName || lane.agentCode || lane.laneId || "this agent";
  return [
    `本轮 multi-agent 入站消息没有给 ${agent} 单独派发可处理任务。`,
    "不要处理其他 @agent 的任务；如需回应，请简短说明本 lane 未收到明确任务。",
  ].join("\n");
}

export function resolveByaiLaneInboundTexts(
  baseText: string,
  lanes: ByaiLaneMetadata[],
): Map<ByaiLaneMetadata, string> {
  const result = new Map<ByaiLaneMetadata, string>();
  for (const lane of lanes) {
    if (lane.taskText?.trim()) {
      result.set(lane, lane.taskText.trim());
    }
  }

  const lanesWithoutExplicitText = lanes.filter((lane) => !result.has(lane));
  if (lanesWithoutExplicitText.length === 0) {
    return result;
  }

  const matches = collectLaneMentionMatches(baseText, lanesWithoutExplicitText);
  if (matches.length === 0) {
    for (const lane of lanesWithoutExplicitText) {
      result.set(lane, baseText);
    }
    return result;
  }

  const sharedPrefix = baseText.slice(0, matches[0].start).trim();
  matches.forEach((match, index) => {
    const nextMatch = matches[index + 1];
    const segment = baseText.slice(match.end, nextMatch?.start ?? baseText.length).trim();
    const scopedText = [sharedPrefix, segment].filter(Boolean).join("\n").trim()
      || baseText.slice(match.start, match.end).trim();
    const previous = result.get(match.lane);
    result.set(match.lane, previous ? `${previous}\n${scopedText}` : scopedText);
  });

  for (const lane of lanesWithoutExplicitText) {
    if (!result.has(lane)) {
      result.set(lane, noLaneAssignmentText(lane));
    }
  }
  return result;
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
