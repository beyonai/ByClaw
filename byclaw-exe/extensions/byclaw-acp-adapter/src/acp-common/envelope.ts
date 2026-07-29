import { createHash } from "node:crypto";

export type AcpEventLike = {
  seq?: number;
  stream?: string;
  type?: string;
  runId?: string;
  ts?: number;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
};

export type AcpAgentIdentity = {
  id: string;
  name?: string;
  source: "event_field" | "structured_marker" | "inferred_text" | "runtime_metadata" | "active_context" | "spawn_binding" | "client_session" | "plan_bundle_default";
  nativeSubagentId?: string;
  nativeSubagentName?: string;
  byclawAgentId?: string;
  role?: string;
  phase?: string;
  workflowStepId?: string;
  metadata?: Record<string, unknown>;
};

export type AcpStructuredAgentMarker = {
  index: number;
  offset?: number;
  raw: string;
  marker: Record<string, unknown>;
  identity: AcpAgentIdentity;
};

export type AcpToolEnvelope = {
  callId?: string;
  name?: string;
  title?: string;
  status?: string;
  isError?: boolean;
};

export type AcpAgentCallEnvelope = {
  version: 1;
  protocol: "acp";
  direction: "child-to-parent";
  envelopeId: string;
  parentEnvelopeId?: string;
  semanticType: string;
  phase: "start" | "update" | "result" | "event";
  stream?: string;
  seq?: number;
  ts?: number;
  parentSessionKey?: string;
  parentSessionId?: string;
  parentRunId?: string;
  childSessionKey?: string;
  childSessionId?: string;
  childRunId?: string;
  clientId: string;
  agent: AcpAgentIdentity;
  tool?: AcpToolEnvelope;
  textPreview?: string;
  rawEvent: Record<string, unknown>;
};

export type AcpEnvelopeBinding = {
  parentSessionKey?: string;
  parentSessionId?: string;
  parentRunId?: string;
  childRunId?: string;
  agentId?: string;
  agentName?: string;
  agentSource?: AcpAgentIdentity["source"];
  parentEnvelopeId?: string;
};

const ACP_CHILD_SESSION_RE = /^agent:([^:]+):acp:/u;
const MAX_TEXT_PREVIEW_CHARS = 600;
const AGENT_ID_KEYS = [
  "agentId",
  "agent_id",
  "nativeAgentId",
  "native_agent_id",
  "nativeSubagentId",
  "native_subagent_id",
  "claudeAgentId",
  "claude_agent_id",
  "workflowAgentId",
  "workflow_agent_id",
  "byclawAgentId",
  "byclaw_agent_id",
  "agent",
  "subagentId",
  "subAgentId",
  "subagent_id",
  "role",
  "roleId",
  "role_id",
  "worker",
  "workerId",
  "worker_id",
  "actor",
  "actorId",
  "actor_id",
  "assignee",
  "taskAgent",
  "taskAgentId",
  "task_agent_id",
] as const;
const AGENT_NAME_KEYS = [
  "agentName",
  "agent_name",
  "nativeAgentName",
  "native_agent_name",
  "nativeSubagentName",
  "native_subagent_name",
  "claudeAgentName",
  "claude_agent_name",
  "workflowAgentName",
  "workflow_agent_name",
  "byclawAgentName",
  "byclaw_agent_name",
  "subagentName",
  "subAgentName",
  "subagent_name",
  "roleName",
  "role_name",
  "workerName",
  "worker_name",
  "actorName",
  "actor_name",
  "displayName",
  "display_name",
] as const;
const STRUCTURED_AGENT_MARKER_RE = /(?:BYCLAW_AGENT_EVENT|ACP_AGENT_EVENT|OPENCLAW_AGENT_EVENT)\s*/gu;
const STRUCTURED_AGENT_MARKER_NAME_RE = /(?:BYCLAW_AGENT_EVENT|ACP_AGENT_EVENT|OPENCLAW_AGENT_EVENT)/gu;
const SIMPLE_AGENT_TAG_KEYS = [
  "agent_id",
  "agent_name",
  "native_subagent_id",
  "native_subagent_name",
  "byclaw_agent_id",
  "role",
  "phase",
  "workflow_step_id",
] as const;
const GENERIC_INFERRED_AGENT_IDS = new Set([
  "agent",
  "agents",
  "all",
  "bundle",
  "bundles",
  "client",
  "clients",
  "definition",
  "definitions",
  "employee",
  "employees",
  "entry",
  "entries",
  "loop",
  "loops",
  "member",
  "members",
  "metadata",
  "model",
  "models",
  "native",
  "parent",
  "plan",
  "remote",
  "role",
  "roles",
  "roster",
  "session",
  "sessions",
  "step",
  "steps",
  "subagent",
  "subagents",
  "task",
  "tasks",
  "team",
  "teams",
  "tool",
  "tools",
  "workflow",
  "workflows",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function acpString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function acpClientIdFromSessionKey(sessionKey: string | undefined): string {
  return ACP_CHILD_SESSION_RE.exec(sessionKey ?? "")?.[1] ?? "acp";
}

export function isAcpChildSessionKey(sessionKey: string | undefined): boolean {
  return Boolean(sessionKey && ACP_CHILD_SESSION_RE.test(sessionKey));
}

export function normalizeAcpNameSegment(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized || fallback;
}

function acpDisplayNameSegment(value: string | undefined, fallback: string): string {
  const display = value
    ?.trim()
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[.\\/]+/gu, " ")
    .slice(0, 96)
    .trim();
  return display || fallback;
}

export function acpStableId(...parts: Array<string | number | undefined>): string {
  const hash = createHash("sha256")
    .update(parts.filter((part) => part !== undefined && String(part).length > 0).map(String).join(":"))
    .digest("hex")
    .slice(0, 16);
  return /^0+$/u.test(hash) ? "0000000000000001" : hash;
}

export function buildAcpRawEvent(event: AcpEventLike): Record<string, unknown> {
  return {
    ...(event.seq !== undefined ? { seq: event.seq } : {}),
    ...(event.stream !== undefined ? { stream: event.stream } : {}),
    ...(event.type !== undefined ? { type: event.type } : {}),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
    ...(event.ts !== undefined ? { ts: event.ts } : {}),
    ...(event.sessionKey !== undefined ? { sessionKey: event.sessionKey } : {}),
    ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    data: isRecord(event.data) ? { ...event.data } : event.data,
  };
}

export function isAcpToolCallEvent(event: AcpEventLike): boolean {
  if (event.stream !== "acp" && event.stream !== "tool") {
    return false;
  }
  const data = isRecord(event.data) ? event.data : {};
  const tag = acpString(data.tag);
  const eventType = acpString(data.eventType);
  return event.stream === "tool" || eventType === "tool_call" || tag === "tool_call" || tag === "tool_call_update";
}

export function resolveAcpToolPhase(event: AcpEventLike): AcpAgentCallEnvelope["phase"] {
  const data = isRecord(event.data) ? event.data : {};
  const status = acpString(data.status)?.toLowerCase();
  const phase = acpString(data.phase)?.toLowerCase();
  if (/^(completed|complete|done|success|succeeded|failed|failure|error)$/u.test(status ?? "")) {
    return "result";
  }
  if (/^(result|end|error)$/u.test(phase ?? "")) {
    return "result";
  }
  if (/^(pending|start|started|running)$/u.test(status ?? "") || phase === "start") {
    return "start";
  }
  return isAcpToolCallEvent(event) ? "update" : "event";
}

export function resolveAcpEventText(event: AcpEventLike): string | undefined {
  const data = isRecord(event.data) ? event.data : {};
  for (const key of ["text", "delta", "content", "message", "summary", "title", "error"]) {
    const value = data[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

export function truncateAcpText(value: string | undefined, maxChars = MAX_TEXT_PREVIEW_CHARS): string | undefined {
  if (!value) {
    return undefined;
  }
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars - 1)}...`;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = acpString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeAgentId(value: string | undefined): string | undefined {
  const normalized = normalizeAcpNameSegment(value, "");
  if (normalized.length < 2 || normalized.length > 96) {
    return undefined;
  }
  if (!/^[a-z0-9]/u.test(normalized)) {
    return undefined;
  }
  if (/^\.[a-z0-9]+$/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeInferredAgentId(value: string | undefined): string | undefined {
  const normalized = normalizeAgentId(value);
  if (!normalized || /^(?:by|byclaw|byclaw-)$/iu.test(normalized)) {
    return undefined;
  }
  if (GENERIC_INFERRED_AGENT_IDS.has(normalized)) {
    return undefined;
  }
  if (/^[a-f0-9]{16}$/iu.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeInferredByClawRole(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .replace(/[)"'`*_.,;:，。；：]+$/gu, "")
    .replace(/\s*\/\s*/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return normalizeInferredAgentId(normalized);
}

function firstMarkerString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  return firstString(record, keys);
}

function readSimpleTag(text: string, key: string): string | undefined {
  const xml = new RegExp(`<${key}>([^<]{1,256})</${key}>`, "iu").exec(text)?.[1];
  if (xml?.trim()) {
    return xml.trim();
  }
  const kv = new RegExp(`(?:^|[\\s,;])${key}\\s*=\\s*["']?([^"'\\s,;<>]{1,256})`, "iu").exec(text)?.[1];
  return kv?.trim() || undefined;
}

function findStructuredAgentMarkerJson(text: string): Array<{
  markerStart: number;
  jsonStart: number;
  jsonEnd: number;
  raw: string;
}> {
  const matches: Array<{
    markerStart: number;
    jsonStart: number;
    jsonEnd: number;
    raw: string;
  }> = [];
  for (const match of text.matchAll(STRUCTURED_AGENT_MARKER_RE)) {
    const markerStart = match.index ?? 0;
    let index = markerStart + match[0].length;
    while (/\s/u.test(text[index] ?? "")) {
      index += 1;
    }
    if (text[index] !== "{") {
      continue;
    }
    const jsonStart = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          matches.push({
            markerStart,
            jsonStart,
            jsonEnd: index + 1,
            raw: text.slice(jsonStart, index + 1),
          });
          break;
        }
      }
    }
  }
  return matches;
}

export function extractAcpStructuredAgentMarkers(text: string | undefined): AcpStructuredAgentMarker[] {
  if (!text) {
    return [];
  }
  const markers: AcpStructuredAgentMarker[] = [];
  for (const match of findStructuredAgentMarkerJson(text)) {
    try {
      const parsed = JSON.parse(match.raw);
      if (isRecord(parsed)) {
        const identity = agentIdentityFromMarker(parsed);
        if (identity) {
          markers.push({
            index: markers.length,
            offset: match.markerStart,
            raw: match.raw,
            marker: parsed,
            identity,
          });
        }
      }
    } catch {
      // Ignore malformed agent telemetry markers. They are advisory metadata.
    }
  }
  if (markers.length > 0) {
    return markers;
  }

  const tags: Record<string, unknown> = {};
  for (const key of SIMPLE_AGENT_TAG_KEYS) {
    const value = readSimpleTag(text, key);
    if (value) {
      tags[key] = value;
    }
  }
  const identity = Object.keys(tags).length ? agentIdentityFromMarker(tags) : undefined;
  return identity
    ? [
        {
          index: 0,
          raw: JSON.stringify(tags),
          marker: tags,
          identity,
        },
      ]
    : [];
}

export function stripAcpStructuredAgentMarkers(text: string | undefined): string | undefined {
  if (!text) {
    return text;
  }
  const ranges = findStructuredAgentMarkerJson(text);
  let stripped = "";
  let cursor = 0;
  for (const range of ranges) {
    const markerStart = range.markerStart > cursor && text[range.markerStart - 1] === "`"
      ? range.markerStart - 1
      : range.markerStart;
    const markerEnd = text[range.jsonEnd] === "`" ? range.jsonEnd + 1 : range.jsonEnd;
    stripped += text.slice(cursor, markerStart);
    cursor = markerEnd;
  }
  stripped += text.slice(cursor);
  return stripped
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      return !SIMPLE_AGENT_TAG_KEYS.some((key) => {
        const xmlRe = new RegExp(`^<${key}>[^<]{1,256}</${key}>$`, "iu");
        const kvRe = new RegExp(`^${key}\\s*=\\s*["']?[^"'\\s,;<>]{1,256}$`, "iu");
        return xmlRe.test(trimmed) || kvRe.test(trimmed);
      });
    })
    .join("\n")
    .trim();
}

export function sanitizeAcpVisibleText(text: string | undefined): string | undefined {
  const stripped = stripAcpStructuredAgentMarkers(text);
  if (!stripped) {
    return stripped;
  }
  return stripped
    .replace(STRUCTURED_AGENT_MARKER_NAME_RE, "内部状态标记")
    .trim();
}

function extractStructuredAgentMarker(text: string | undefined): Record<string, unknown> | undefined {
  const markers = extractAcpStructuredAgentMarkers(text);
  return markers.at(-1)?.marker;
}

function isStructuredAgentMarkerRecord(record: Record<string, unknown>): boolean {
  return Boolean(
    acpString(record.nativeSubagentId)
      ?? acpString(record.native_subagent_id)
      ?? acpString(record.nativeAgentId)
      ?? acpString(record.native_agent_id)
      ?? acpString(record.claudeAgentId)
      ?? acpString(record.claude_agent_id)
      ?? acpString(record.byclawAgentId)
      ?? acpString(record.byclaw_agent_id)
      ?? acpString(record.workflowStepId)
      ?? acpString(record.workflow_step_id),
  );
}

function agentIdentityFromMarker(marker: Record<string, unknown>): AcpAgentIdentity | undefined {
  const id = normalizeAgentId(firstMarkerString(marker, AGENT_ID_KEYS));
  const nativeSubagentId = normalizeAgentId(
    acpString(marker.nativeSubagentId)
      ?? acpString(marker.native_subagent_id)
      ?? acpString(marker.nativeAgentId)
      ?? acpString(marker.native_agent_id)
      ?? acpString(marker.claudeAgentId)
      ?? acpString(marker.claude_agent_id)
      ?? id,
  );
  const finalId = nativeSubagentId ?? id;
  if (!finalId) {
    return undefined;
  }
  const name =
    firstMarkerString(marker, AGENT_NAME_KEYS)
    ?? acpString(marker.nativeSubagentName)
    ?? acpString(marker.native_subagent_name);
  return {
    id: finalId,
    ...(name ? { name } : {}),
    source: "structured_marker",
    ...(nativeSubagentId ? { nativeSubagentId } : {}),
    ...(name ? { nativeSubagentName: name } : {}),
    ...(acpString(marker.byclawAgentId) ?? acpString(marker.byclaw_agent_id)
      ? { byclawAgentId: acpString(marker.byclawAgentId) ?? acpString(marker.byclaw_agent_id) }
      : {}),
    ...(acpString(marker.role) ? { role: acpString(marker.role) } : {}),
    ...(acpString(marker.phase) ? { phase: acpString(marker.phase) } : {}),
    ...(acpString(marker.workflowStepId) ?? acpString(marker.workflow_step_id)
      ? { workflowStepId: acpString(marker.workflowStepId) ?? acpString(marker.workflow_step_id) }
      : {}),
    metadata: { ...marker },
  };
}

function firstLooseTextValue(
  text: string,
  keys: readonly string[],
  options?: { allowBareProse?: boolean },
): string | undefined {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const quoted = new RegExp(`(?:^|[^A-Za-z0-9_])["']?${escapedKey}["']?\\s*[:=]\\s*["']([^"']{1,256})["']`, "iu")
      .exec(text)?.[1];
    if (quoted?.trim()) {
      return quoted.trim();
    }
    const unquoted = new RegExp(`(?:^|[^A-Za-z0-9_])["']?${escapedKey}["']?\\s*[:=]\\s*([^"'\\s,;}，）]{1,256})(?=[\\s,;}，）])`, "iu")
      .exec(text)?.[1];
    if (unquoted?.trim()) {
      return unquoted.trim();
    }
    if (options?.allowBareProse) {
      const prose = new RegExp(`(?:^|[^A-Za-z0-9_])${escapedKey}\\s+["']?([^"'\\s,;}，）]{1,256})`, "iu").exec(text)?.[1];
      if (prose?.trim()) {
        return prose.trim();
      }
    }
  }
  return undefined;
}

function inferredAgentIdentityFromText(text: string | undefined): AcpAgentIdentity | undefined {
  if (!text) {
    return undefined;
  }
  const explicitId = normalizeInferredAgentId(firstLooseTextValue(text, [
    "subagent_type",
    "subagentName",
    "subagentId",
    "subAgentId",
    "subagent_id",
    "taskAgent",
    "taskAgentId",
    "task_agent_id",
    "agentId",
    "agent_id",
    "nativeAgentId",
    "native_agent_id",
    "nativeSubagentId",
    "native_subagent_id",
    "claudeAgentId",
    "claude_agent_id",
    "workflowAgentId",
    "workflow_agent_id",
    "agent",
    "worker",
    "workerId",
    "worker_id",
    "actor",
    "actorId",
    "actor_id",
    "assignee",
  ]));
  const nativeSubagentId =
    normalizeInferredAgentId(firstLooseTextValue(text, [
      "nativeSubagentId",
      "native_subagent_id",
      "nativeAgentId",
      "native_agent_id",
      "claudeAgentId",
      "claude_agent_id",
      "workflowAgentId",
      "workflow_agent_id",
    ]));
  const hasStrongAgentHint =
    /(?:subagent_type|subagentName|subagentId|subagent_id|nativeSubagentId|native_subagent_id|nativeAgentId|native_agent_id|claudeAgentId|claude_agent_id|workflowAgentId|workflow_agent_id|byclawAgentId|byclaw_agent_id)\s*(?:[:=]|\s+)/iu
      .test(text);
  const hasByClawRuntimePhrase =
    /(?:你是|你作为|作为|You\s+are\s+running\s+as|running\s+as)\s+(?:the\s+)?[*_`"]{0,3}ByClaw\s+/iu
      .test(text);
  const byclawRole = normalizeInferredByClawRole(
    hasStrongAgentHint || hasByClawRuntimePhrase
      ? /(?:你是|你作为|作为|You\s+are\s+running\s+as|running\s+as)\s+(?:the\s+)?[*_`"]{0,3}ByClaw\s+([a-z][a-z0-9._-]*(?:(?:\s+|\s*\/\s*)[a-z][a-z0-9._-]*){0,3})[*_`"]{0,3}(?=[\s,.;:，。；：（(]|$)/iu
        .exec(text)?.[1]
      : undefined,
  );
  if (!hasStrongAgentHint && !byclawRole) {
    return undefined;
  }
  const role = normalizeInferredByClawRole(firstLooseTextValue(text, ["role", "roleId", "role_id"], { allowBareProse: true })) ?? byclawRole;
  const finalId = normalizeInferredAgentId(nativeSubagentId ?? explicitId ?? (byclawRole ? `byclaw-${byclawRole}` : undefined));
  if (!finalId) {
    return undefined;
  }
  const name = firstLooseTextValue(text, AGENT_NAME_KEYS) ?? (byclawRole ? `ByClaw ${byclawRole.replace(/-/gu, " ")}` : undefined);
  const byclawAgentId = firstLooseTextValue(text, ["byclawAgentId", "byclaw_agent_id"], { allowBareProse: true });
  const workflowStepId = firstLooseTextValue(text, ["workflowStepId", "workflow_step_id"], { allowBareProse: true });
  return {
    id: finalId,
    ...(name ? { name } : {}),
    source: "inferred_text",
    nativeSubagentId: finalId,
    ...(name ? { nativeSubagentName: name } : {}),
    ...(byclawAgentId ? { byclawAgentId } : {}),
    ...(role ? { role } : {}),
    ...(workflowStepId ? { workflowStepId } : {}),
    metadata: { inferredFrom: "event_text" },
  };
}

function resolveAgentIdentity(params: {
  binding?: AcpEnvelopeBinding;
  clientId: string;
  event: AcpEventLike;
}): AcpAgentIdentity {
  const data = isRecord(params.event.data) ? params.event.data : {};
  const explicitMarker = isStructuredAgentMarkerRecord(data) ? data : undefined;
  const textMarker = extractStructuredAgentMarker(resolveAcpEventText(params.event));
  const markerIdentity = agentIdentityFromMarker(explicitMarker ?? textMarker ?? {});
  if (markerIdentity) {
    return markerIdentity;
  }
  const inferredTextIdentity = inferredAgentIdentityFromText(resolveAcpEventText(params.event));
  if (inferredTextIdentity) {
    return inferredTextIdentity;
  }
  const eventAgentId = normalizeAgentId(firstString(data, AGENT_ID_KEYS) ?? params.event.agentId);
  if (eventAgentId) {
    return {
      id: eventAgentId,
      name: firstString(data, AGENT_NAME_KEYS),
      source: "event_field",
    };
  }
  const bindingAgentId = normalizeAgentId(params.binding?.agentId);
  if (bindingAgentId) {
    return {
      id: bindingAgentId,
      ...(params.binding?.agentName ? { name: params.binding.agentName } : {}),
      source: params.binding?.agentSource ?? "spawn_binding",
    };
  }
  return {
    id: normalizeAcpNameSegment(params.clientId, "acp"),
    source: "client_session",
  };
}

function resolveToolEnvelope(event: AcpEventLike): AcpToolEnvelope | undefined {
  if (!isAcpToolCallEvent(event)) {
    return undefined;
  }
  const data = isRecord(event.data) ? event.data : {};
  const title = acpString(data.title) ?? acpString(data.name) ?? acpString(data.toolName);
  const callId =
    acpString(data.toolCallId) ??
    acpString(data.id) ??
    `acp_${normalizeAcpNameSegment(event.runId, "run")}_${String(event.seq ?? 0)}`;
  const name = event.stream === "tool"
    ? acpString(data.name) ?? `acp.${normalizeAcpNameSegment(title, "tool")}`
    : `acp.${normalizeAcpNameSegment(title, "tool")}`;
  const status = acpString(data.status)?.toLowerCase();
  return {
    callId,
    name,
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    isError: /^(error|failed|failure)$/u.test(status ?? ""),
  };
}

function resolveSemanticType(event: AcpEventLike, tool: AcpToolEnvelope | undefined): string {
  if (tool) {
    return "tool_call";
  }
  if (event.stream === "assistant") {
    return "assistant";
  }
  if (event.stream === "system") {
    return "system";
  }
  if (event.stream === "lifecycle") {
    return "lifecycle";
  }
  const data = isRecord(event.data) ? event.data : {};
  const tag = acpString(data.tag);
  if (tag === "usage_update") {
    return "usage";
  }
  if (tag === "plan") {
    return "workflow_plan";
  }
  if (tag === "available_commands_update") {
    return "client_commands";
  }
  return event.stream || "event";
}

export function buildAcpAgentCallEnvelope(params: {
  event: AcpEventLike;
  binding?: AcpEnvelopeBinding;
}): AcpAgentCallEnvelope {
  const event = params.event;
  const data = isRecord(event.data) ? event.data : {};
  const childSessionKey = event.sessionKey;
  const clientId = acpClientIdFromSessionKey(childSessionKey);
  const tool = resolveToolEnvelope(event);
  const semanticType = resolveSemanticType(event, tool);
  const phase = resolveAcpToolPhase(event);
  const textPreview = truncateAcpText(resolveAcpEventText(event));
  const agent = resolveAgentIdentity({ binding: params.binding, clientId, event });
  const envelopeId = `acp:${acpStableId(
    params.binding?.parentRunId,
    event.runId,
    childSessionKey,
    event.stream,
    tool?.callId,
    event.seq,
  )}`;
  return {
    version: 1,
    protocol: "acp",
    direction: "child-to-parent",
    envelopeId,
    ...(params.binding?.parentEnvelopeId ? { parentEnvelopeId: params.binding.parentEnvelopeId } : {}),
    semanticType,
    phase,
    ...(event.stream ? { stream: event.stream } : {}),
    ...(event.seq !== undefined ? { seq: event.seq } : {}),
    ...(event.ts !== undefined ? { ts: event.ts } : {}),
    ...(params.binding?.parentSessionKey ? { parentSessionKey: params.binding.parentSessionKey } : {}),
    ...(params.binding?.parentSessionId ? { parentSessionId: params.binding.parentSessionId } : {}),
    ...(params.binding?.parentRunId ? { parentRunId: params.binding.parentRunId } : {}),
    ...(childSessionKey ? { childSessionKey } : {}),
    ...(event.sessionId ? { childSessionId: event.sessionId } : {}),
    ...(event.runId || params.binding?.childRunId ? { childRunId: event.runId ?? params.binding?.childRunId } : {}),
    clientId,
    agent,
    ...(tool ? { tool } : {}),
    ...(textPreview ? { textPreview } : {}),
    rawEvent: buildAcpRawEvent({ ...event, data }),
  };
}

export function acpToolObservationName(envelope: AcpAgentCallEnvelope): string {
  const agentDisplayName = acpDisplayNameSegment(
    envelope.agent.name ?? envelope.agent.nativeSubagentName,
    normalizeAcpNameSegment(envelope.agent.id, "agent"),
  );
  if (envelope.agent.source === "structured_marker") {
    return `byclaw.acp.agent.${agentDisplayName}.marker`;
  }
  if (envelope.tool?.name) {
    const toolName = normalizeAcpNameSegment(envelope.tool.name.replace(/^acp\./u, ""), "tool");
    if (
      envelope.agent.source === "active_context"
      || envelope.agent.source === "event_field"
      || envelope.agent.source === "inferred_text"
    ) {
      return `byclaw.acp.agent.${agentDisplayName}.tool.${toolName}`;
    }
    return `byclaw.acp.tool.${toolName}`;
  }
  if (envelope.semanticType === "assistant") {
    return `byclaw.acp.agent.${agentDisplayName}.assistant`;
  }
  if (envelope.semanticType === "lifecycle") {
    const phase = isRecord(envelope.rawEvent.data) ? acpString(envelope.rawEvent.data.phase) : undefined;
    return `byclaw.acp.client.${normalizeAcpNameSegment(phase, "lifecycle")}`;
  }
  return `byclaw.acp.client.${normalizeAcpNameSegment(envelope.semanticType, "event")}`;
}
