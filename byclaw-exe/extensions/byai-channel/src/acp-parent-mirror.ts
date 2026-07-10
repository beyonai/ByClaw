import type { OpenClawPluginApi } from "@openclaw/plugin-sdk/core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import type { ActiveSdkRequest } from "./session-context.js";
import type { AgentEvent } from "./types.js";
import {
  type AcpAgentIdentity,
  acpClientIdFromSessionKey,
  buildAcpAgentCallEnvelope,
  buildAcpRawEvent,
  extractAcpStructuredAgentMarkers,
  isAcpChildSessionKey as isSharedAcpChildSessionKey,
  isAcpToolCallEvent,
  resolveAcpToolPhase,
  sanitizeAcpVisibleText,
  stripAcpStructuredAgentMarkers,
  truncateAcpText,
} from "../../byclaw-acp-adapter/src/acp-common/envelope.js";

type AppendAssistantMirrorMessageByIdentity = (params: {
  agentId?: string;
  sessionKey: string;
  text?: string;
  idempotencyKey?: string;
  deliveryMirror?: Record<string, unknown>;
  updateMode?: "inline" | "file-only" | "none";
  config?: unknown;
}) => Promise<{ ok: boolean; reason?: string; code?: string }>;

type WithSessionTranscriptWriteLock = <T>(
  params: {
    agentId?: string;
    sessionKey: string;
    sessionId?: string;
    config?: unknown;
  },
  run: (context: {
    appendMessage: <TMessage>(options: {
      message: TMessage;
      idempotencyLookup?: "scan" | "caller-checked";
    }) => Promise<{ appended: boolean; messageId: string; message: TMessage } | undefined>;
    publishUpdate: (update?: Record<string, unknown>) => Promise<void>;
  }) => Promise<T> | T,
) => Promise<T>;

type TranscriptRuntime = {
  appendAssistantMirrorMessageByIdentity?: AppendAssistantMirrorMessageByIdentity;
  publishSessionTranscriptUpdateByIdentity?: (params: {
    agentId?: string;
    sessionKey: string;
    sessionId?: string;
    config?: unknown;
    update?: Record<string, unknown>;
  }) => Promise<void>;
  resolveSessionTranscriptLegacyFileTarget?: (params: {
    agentId?: string;
    sessionKey: string;
    sessionId?: string;
    config?: unknown;
  }) => Promise<{ sessionFile: string }>;
  withSessionTranscriptWriteLock?: WithSessionTranscriptWriteLock;
};

type AcpxToolUseMetadata = {
  id: string;
  input?: Record<string, unknown>;
  name?: string;
  rawInput?: string;
  sessionFile?: string;
};

type AcpxSessionMetadata = {
  bundle?: ByClawPlanBundleMetadata;
  file?: string;
  toolUsesById: Map<string, AcpxToolUseMetadata>;
};

type ByClawPlanBundleMetadata = {
  agents: Record<string, unknown>[];
  agentsByNativeSubagentId: Map<string, Record<string, unknown>>;
};

const assistantTextByRun = new Map<string, string>();
const assistantPendingMarkerByRun = new Map<string, string>();
const assistantDisplayTextByRun = new Map<string, string>();
const assistantDisplayPendingMarkerByRun = new Map<string, string>();
const agentMarkerPendingByRun = new Map<string, string>();
const activeAcpAgentByChildSession = new Map<string, AcpAgentIdentity>();
const runtimeAcpSessionMetadataByKey = new Map<string, AcpxSessionMetadata | null>();
const byclawPlanBundleMetadataByPath = new Map<string, ByClawPlanBundleMetadata | null>();
const acpToolStateByCall = new Map<string, {
  name?: string;
  title?: string;
  args?: Record<string, unknown>;
}>();
const nativeAcpToolTranscriptStarted = new Set<string>();
const nativeAcpAssistantTranscriptByKey = new Map<string, {
  idempotencyKey: string;
  message: Record<string, unknown>;
  messageId: string;
  text: string;
}>();
const pendingNativeAcpAssistantTextByKey = new Map<string, string>();
const acpDirectAnnounceCleanupTimers = new Map<string, NodeJS.Timeout[]>();
const MAX_TOOL_TEXT_CHARS = 600;
const ACP_PARENT_MIRROR_VERSION = 4;
const STRUCTURED_AGENT_MARKERS = [
  "BYCLAW_AGENT_EVENT",
  "ACP_AGENT_EVENT",
  "OPENCLAW_AGENT_EVENT",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parentAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const match = /^agent:([^:]+):/u.exec(sessionKey);
  return match?.[1];
}

function isAcpChildSessionKey(sessionKey: string | undefined): boolean {
  return isSharedAcpChildSessionKey(sessionKey);
}

function truncateText(text: string, maxChars = MAX_TOOL_TEXT_CHARS): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars - 1)}...`;
}

function normalizeNameSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized || fallback;
}

function stableAcpToolCallId(event: AgentEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const explicit = stringValue(data.toolCallId) || stringValue(data.id);
  if (explicit) {
    return explicit;
  }
  return `acp_${normalizeNameSegment(event.runId ?? "run", "run")}_${String(event.seq ?? 0)}`;
}

function acpToolStateKey(childSessionKey: string | undefined, toolCallId: string): string {
  return `${childSessionKey ?? "unknown"}:${toolCallId}`;
}

function runtimeAcpSessionCacheKey(params: {
  childSessionKey: string | undefined;
  runId: string | undefined;
}): string {
  return `${params.childSessionKey ?? "unknown"}:${params.runId ?? "unknown"}`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function encodedAcpxSessionPrefix(childSessionKey: string): string {
  return `${encodeURIComponent(childSessionKey)}%3Aoneshot%3A`;
}

function acpxSessionsDir(): string | undefined {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  return stateDir ? `${stateDir}/acpx/sessions` : undefined;
}

function findToolUseRecords(value: unknown, records: AcpxToolUseMetadata[] = []): AcpxToolUseMetadata[] {
  if (!value || typeof value !== "object") {
    return records;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      findToolUseRecords(item, records);
    }
    return records;
  }
  const record = value as Record<string, unknown>;
  const toolUse = isRecord(record.ToolUse) ? record.ToolUse : undefined;
  if (toolUse) {
    const id = stringValue(toolUse.id);
    if (id) {
      const input = isRecord(toolUse.input)
        ? toolUse.input
        : (typeof toolUse.raw_input === "string" && isRecord(safeJsonParse(toolUse.raw_input))
            ? safeJsonParse(toolUse.raw_input) as Record<string, unknown>
            : undefined);
      records.push({
        id,
        ...(input ? { input } : {}),
        ...(typeof toolUse.raw_input === "string" ? { rawInput: toolUse.raw_input } : {}),
        ...(typeof toolUse.name === "string" ? { name: toolUse.name } : {}),
      });
    }
  }
  for (const child of Object.values(record)) {
    findToolUseRecords(child, records);
  }
  return records;
}

function collectTextValues(value: unknown, texts: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return texts;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextValues(item, texts);
    }
    return texts;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.Text === "string") {
    texts.push(record.Text);
  }
  for (const child of Object.values(record)) {
    collectTextValues(child, texts);
  }
  return texts;
}

function extractPlanBundlePathFromAcpxSession(session: Record<string, unknown>): string | undefined {
  const texts = collectTextValues(session.messages);
  for (const text of texts) {
    const match = /plan\s+bundle\s*:\s*(\/[^\s`"'，。]+plan-bundle\.json)/iu.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  const toolUses = findToolUseRecords(session.messages);
  for (const toolUse of toolUses) {
    const filePath = stringValue(toolUse.input?.file_path) || stringValue(toolUse.input?.path);
    if (filePath.endsWith("/plan-bundle.json")) {
      return filePath;
    }
  }
  return undefined;
}

function loadByClawPlanBundleMetadata(bundlePath: string | undefined): ByClawPlanBundleMetadata | undefined {
  if (!bundlePath || !existsSync(bundlePath)) {
    return undefined;
  }
  if (byclawPlanBundleMetadataByPath.has(bundlePath)) {
    return byclawPlanBundleMetadataByPath.get(bundlePath) ?? undefined;
  }
  try {
    const bundle = safeJsonParse(readFileSync(bundlePath, "utf8"));
    const agentsByNativeSubagentId = new Map<string, Record<string, unknown>>();
    const agentModels = isRecord(bundle) && isRecord(bundle.agentModels) ? bundle.agentModels : {};
    const agents = Array.isArray(agentModels.agents) ? agentModels.agents.filter(isRecord) : [];
    for (const agent of agents) {
      const nativeSubagentId = stringValue(agent.nativeSubagentId);
      if (nativeSubagentId) {
        agentsByNativeSubagentId.set(nativeSubagentId, agent);
      }
    }
    const metadata = { agents, agentsByNativeSubagentId };
    byclawPlanBundleMetadataByPath.set(bundlePath, metadata);
    return metadata;
  } catch {
    byclawPlanBundleMetadataByPath.set(bundlePath, null);
    return undefined;
  }
}

function resolveRuntimeAcpSessionMetadata(params: {
  childSessionKey: string | undefined;
  runId: string | undefined;
}): AcpxSessionMetadata | undefined {
  if (!params.childSessionKey) {
    return undefined;
  }
  const cacheKey = runtimeAcpSessionCacheKey(params);
  const dir = acpxSessionsDir();
  if (!dir || !existsSync(dir)) {
    return undefined;
  }
  const prefix = encodedAcpxSessionPrefix(params.childSessionKey);
  const candidates = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const file = `${dir}/${name}`;
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { file, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let fallback: AcpxSessionMetadata | undefined;
  for (const candidate of candidates) {
    try {
      const session = safeJsonParse(readFileSync(candidate.file, "utf8"));
      if (!isRecord(session)) {
        continue;
      }
      const lastRequestId = stringValue(session.last_request_id);
      if (params.runId && lastRequestId && lastRequestId !== params.runId) {
        continue;
      }
      const toolUses = findToolUseRecords(session.messages)
        .map((toolUse) => ({ ...toolUse, sessionFile: candidate.file }));
      const toolUsesById = new Map(toolUses.map((toolUse) => [toolUse.id, toolUse]));
      const bundle = loadByClawPlanBundleMetadata(extractPlanBundlePathFromAcpxSession(session));
      const metadata = {
        ...(bundle ? { bundle } : {}),
        file: candidate.file,
        toolUsesById,
      };
      if (toolUsesById.size === 0) {
        fallback ??= metadata;
        continue;
      }
      runtimeAcpSessionMetadataByKey.set(cacheKey, metadata);
      return metadata;
    } catch {
      continue;
    }
  }
  if (fallback) {
    runtimeAcpSessionMetadataByKey.set(cacheKey, fallback);
    return fallback;
  }
  runtimeAcpSessionMetadataByKey.delete(cacheKey);
  return undefined;
}

function byclawAgentIdentityFromRuntime(params: {
  agentModel: Record<string, unknown> | undefined;
  subagentType: string;
  toolUse: AcpxToolUseMetadata;
  source?: AcpAgentIdentity["source"];
}): AcpAgentIdentity {
  const displayName =
    stringValue(params.agentModel?.displayName)
    || stringValue(params.agentModel?.nativeSubagentName)
    || params.subagentType;
  if (params.agentModel) {
    return {
      id: params.subagentType,
      name: displayName,
      source: params.source ?? "runtime_metadata",
      nativeSubagentId: params.subagentType,
      nativeSubagentName: stringValue(params.agentModel.nativeSubagentName) || displayName,
      ...(stringValue(params.agentModel.byclawAgentId) ? { byclawAgentId: stringValue(params.agentModel.byclawAgentId) } : {}),
      ...(stringValue(params.agentModel.role) ? { role: stringValue(params.agentModel.role) } : {}),
      metadata: {
        runtime: "acpx",
        toolUseId: params.toolUse.id,
        toolUseName: params.toolUse.name,
        subagentType: params.subagentType,
        model: stringValue(params.agentModel.model),
        baiyingModelId: stringValue(params.agentModel.baiyingModelId),
      },
    };
  }
  return {
      id: params.subagentType,
      name: params.subagentType,
    source: params.source ?? "runtime_metadata",
    nativeSubagentId: params.subagentType,
    nativeSubagentName: params.subagentType,
    metadata: {
      runtime: "acpx",
      toolUseId: params.toolUse.id,
      toolUseName: params.toolUse.name,
      subagentType: params.subagentType,
    },
  };
}

function isPlanBundleDefaultAgent(agent: Record<string, unknown>): boolean {
  const candidates = [
    stringValue(agent.kind),
    stringValue(agent.type),
    stringValue(agent.role),
    stringValue(agent.nativeSubagentId),
    stringValue(agent.nativeSubagentName),
    stringValue(agent.displayName),
    stringValue(agent.name),
  ].join(" ").toLowerCase();
  return /(?:orchestrator|team[-_\s]*lead|coordinator|leader|owner|entry|root)/u.test(candidates);
}

function resolvePlanBundleDefaultAcpAgentIdentity(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  source?: AcpAgentIdentity["source"];
}): AcpAgentIdentity | undefined {
  const runtime = resolveRuntimeAcpSessionMetadata({
    childSessionKey: params.childSessionKey,
    runId: params.event.runId,
  });
  const agentModel = runtime?.bundle?.agents.find(isPlanBundleDefaultAgent) ?? runtime?.bundle?.agents[0];
  const nativeSubagentId = stringValue(agentModel?.nativeSubagentId);
  if (!agentModel || !nativeSubagentId) {
    return undefined;
  }
  return byclawAgentIdentityFromRuntime({
    agentModel,
    subagentType: nativeSubagentId,
    toolUse: {
      id: stableAcpToolCallId(params.event),
      name: stringValue(isRecord(params.event.data) ? params.event.data.title : undefined),
    },
    source: params.source ?? "plan_bundle_default",
  });
}

function enrichAcpAgentIdentityFromPlanBundle(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  identity: AcpAgentIdentity;
}): AcpAgentIdentity {
  const runtime = resolveRuntimeAcpSessionMetadata({
    childSessionKey: params.childSessionKey,
    runId: params.event.runId,
  });
  const nativeSubagentId = params.identity.nativeSubagentId ?? params.identity.id;
  const agentModel = nativeSubagentId
    ? runtime?.bundle?.agentsByNativeSubagentId.get(nativeSubagentId)
    : undefined;
  if (!agentModel) {
    return params.identity;
  }
  const displayName =
    stringValue(agentModel.displayName)
    || stringValue(agentModel.nativeSubagentName)
    || params.identity.name
    || nativeSubagentId;
  return {
    ...params.identity,
    name: params.identity.name ?? displayName,
    nativeSubagentId,
    nativeSubagentName: params.identity.nativeSubagentName
      ?? stringValue(agentModel.nativeSubagentName)
      ?? displayName,
    byclawAgentId: (params.identity.byclawAgentId ?? stringValue(agentModel.byclawAgentId)) || undefined,
    role: (params.identity.role ?? stringValue(agentModel.role)) || undefined,
    metadata: {
      ...(params.identity.metadata ?? {}),
      planBundleDisplayName: displayName,
      model: stringValue(agentModel.model),
      baiyingModelId: stringValue(agentModel.baiyingModelId),
    },
  };
}

function shouldUsePlanBundleDefaultAgent(agent: AcpAgentIdentity): boolean {
  return agent.source === "client_session" || !agent.id || agent.id === agent.clientId;
}

function resolveRuntimeAcpAgentIdentity(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  toolCallId: string;
}): AcpAgentIdentity | undefined {
  const runtime = resolveRuntimeAcpSessionMetadata({
    childSessionKey: params.childSessionKey,
    runId: params.event.runId,
  });
  const toolUse = runtime?.toolUsesById.get(params.toolCallId);
  if (!toolUse) {
    return undefined;
  }
  const subagentType =
    stringValue(toolUse.input?.subagent_type)
    || stringValue(toolUse.input?.subagentType)
    || stringValue(toolUse.input?.agent_type)
    || stringValue(toolUse.input?.agentType);
  if (!subagentType) {
    return undefined;
  }
  return byclawAgentIdentityFromRuntime({
    agentModel: runtime?.bundle?.agentsByNativeSubagentId.get(subagentType),
    subagentType,
    toolUse,
  });
}

function resolveLiveAcpRuntimeAgentIdentity(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  toolCallId: string;
}): AcpAgentIdentity | undefined {
  const data = isRecord(params.event.data) ? params.event.data : {};
  const text = [
    stringValue(data.text),
    stringValue(data.delta),
    stringValue(data.title),
  ].filter(Boolean).join("\n");
  const subagentType =
    /(?:^|[\s,{])subagent_type\s*[:=]\s*["'`]?([a-z0-9._-]+)/iu.exec(text)?.[1]
    || /(?:^|[\s,{])subagentType\s*[:=]\s*["'`]?([a-z0-9._-]+)/iu.exec(text)?.[1];
  if (!subagentType) {
    return undefined;
  }
  const runtime = resolveRuntimeAcpSessionMetadata({
    childSessionKey: params.childSessionKey,
    runId: params.event.runId,
  });
  const bundleAgent = runtime?.bundle?.agentsByNativeSubagentId.get(subagentType);
  if (bundleAgent) {
    return byclawAgentIdentityFromRuntime({
      agentModel: bundleAgent,
      subagentType,
      toolUse: {
        id: params.toolCallId,
        name: stringValue(data.title) || stringValue(data.name),
      },
    });
  }
  const byclawAgentId = /(?:^|[\s,{])byclawAgentId\s*[:=]\s*["'`]?([0-9]+)/iu.exec(text)?.[1];
  const role =
    /(?:^|[\s,{])role\s*[:=]\s*["'`]?([a-z0-9._-]+)/iu.exec(text)?.[1]
    || /(?:^|[\s,{])role\s+["'`]?([a-z0-9._-]+)/iu.exec(text)?.[1];
  const displayName = subagentType.startsWith("byclaw-")
    ? `ByClaw ${subagentType.slice("byclaw-".length).replace(/-/gu, " ")}`
    : subagentType;
  return {
    id: subagentType,
    name: displayName,
    source: "runtime_metadata",
    nativeSubagentId: subagentType,
    nativeSubagentName: displayName,
    ...(byclawAgentId ? { byclawAgentId } : {}),
    ...(role ? { role } : {}),
    metadata: {
      runtime: "acp-live",
      toolUseId: params.toolCallId,
      subagentType,
    },
  };
}


function isGenericAcpToolName(value: string | undefined): boolean {
  return !value || /^acp\.(?:tool|tool_call|tool_call_update)$/u.test(value);
}

function isGenericAcpToolTitle(value: string | undefined): boolean {
  return !value || /^(?:tool|tool call|tool_call|tool_call_update)$/iu.test(value.trim());
}

function isAcpTaskToolName(value: string | undefined): boolean {
  return /^(?:task|acp\.task)$/iu.test(value?.trim() ?? "");
}

function cleanAcpToolOutputText(text: string): string {
  const withoutToolPrefix = text
    .replace(/^\s*tool\s+call\s*\((?:completed|failed|error)\)\s*:\s*/iu, "")
    .replace(/^\s*tool\s+call\s*:\s*/iu, "")
    .replace(/\s+\(pending\)(?::.*)?$/iu, "")
    .trim();
  const withoutMarkers = stripAcpStructuredAgentMarkers(withoutToolPrefix) ?? withoutToolPrefix;
  const markerFragment = stripStructuredAgentMarkerFragments(withoutMarkers);
  const cleaned = (sanitizeAcpVisibleText(markerFragment.text) ?? markerFragment.text).trim();
  if (/^```(?:console|text|bash|sh)?\s*(?:`{1,3})?$/iu.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function unwrapAcpStructuredText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|text|markdown)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
}

function parseAcpStructuredJson(text: string): unknown {
  const value = unwrapAcpStructuredText(cleanAcpToolOutputText(text));
  if (!value || value.length > 20_000) {
    return undefined;
  }
  for (const candidate of [
    value,
    value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1),
  ]) {
    if (!candidate || candidate[0] !== "{") {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through to the next candidate.
    }
  }
  return undefined;
}

function acpStructuredTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => acpStructuredTextValue(entry))
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function formatAcpTaskAssistantOutput(text: string): string {
  const cleaned = cleanAcpToolOutputText(text);
  const parsed = parseAcpStructuredJson(cleaned);
  if (!isRecord(parsed)) {
    return cleaned;
  }
  const rows: string[] = [];
  const fieldLabels: Array<[string, string]> = [
    ["workflowStepId", "workflowStepId"],
    ["verdict", "verdict"],
    ["summary", "summary"],
    ["scope", "scope"],
    ["evidence", "evidence"],
    ["proof", "proof"],
    ["result", "result"],
    ["risks", "risks"],
    ["next_action", "next_action"],
    ["nextAction", "next_action"],
    ["recommendation", "recommendation"],
    ["message", "message"],
  ];
  for (const [key, label] of fieldLabels) {
    const value = acpStructuredTextValue(parsed[key]);
    if (value) {
      rows.push(`${label}: ${value}`);
    }
  }
  return rows.join("\n").trim();
}

function cleanAcpToolTitle(text: string): string {
  return truncateText(cleanAcpToolOutputText(text), 240);
}

function isMeaningfulAcpToolInput(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) {
    return false;
  }
  if (isAcpStructuredAgentMarkerToolText(value)) {
    return false;
  }
  if (/^(?:tool|tool call|tool_call|tool_call_update)$/iu.test(value)) {
    return false;
  }
  if (/^[\w .:/-]+\s+\(pending\)$/iu.test(value)) {
    return false;
  }
  return true;
}

function isAcpStructuredAgentMarkerToolText(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) {
    return false;
  }
  if (!STRUCTURED_AGENT_MARKERS.some((marker) => value.includes(marker))) {
    return false;
  }
  const normalized = value
    .replace(/^\s*tool\s+call\s*\((?:completed|failed|error)\)\s*:\s*/iu, "")
    .replace(/^```(?:console|text|bash|sh)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .replace(/\s+\(pending\):[\s\S]*$/iu, "")
    .trim();
  const withoutShellWrapper = normalized
    .replace(/^echo\s+['"`]?/iu, "")
    .replace(/['"`]?\s*(?:\|\s*cat)?\s*$/iu, "")
    .trim();
  if (
    /^(?:BYCLAW_AGENT_EVENT|ACP_AGENT_EVENT|OPENCLAW_AGENT_EVENT)\s*\{[\s\S]*\}$/u.test(withoutShellWrapper)
  ) {
    return true;
  }
  const withoutMarkers = stripAcpStructuredAgentMarkers(withoutShellWrapper);
  const visible = sanitizeAcpVisibleText(withoutMarkers ?? withoutShellWrapper)?.trim() ?? "";
  return !visible || visible === withoutShellWrapper;
}

function isMeaningfulAcpTaskAssistantOutput(text: string | undefined): boolean {
  const value = cleanAcpToolOutputText(text ?? "");
  if (!value) {
    return false;
  }
  if (/^```(?:console|text|bash|sh)?\s*$/iu.test(value)) {
    return false;
  }
  if (/^(?:tool|tool call|task)\s*$/iu.test(value)) {
    return false;
  }
  if (/^\s*(?:\{[\s\S]*\}|\[[\s\S]*\])\s*$/u.test(value) && value.length < 240) {
    return false;
  }
  return /[\p{Script=Han}A-Za-z]/u.test(value);
}

function isBarePendingAcpToolLabel(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) {
    return true;
  }
  if (/^(?:terminal|grep|find|read file|read|tool|tool call|todowrite|task)$/iu.test(value)) {
    return true;
  }
  if (/^[a-z][a-z0-9 _-]{0,32}$/iu.test(value) && !/[./"'`:$]/u.test(value)) {
    return true;
  }
  return false;
}

function resolveAcpToolName(event: AgentEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const title = stringValue(data.title) || stringValue(data.name) || stringValue(data.toolName);
  return `acp.${normalizeNameSegment(title || "tool", "tool")}`;
}

function stripPendingSuffix(text: string): string {
  return text
    .replace(/\s+\(pending\)(?::.*)?$/iu, "")
    .trim();
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function inferPathFromReadText(text: string): string {
  const value = stripPendingSuffix(text);
  const match = /^(?:read\s+file|read)\s+(.+)$/iu.exec(value);
  return match?.[1]?.trim() ?? "";
}

function inferShellCommand(text: string): string {
  const value = stripPendingSuffix(text)
    .replace(/^terminal\s*:?\s*/iu, "")
    .trim();
  if (!value) {
    return "";
  }
  const commandPrefix = /^(?:\.{0,2}\/|~\/|[a-z_][\w.-]*(?:\s|$)|cd\s|ls\s|cat\s|grep\s|rg\s|find\s|head\s|tail\s|sed\s|awk\s|git\s|npm\s|pnpm\s|node\s|shasum\s|wc\s|test\s|\[)/iu;
  if (!commandPrefix.test(value)) {
    return "";
  }
  return value;
}

function resolveAcpOpenClawToolDisplay(params: {
  eventName: string;
  title: string;
  inputText: string;
}): { name: string; title?: string; path?: string; command?: string } {
  const title = params.title.trim();
  const inputText = params.inputText.trim();
  const label = firstNonEmpty(inputText, title, params.eventName);
  const readPath = inferPathFromReadText(label) || inferPathFromReadText(title);
  if (readPath) {
    return {
      name: "read",
      title: title || `Read ${readPath}`,
      path: readPath,
    };
  }
  if (/^task\b/iu.test(title) || /^task\b/iu.test(inputText)) {
    return {
      name: "task",
      title: title || inputText || "Task",
    };
  }
  const command = inferShellCommand(inputText) || inferShellCommand(title);
  if (command) {
    return {
      name: "bash",
      title: title || command,
      command,
    };
  }
  if (params.eventName && !isGenericAcpToolName(params.eventName)) {
    return {
      name: params.eventName,
      ...(title ? { title } : {}),
    };
  }
  return {
    name: "tool",
    ...(title ? { title } : {}),
  };
}

function isAcpThinkingEvent(event: AgentEvent): boolean {
  if (event.stream === "thinking") {
    return true;
  }
  const data = isRecord(event.data) ? event.data : {};
  const marker = [
    event.type,
    data.type,
    data.eventType,
    data.tag,
    data.phase,
    data.stream,
  ]
    .map((value) => stringValue(value).toLowerCase())
    .find(Boolean);
  return Boolean(marker && /^(?:thinking|thinking_delta|thinking\.delta|reasoning|reasoning_delta|reasoning\.delta|analysis|commentary)$/u.test(marker));
}

export function buildAcpOpenClawThinkingEvent(event: AgentEvent): AgentEvent | undefined {
  if (!isAcpThinkingEvent(event) || isAcpToolEvent(event)) {
    return undefined;
  }
  const data = isRecord(event.data) ? event.data : {};
  const text =
    sanitizeAcpVisibleText(
      stringValue(data.delta)
      || stringValue(data.text)
      || stringValue(data.thinking)
      || stringValue(data.reasoning)
      || stringValue(data.content),
    ) ?? "";
  if (!text.trim()) {
    return undefined;
  }
  return {
    ...event,
    stream: "thinking",
    type: event.type ?? "thinking.delta",
    data: {
      ...data,
      delta: text,
      text,
      phase: "reasoning",
      acp: buildRawAcpEvent(event),
    },
  };
}

function resolveAcpAgentIdentity(params: {
  clientId: string;
  event: AgentEvent;
}): Record<string, unknown> {
  const data = isRecord(params.event.data) ? params.event.data : {};
  const explicitAgentId =
    stringValue(data.agentId)
    || stringValue(data.agent_id)
    || stringValue(data.subagentId)
    || stringValue(data.subAgentId)
    || stringValue(data.role)
    || stringValue(data.worker)
    || stringValue(params.event.agentId);
  const explicitAgentName =
    stringValue(data.agentName)
    || stringValue(data.agent_name)
    || stringValue(data.subagentName)
    || stringValue(data.subAgentName)
    || stringValue(data.roleName)
    || stringValue(data.workerName);
  return {
    clientId: params.clientId,
    ...(explicitAgentId ? { agentId: explicitAgentId } : {}),
    ...(explicitAgentName ? { agentName: explicitAgentName } : {}),
  };
}

function resolveAssistantDeltaWithState(
  event: AgentEvent,
  textByRun: Map<string, string>,
  pendingMarkerByRun: Map<string, string>,
): string {
  const data = isRecord(event.data) ? event.data : {};
  const text = stringValue(data.text);
  const key = `${event.sessionKey ?? ""}:${event.runId ?? ""}:assistant`;
  if (text) {
    const visibleText = stripStructuredAgentMarkersForVisibleText(key, text, { cumulative: true }, pendingMarkerByRun);
    const previous = textByRun.get(key) ?? "";
    textByRun.set(key, visibleText);
    if (previous && visibleText.startsWith(previous)) {
      return visibleText.slice(previous.length);
    }
    return visibleText;
  }
  const delta = stripStructuredAgentMarkersForVisibleText(key, stringValue(data.delta), { cumulative: false }, pendingMarkerByRun);
  if (!delta) {
    return "";
  }
  const previous = textByRun.get(key) ?? "";
  const visibleText = `${previous}${delta}`;
  textByRun.set(key, visibleText);
  return delta;
}

function resolveAssistantDelta(event: AgentEvent): string {
  return resolveAssistantDeltaWithState(event, assistantTextByRun, assistantPendingMarkerByRun);
}

function stripStructuredAgentMarkerFragments(text: string): { text: string; pending: string } {
  const markerRe = /(?:BYCLAW_AGENT_EVENT|ACP_AGENT_EVENT|OPENCLAW_AGENT_EVENT)\s*/gu;
  const matches = Array.from(text.matchAll(markerRe));
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const index = last.index ?? -1;
    if (index >= 0) {
      const markerStart = index > 0 && text[index - 1] === "`" ? index - 1 : index;
      const candidate = text.slice(markerStart);
      if (isStructuredAgentMarkerTailFragment(candidate)) {
        return {
          text: text.slice(0, markerStart),
          pending: candidate,
        };
      }
    }
  }
  const maxPrefixLength = Math.min(
    text.length,
    Math.max(...STRUCTURED_AGENT_MARKERS.map((marker) => marker.length)) - 1,
  );
  for (let length = maxPrefixLength; length > 0; length -= 1) {
    const suffix = text.slice(-length);
    if (STRUCTURED_AGENT_MARKERS.some((marker) => marker.startsWith(suffix))) {
      const markerStart = text.length - length;
      const pendingStart = markerStart > 0 && text[markerStart - 1] === "`"
        ? markerStart - 1
        : markerStart;
      return {
        text: text.slice(0, pendingStart),
        pending: text.slice(pendingStart),
      };
    }
  }
  return { text, pending: "" };
}

function isStructuredAgentMarkerTailFragment(fragment: string): boolean {
  let rest = fragment.trimStart();
  if (!rest) {
    return false;
  }
  if (rest.startsWith("`")) {
    rest = rest.slice(1).trimStart();
  }
  const marker = STRUCTURED_AGENT_MARKERS.find((item) => rest.startsWith(item));
  if (!marker) {
    return STRUCTURED_AGENT_MARKERS.some((item) => item.startsWith(rest));
  }
  rest = rest.slice(marker.length).trimStart();
  if (!rest) {
    return true;
  }
  if (!rest.startsWith("{")) {
    return false;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of rest) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") {
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
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === "`") {
      return false;
    }
    if (/[\s:[\],0-9_.-]/u.test(char)) {
      continue;
    }
    return false;
  }
  return depth > 0 || inString || rest.length > 0;
}

function stripStructuredAgentMarkersForVisibleText(
  key: string,
  text: string,
  options: { cumulative: boolean },
  pendingMarkerByRun = assistantPendingMarkerByRun,
): string {
  const pending = pendingMarkerByRun.get(key) ?? "";
  let source = options.cumulative ? text : `${pending}${text}`;
  if (!options.cumulative && pending) {
    const strippedCombined = stripAcpStructuredAgentMarkers(source) ?? "";
    const hasCompleteMarker = strippedCombined !== source;
    if (!hasCompleteMarker && !isStructuredAgentMarkerTailFragment(source)) {
      pendingMarkerByRun.delete(key);
      source = text;
    }
  }
  const stripped = stripAcpStructuredAgentMarkers(source) ?? "";
  const fragment = stripStructuredAgentMarkerFragments(stripped);
  if (fragment.pending) {
    pendingMarkerByRun.set(key, fragment.pending);
  } else {
    pendingMarkerByRun.delete(key);
  }
  return sanitizeAcpVisibleText(fragment.text) ?? "";
}

export function buildAcpOpenClawAssistantEvent(event: AgentEvent): AgentEvent | undefined {
  if (!isAcpChildSessionKey(event.sessionKey) || event.stream !== "assistant") {
    return undefined;
  }
  const data = isRecord(event.data) ? event.data : {};
  const text = resolveAssistantDeltaWithState(
    event,
    assistantDisplayTextByRun,
    assistantDisplayPendingMarkerByRun,
  );
  return {
    ...event,
    stream: "assistant",
    data: {
      ...data,
      delta: text,
      text,
      acp: buildRawAcpEvent(event),
    },
  };
}

function isAcpToolEvent(event: AgentEvent): boolean {
  return isAcpToolCallEvent(event);
}

function resolveOpenClawToolPhase(event: AgentEvent): "start" | "update" | "result" {
  const phase = resolveAcpToolPhase(event);
  return phase === "event" ? "update" : phase;
}

function updateActiveAcpAgent(childSessionKey: string | undefined, identity: AcpAgentIdentity) {
  if (!childSessionKey) {
    return;
  }
  const clientId = acpClientIdFromSessionKey(childSessionKey);
  const isExplicitRemoteAgent = identity.source === "event_field" && identity.id !== clientId;
  if (
    identity.source !== "structured_marker"
    && identity.source !== "inferred_text"
    && identity.source !== "runtime_metadata"
    && identity.source !== "plan_bundle_default"
    && !isExplicitRemoteAgent
  ) {
    return;
  }
  activeAcpAgentByChildSession.set(childSessionKey, {
    ...identity,
    source: "active_context",
  });
}

function enrichAcpAgentIdentity(base: AcpAgentIdentity, active: AcpAgentIdentity | undefined): AcpAgentIdentity {
  if (!active) {
    return base;
  }
  const sameAgent =
    active.id === base.id ||
    active.nativeSubagentId === base.id ||
    base.nativeSubagentId === active.id;
  if (!sameAgent) {
    return base;
  }
  return {
    ...active,
    ...base,
    name: base.name ?? active.name,
    nativeSubagentId: base.nativeSubagentId ?? active.nativeSubagentId,
    nativeSubagentName: base.nativeSubagentName ?? active.nativeSubagentName,
    byclawAgentId: base.byclawAgentId ?? active.byclawAgentId,
    role: base.role ?? active.role,
    phase: base.phase ?? active.phase,
    workflowStepId: base.workflowStepId ?? active.workflowStepId,
    metadata: {
      ...(active.metadata ?? {}),
      ...(base.metadata ?? {}),
    },
  };
}

function maybeClearAcpAgentContext(event: AgentEvent, childSessionKey: string | undefined) {
  if (!childSessionKey || event.stream !== "lifecycle") {
    return;
  }
  const data = isRecord(event.data) ? event.data : {};
  const phase = stringValue(data.phase).toLowerCase();
  if (phase === "end" || phase === "error") {
    activeAcpAgentByChildSession.delete(childSessionKey);
    for (const key of Array.from(agentMarkerPendingByRun.keys())) {
      if (key.startsWith(`${childSessionKey}:`)) {
        agentMarkerPendingByRun.delete(key);
      }
    }
    for (const key of Array.from(pendingNativeAcpAssistantTextByKey.keys())) {
      if (key.startsWith(`${childSessionKey}:`)) {
        pendingNativeAcpAssistantTextByKey.delete(key);
      }
    }
    for (const key of Array.from(nativeAcpAssistantTranscriptByKey.keys())) {
      if (key.startsWith(`${childSessionKey}:`)) {
        nativeAcpAssistantTranscriptByKey.delete(key);
      }
    }
  }
}

function observeAcpStructuredAgentMarkers(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
}) {
  if (!params.childSessionKey) {
    return;
  }
  const data = isRecord(params.event.data) ? params.event.data : {};
  const eventText =
    stringValue(data.delta)
    || stringValue(data.text)
    || stringValue(data.content)
    || stringValue(data.message)
    || stringValue(data.summary)
    || stringValue(data.title)
    || stringValue(data.error);
  if (!eventText) {
    return;
  }
  const key = `${params.childSessionKey}:${params.event.runId ?? ""}:agent-markers`;
  const source = `${agentMarkerPendingByRun.get(key) ?? ""}${eventText}`;
  for (const marker of extractAcpStructuredAgentMarkers(source)) {
    updateActiveAcpAgent(params.childSessionKey, marker.identity);
  }
  const stripped = stripAcpStructuredAgentMarkers(source) ?? source;
  const fragment = stripStructuredAgentMarkerFragments(stripped);
  if (fragment.pending) {
    agentMarkerPendingByRun.set(key, fragment.pending);
  } else {
    agentMarkerPendingByRun.delete(key);
  }
}

function extractAcpToolResult(event: AgentEvent): Record<string, unknown> {
  const data = isRecord(event.data) ? event.data : {};
  const text = truncateText(cleanAcpToolOutputText(stringValue(data.text) || stringValue(data.delta)), 4000);
  const toolCallId = stableAcpToolCallId(event);
  const activeAgent = activeAcpAgentByChildSession.get(event.sessionKey ?? "");
  const runtimeAgent = resolveRuntimeAcpAgentIdentity({
    childSessionKey: event.sessionKey,
    event,
    toolCallId,
  }) ?? resolveLiveAcpRuntimeAgentIdentity({
    childSessionKey: event.sessionKey,
    event,
    toolCallId,
  });
  const envelope = buildAcpAgentCallEnvelope({
    event,
    binding: runtimeAgent
      ? {
          agentId: runtimeAgent.id,
          agentName: runtimeAgent.name,
          agentSource: runtimeAgent.source,
        }
      : activeAgent
      ? {
          agentId: activeAgent.id,
          agentName: activeAgent.name,
          agentSource: activeAgent.source,
        }
      : undefined,
  });
  const fallbackAgent = !runtimeAgent && !activeAgent && shouldUsePlanBundleDefaultAgent(envelope.agent)
    ? resolvePlanBundleDefaultAcpAgentIdentity({
        childSessionKey: event.sessionKey,
        event,
      })
    : undefined;
  const rawAgent = runtimeAgent ?? fallbackAgent ?? enrichAcpAgentIdentity(envelope.agent, activeAgent);
  const enrichedAgent = enrichAcpAgentIdentityFromPlanBundle({
    childSessionKey: event.sessionKey,
    event,
    identity: rawAgent,
  });
  if (runtimeAgent || fallbackAgent) {
    updateActiveAcpAgent(event.sessionKey, enrichedAgent);
  }
  const enrichedEnvelope = { ...envelope, agent: enrichedAgent };
  return {
    content: text ? [{ type: "text", text }] : [],
    details: {
      acp: buildRawAcpEvent(event),
      agent: enrichedAgent,
      acpEnvelope: enrichedEnvelope,
    },
  };
}

export function buildAcpOpenClawToolEvent(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  parentSessionId?: string;
  parentSessionKey: string;
}): AgentEvent | undefined {
  if (!isAcpChildSessionKey(params.childSessionKey) || !isAcpToolEvent(params.event)) {
    return undefined;
  }
  const toolCallId = stableAcpToolCallId(params.event);
  const runtimeAgent = resolveRuntimeAcpAgentIdentity({
    childSessionKey: params.childSessionKey,
    event: params.event,
    toolCallId,
  }) ?? resolveLiveAcpRuntimeAgentIdentity({
    childSessionKey: params.childSessionKey,
    event: params.event,
    toolCallId,
  });
  const activeContextAgent = activeAcpAgentByChildSession.get(params.childSessionKey ?? "");
  const activeAgent = runtimeAgent ?? activeContextAgent;
  const envelope = buildAcpAgentCallEnvelope({
    event: params.event,
    binding: {
      parentSessionKey: params.parentSessionKey,
      parentSessionId: params.parentSessionId,
      parentRunId: params.event.runId,
      agentId: activeAgent?.id,
      agentName: activeAgent?.name,
      agentSource: activeAgent?.source,
    },
  });
  const fallbackAgent = !runtimeAgent && !activeContextAgent && shouldUsePlanBundleDefaultAgent(envelope.agent)
    ? resolvePlanBundleDefaultAcpAgentIdentity({
        childSessionKey: params.childSessionKey,
        event: params.event,
      })
    : undefined;
  const rawAgent = runtimeAgent
    ?? fallbackAgent
    ?? enrichAcpAgentIdentity(envelope.agent, activeAcpAgentByChildSession.get(params.childSessionKey ?? ""));
  const agent = enrichAcpAgentIdentityFromPlanBundle({
    childSessionKey: params.childSessionKey,
    event: params.event,
    identity: rawAgent,
  });
  updateActiveAcpAgent(params.childSessionKey, agent);
  const enrichedEnvelope = { ...envelope, agent };
  const phase = envelope.phase === "event" ? "update" : envelope.phase;
  const data = isRecord(params.event.data) ? params.event.data : {};
  const resolvedToolCallId = envelope.tool?.callId ?? toolCallId;
  const stateKey = acpToolStateKey(params.childSessionKey, resolvedToolCallId);
  const previous = acpToolStateByCall.get(stateKey);
  const eventName = envelope.tool?.name ?? resolveAcpToolName(params.event);
  const rawEventTitle = stringValue(data.title) || envelope.tool?.title;
  const eventTitle = cleanAcpToolTitle(rawEventTitle ?? "");
  const title = isGenericAcpToolTitle(eventTitle) && previous?.title ? previous.title : eventTitle;
  const text = truncateText(cleanAcpToolOutputText(stringValue(data.text) || stringValue(data.delta)));
  const status = stringValue(data.status).toLowerCase();
  const pendingBareToolLabel = status === "pending"
    && isBarePendingAcpToolLabel(text)
    && isBarePendingAcpToolLabel(title);
  const inputText = pendingBareToolLabel
    ? ""
    : isMeaningfulAcpToolInput(text)
    ? text
    : (isMeaningfulAcpToolInput(title) ? title : "");
  const display = resolveAcpOpenClawToolDisplay({
    eventName,
    title,
    inputText,
  });
  const name = previous?.name && phase !== "start"
    ? previous.name
    : (isGenericAcpToolName(display.name) && previous?.name ? previous.name : display.name);
  const isError = envelope.tool?.isError ?? /^(error|failed|failure)$/u.test(status);
  const args = {
    protocol: "acp",
    clientId: envelope.clientId,
    agentId: agent.id,
    ...(agent.name ? { agentName: agent.name } : {}),
    agentSource: agent.source,
    ...(agent.nativeSubagentId ? { nativeSubagentId: agent.nativeSubagentId } : {}),
    ...(agent.nativeSubagentName ? { nativeSubagentName: agent.nativeSubagentName } : {}),
    ...(agent.byclawAgentId ? { byclawAgentId: agent.byclawAgentId } : {}),
    ...(agent.role ? { role: agent.role } : {}),
    ...(agent.phase ? { agentPhase: agent.phase } : {}),
    ...(agent.workflowStepId ? { workflowStepId: agent.workflowStepId } : {}),
    childSessionKey: params.childSessionKey,
    runId: params.event.runId,
    ...(display.title || title ? { title: display.title || title } : {}),
    ...(display.path ? { path: display.path } : {}),
    ...(display.command ? { command: display.command } : {}),
    ...(inputText && phase !== "result" ? { input: inputText, preview: inputText } : {}),
    agent,
    envelopeId: envelope.envelopeId,
  };
  if (phase === "start" || phase === "update") {
    acpToolStateByCall.set(stateKey, {
      name: isGenericAcpToolName(name) ? previous?.name : name,
      title: isGenericAcpToolTitle(display.title || title) ? previous?.title : (display.title || title),
      args: { ...(previous?.args ?? {}), ...args },
    });
    while (acpToolStateByCall.size > 1024) {
      const first = acpToolStateByCall.keys().next().value;
      if (!first) {
        break;
      }
      acpToolStateByCall.delete(first);
    }
  }
  const resolvedArgs = phase === "result" ? (previous?.args ?? args) : args;
  return {
    seq: params.event.seq,
    stream: "tool",
    type: params.event.type,
    runId: params.event.runId,
    ts: params.event.ts,
    sessionKey: params.parentSessionKey,
    sessionId: params.parentSessionId ?? params.event.sessionId,
    agentId: parentAgentIdFromSessionKey(params.parentSessionKey),
    data: {
      phase,
    toolCallId: resolvedToolCallId,
      name,
      args: resolvedArgs,
      ...(phase === "update" ? { partialResult: extractAcpToolResult(params.event) } : {}),
      ...(phase === "result" ? { result: extractAcpToolResult(params.event), isError } : {}),
      acp: buildRawAcpEvent(params.event),
      acpEnvelope: enrichedEnvelope,
    },
  };
}

function rememberAcpAgentContext(params: {
  childSessionKey: string | undefined;
  event: AgentEvent;
  parentSessionId?: string;
  parentSessionKey: string;
}) {
  const activeAgent = activeAcpAgentByChildSession.get(params.childSessionKey ?? "");
  const envelope = buildAcpAgentCallEnvelope({
    event: params.event,
    binding: {
      parentSessionKey: params.parentSessionKey,
      parentSessionId: params.parentSessionId,
      parentRunId: params.event.runId,
      agentId: activeAgent?.id,
      agentName: activeAgent?.name,
      agentSource: activeAgent?.source,
    },
  });
  updateActiveAcpAgent(params.childSessionKey, envelope.agent);
}

function resolveAcpToolMirrorText(event: AgentEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const tag = stringValue(data.tag);
  const eventType = stringValue(data.eventType);
  const status = stringValue(data.status);
  if (!tag.includes("tool_call") && eventType !== "tool_call") {
    return "";
  }
  if (!status && !stringValue(data.text) && !stringValue(data.delta)) {
    return "";
  }
  const toolCallId = stableAcpToolCallId(event);
  const previous = acpToolStateByCall.get(acpToolStateKey(event.sessionKey, toolCallId));
  const phase = resolveOpenClawToolPhase(event);
  const activeAgent = activeAcpAgentByChildSession.get(event.sessionKey ?? "");
  const agentLabel = activeAgent?.name || activeAgent?.id || acpClientIdFromSessionKey(event.sessionKey ?? "") || "acp-client";
  const eventTitle = cleanAcpToolTitle(stringValue(data.title));
  const eventName = resolveAcpToolName(event);
  const toolLabel = previous?.title || (!isGenericAcpToolTitle(eventTitle) ? eventTitle : undefined) || previous?.name || eventName;
  const statusLabel =
    phase === "start"
      ? "started"
      : phase === "result"
        ? (/^(?:error|failed|failure)$/iu.test(status) ? "failed" : "completed")
        : "updated";
  return `${agentLabel} tool ${toolLabel} ${statusLabel}`;
}

function resolveAcpRuntimeMirrorText(event: AgentEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const tag = stringValue(data.tag);
  const phase = stringValue(data.phase);
  if (buildAcpOpenClawThinkingEvent(event)) {
    return "";
  }
  if (
    tag === "usage_update"
    || tag === "available_commands_update"
    || phase === "prompt_submitted"
  ) {
    return "";
  }
  const toolText = resolveAcpToolMirrorText(event);
  if (toolText) {
    return toolText;
  }

  const eventType = stringValue(data.eventType);
  const status = stringValue(data.status);
  const title = stringValue(data.title);
  const label = eventType || phase || tag || event.stream || event.type || "event";
  const qualifier = title || tag || status;
  const text = truncateText(stringValue(data.text) || stringValue(data.delta));
  return `ACP ${label}${qualifier ? ` ${qualifier}` : ""}${text ? `: ${text}` : ""}`;
}

function resolveAcpLifecycleMirrorText(event: AgentEvent): string {
  if (event.stream !== "lifecycle") {
    return "";
  }
  const data = isRecord(event.data) ? event.data : {};
  const phase = stringValue(data.phase);
  if (phase !== "start" && phase !== "end" && phase !== "error") {
    return "";
  }
  return `ACP client ${phase}`;
}

function resolveMirrorText(event: AgentEvent): string {
  if (event.stream === "assistant") {
    return sanitizeAcpVisibleText(resolveAssistantDelta(event)) ?? "";
  }
  if (event.stream === "acp") {
    return resolveAcpRuntimeMirrorText(event);
  }
  const lifecycleText = resolveAcpLifecycleMirrorText(event);
  if (lifecycleText) {
    return lifecycleText;
  }
  const data = isRecord(event.data) ? event.data : {};
  const text = truncateText(
    stringValue(data.text)
    || stringValue(data.delta)
    || stringValue(data.phase)
    || stringValue(event.type)
    || event.stream,
  );
  return `ACP ${event.stream || event.type || "event"}${text ? ` ${text}` : ""}`;
}

function buildRawAcpEvent(event: AgentEvent): Record<string, unknown> {
  return buildAcpRawEvent(event);
}

function buildAcpDeliveryMirror(params: {
  childSessionKey: string | undefined;
  clientId: string;
  event: AgentEvent;
  parentSessionKey: string;
  summaryText: string;
}): Record<string, unknown> {
  const data = isRecord(params.event.data) ? params.event.data : {};
  const toolCallId = isAcpToolEvent(params.event) ? stableAcpToolCallId(params.event) : undefined;
  const runtimeAgent = toolCallId
    ? resolveRuntimeAcpAgentIdentity({
        childSessionKey: params.childSessionKey,
        event: params.event,
        toolCallId,
      }) ?? resolveLiveAcpRuntimeAgentIdentity({
        childSessionKey: params.childSessionKey,
        event: params.event,
        toolCallId,
      })
    : undefined;
  const activeContextAgent = activeAcpAgentByChildSession.get(params.childSessionKey ?? "");
  const activeAgent = runtimeAgent ?? activeContextAgent;
  const envelope = buildAcpAgentCallEnvelope({
    event: params.event,
    binding: {
      parentSessionKey: params.parentSessionKey,
      parentRunId: params.event.runId,
      agentId: activeAgent?.id,
      agentName: activeAgent?.name,
      agentSource: activeAgent?.source,
    },
  });
  const fallbackAgent = !runtimeAgent && !activeContextAgent && shouldUsePlanBundleDefaultAgent(envelope.agent)
    ? resolvePlanBundleDefaultAcpAgentIdentity({
        childSessionKey: params.childSessionKey,
        event: params.event,
      })
    : undefined;
  const rawAgent = runtimeAgent
    ?? fallbackAgent
    ?? enrichAcpAgentIdentity(envelope.agent, activeAcpAgentByChildSession.get(params.childSessionKey ?? ""));
  const agent = enrichAcpAgentIdentityFromPlanBundle({
    childSessionKey: params.childSessionKey,
    event: params.event,
    identity: rawAgent,
  });
  updateActiveAcpAgent(params.childSessionKey, agent);
  const enrichedEnvelope = { ...envelope, agent };
  const openClawToolEvent = isAcpToolEvent(params.event)
    ? buildAcpOpenClawToolEvent({
        childSessionKey: params.childSessionKey,
        event: params.event,
        parentSessionId: undefined,
        parentSessionKey: params.parentSessionKey,
      })
    : undefined;
  const openClawToolData = isRecord(openClawToolEvent?.data) ? openClawToolEvent.data : {};
  const mirror: Record<string, unknown> = {
    kind: "byai-channel-acp-parent-mirror",
    version: ACP_PARENT_MIRROR_VERSION,
    protocol: "acp",
    direction: "child-to-parent",
    parentSessionKey: params.parentSessionKey,
    childSessionKey: params.childSessionKey,
    clientId: params.clientId,
    runId: params.event.runId,
    stream: params.event.stream,
    seq: params.event.seq,
    summaryText: params.summaryText,
    rawEvent: buildRawAcpEvent(params.event),
    envelope: enrichedEnvelope,
    openclaw: {
      stream: isAcpToolEvent(params.event) ? "tool" : params.event.stream,
      ...(isAcpToolEvent(params.event)
        ? {
            phase: stringValue(openClawToolData.phase) || envelope.phase,
            toolCallId: stringValue(openClawToolData.toolCallId) || envelope.tool?.callId,
            toolName: stringValue(openClawToolData.name) || envelope.tool?.name,
          }
        : {}),
    },
    agent,
  };
  for (const [sourceKey, mirrorKey] of [
    ["phase", "phase"],
    ["eventType", "eventType"],
    ["tag", "tag"],
    ["status", "status"],
    ["title", "title"],
    ["toolCallId", "toolCallId"],
  ] as const) {
    const value = data[sourceKey];
    if (typeof value === "string" && value.trim().length > 0) {
      mirror[mirrorKey] = value;
    }
  }
  return mirror;
}

async function resolveTranscriptRuntime(): Promise<TranscriptRuntime | undefined> {
  try {
    const runtime = await import("openclaw/plugin-sdk/session-transcript-runtime");
    return runtime as TranscriptRuntime;
  } catch {
    return undefined;
  }
}

function deliveryMirrorMessageFields(deliveryMirror: Record<string, unknown>) {
  return {
    api: "openai-responses",
    provider: "openclaw",
    model: "delivery-mirror",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: Date.now(),
    openclawDeliveryMirror: deliveryMirror,
  };
}

function resolveDeliveryMirrorAgent(deliveryMirror: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(deliveryMirror.agent) ? deliveryMirror.agent : undefined;
}

function resolveAcpAgentSenderLabel(agent: Record<string, unknown> | undefined): string | undefined {
  if (!agent) {
    return undefined;
  }
  return (
    stringValue(agent.name)
    || stringValue(agent.displayName)
    || stringValue(agent.nativeSubagentName)
    || stringValue(agent.nativeSubagentId)
    || stringValue(agent.id)
    || undefined
  );
}

function deliveryMirrorSenderFields(deliveryMirror: Record<string, unknown>): Record<string, unknown> {
  const senderLabel = resolveAcpAgentSenderLabel(resolveDeliveryMirrorAgent(deliveryMirror));
  return senderLabel ? { senderLabel } : {};
}

function isConcreteAcpDeliveryAgent(agent: Record<string, unknown> | undefined): boolean {
  if (!agent) {
    return false;
  }
  const source = stringValue(agent.source);
  const id = stringValue(agent.id);
  const clientId = stringValue(agent.clientId);
  return Boolean(id && source !== "client_session" && id !== clientId);
}

function acpAssistantBaseKey(event: AgentEvent): string {
  return `${event.sessionKey ?? ""}:${event.runId ?? ""}:assistant`;
}

function acpAssistantTranscriptKey(event: AgentEvent, agent: Record<string, unknown>): string {
  const agentKey =
    stringValue(agent.nativeSubagentId)
    || stringValue(agent.id)
    || stringValue(agent.name)
    || "agent";
  return `${acpAssistantBaseKey(event)}:${normalizeNameSegment(agentKey, "agent")}`;
}

function normalizeAcpAssistantCompareText(text: string): string {
  return text
    .replace(/[`*_~\s]+/gu, "")
    .trim();
}

function mergeAcpAssistantText(params: {
  currentText: string;
  event: AgentEvent;
  textDelta: string;
}): string {
  const data = isRecord(params.event.data) ? params.event.data : {};
  const hasCumulativeText = typeof data.text === "string" && data.text.length > 0;
  if (!hasCumulativeText) {
    return `${params.currentText}${params.textDelta}`;
  }
  const currentComparable = normalizeAcpAssistantCompareText(params.currentText);
  const incomingComparable = normalizeAcpAssistantCompareText(params.textDelta);
  if (
    currentComparable.length >= 8 &&
    incomingComparable.length >= currentComparable.length &&
    incomingComparable.includes(currentComparable)
  ) {
    return params.textDelta.replace(/^\s+/u, "");
  }
  return `${params.currentText}${params.textDelta}`;
}

async function rewriteTranscriptMessage(params: {
  message: Record<string, unknown>;
  messageId: string;
  sessionFile: string | undefined;
}): Promise<boolean> {
  if (!params.sessionFile) {
    return false;
  }
  const raw = await fs.readFile(params.sessionFile, "utf8");
  const hadTrailingNewline = raw.endsWith("\n");
  const lines = raw.split(/\n/u);
  if (hadTrailingNewline) {
    lines.pop();
  }
  let changed = false;
  const rewritten = lines.map((line) => {
    if (!line.trim()) {
      return line;
    }
    try {
      const entry = JSON.parse(line) as unknown;
      if (isRecord(entry) && entry.type === "message" && entry.id === params.messageId) {
        changed = true;
        return JSON.stringify({
          ...entry,
          message: params.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      return line;
    }
    return line;
  });
  if (!changed) {
    return false;
  }
  await fs.writeFile(
    params.sessionFile,
    `${rewritten.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
    "utf8",
  );
  return true;
}

function isAcpDirectAnnounceDeliveryMirrorEntry(entry: unknown): entry is {
  id: string;
  message: {
    idempotencyKey?: string;
    model?: string;
    provider?: string;
  };
} {
  if (!isRecord(entry) || entry.type !== "message") {
    return false;
  }
  const id = stringValue(entry.id);
  const message = isRecord(entry.message) ? entry.message : {};
  const idempotencyKey = stringValue(message.idempotencyKey);
  return Boolean(
    id &&
      message.provider === "openclaw" &&
      message.model === "delivery-mirror" &&
      /^announce:v1:agent:[^:]+:acp:[^:]+:[^:]+:text-direct$/u.test(idempotencyKey),
  );
}

function isLeafReferencingRemovedEntry(entry: unknown, removedIds: Set<string>): boolean {
  if (!isRecord(entry) || entry.type !== "leaf") {
    return false;
  }
  const targetId = stringValue(entry.targetId);
  const appendParentId = stringValue(entry.appendParentId);
  return Boolean(
    (targetId && removedIds.has(targetId)) ||
      (appendParentId && removedIds.has(appendParentId)),
  );
}

export function filterAcpDirectAnnounceTranscriptLines(lines: string[]): {
  changed: boolean;
  removedIds: string[];
  lines: string[];
} {
  const removedIds = new Set<string>();
  const parsed = lines.map((line) => {
    if (!line.trim()) {
      return { line, remove: false };
    }
    try {
      const entry = JSON.parse(line) as unknown;
      if (isAcpDirectAnnounceDeliveryMirrorEntry(entry)) {
        removedIds.add(entry.id);
        return { line, remove: true };
      }
      return { entry, line, remove: false };
    } catch {
      return { line, remove: false };
    }
  });
  if (removedIds.size === 0) {
    return { changed: false, removedIds: [], lines };
  }
  const kept = parsed.filter((item) => {
    if (item.remove) {
      return false;
    }
    if ("entry" in item && isLeafReferencingRemovedEntry(item.entry, removedIds)) {
      return false;
    }
    return true;
  }).map((item) => item.line);
  return {
    changed: kept.length !== lines.length,
    removedIds: Array.from(removedIds),
    lines: kept,
  };
}

async function cleanupAcpDirectAnnounceTranscript(params: {
  api: OpenClawPluginApi;
  config?: unknown;
  parentSessionId: string;
  parentSessionKey: string;
  runtime: TranscriptRuntime;
}): Promise<void> {
  const resolveTarget = params.runtime.resolveSessionTranscriptLegacyFileTarget;
  if (!resolveTarget) {
    return;
  }
  const agentId = parentAgentIdFromSessionKey(params.parentSessionKey);
  try {
    const target = await resolveTarget({
      agentId,
      sessionKey: params.parentSessionKey,
      sessionId: params.parentSessionId,
      config: params.config,
    });
    const raw = await fs.readFile(target.sessionFile, "utf8");
    const hadTrailingNewline = raw.endsWith("\n");
    const lines = raw.split(/\n/u);
    if (hadTrailingNewline) {
      lines.pop();
    }
    const filtered = filterAcpDirectAnnounceTranscriptLines(lines);
    if (!filtered.changed) {
      return;
    }
    await fs.writeFile(
      target.sessionFile,
      `${filtered.lines.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
      "utf8",
    );
    await params.runtime.publishSessionTranscriptUpdateByIdentity?.({
      agentId,
      sessionKey: params.parentSessionKey,
      sessionId: params.parentSessionId,
      config: params.config,
      update: {
        agentId,
        sessionKey: params.parentSessionKey,
        acpDirectAnnounceCleanup: {
          removedIds: filtered.removedIds,
        },
      },
    });
    params.api.logger.info(
      `[byai-channel] cleaned ACP direct announce delivery-mirror entries: ${filtered.removedIds.join(",")}`,
    );
  } catch (error) {
    params.api.logger.warn(
      `[byai-channel] ACP direct announce cleanup skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function scheduleAcpDirectAnnounceCleanup(params: {
  api: OpenClawPluginApi;
  config?: unknown;
  event: AgentEvent;
  parentSessionId: string;
  parentSessionKey: string;
  runtime: TranscriptRuntime;
}): void {
  const key = `${params.parentSessionKey}:${params.event.sessionKey ?? ""}:${params.event.runId ?? ""}`;
  for (const timer of acpDirectAnnounceCleanupTimers.get(key) ?? []) {
    clearTimeout(timer);
  }
  const delays = [500, 1_500, 5_000, 15_000, 45_000, 90_000];
  const timers = delays.map((delay) => {
    const timer = setTimeout(() => {
      void cleanupAcpDirectAnnounceTranscript({
        api: params.api,
        config: params.config,
        parentSessionId: params.parentSessionId,
        parentSessionKey: params.parentSessionKey,
        runtime: params.runtime,
      }).finally(() => {
        const existing = acpDirectAnnounceCleanupTimers.get(key) ?? [];
        const remaining = existing.filter((entry) => entry !== timer);
        if (remaining.length === 0) {
          acpDirectAnnounceCleanupTimers.delete(key);
        } else {
          acpDirectAnnounceCleanupTimers.set(key, remaining);
        }
      });
    }, delay);
    timer.unref?.();
    return timer;
  });
  acpDirectAnnounceCleanupTimers.set(key, timers);
}

async function appendAcpNativeToolTranscript(params: {
  api: OpenClawPluginApi;
  config?: unknown;
  deliveryMirror: Record<string, unknown>;
  event: AgentEvent;
  parentSessionId: string;
  parentSessionKey: string;
  runtime: TranscriptRuntime;
}): Promise<boolean> {
  const withLock = params.runtime.withSessionTranscriptWriteLock;
  if (!withLock || !isAcpToolEvent(params.event)) {
    return false;
  }
  const phase = resolveOpenClawToolPhase(params.event);
  const toolCallId = stableAcpToolCallId(params.event);
  const transcriptKey = acpToolStateKey(params.event.sessionKey, toolCallId);
  if (phase === "update" && nativeAcpToolTranscriptStarted.has(transcriptKey)) {
    return false;
  }
  const toolName = resolveAcpToolName(params.event);
  const toolEvent = buildAcpOpenClawToolEvent({
    childSessionKey: params.event.sessionKey,
    event: params.event,
    parentSessionId: params.parentSessionId,
    parentSessionKey: params.parentSessionKey,
  });
  const toolArgs = (toolEvent?.data.args ?? {}) as Record<string, unknown>;
  const rawInput = isRecord(toolArgs) ? stringValue(toolArgs.input) || stringValue(toolArgs.preview) : "";
  const eventData = isRecord(params.event.data) ? params.event.data : {};
  const resolvedToolName = stringValue(toolEvent?.data.name) || toolName;
  const isMarkerOnlyTool = isAcpStructuredAgentMarkerToolText(rawInput)
    || isAcpStructuredAgentMarkerToolText(stringValue(eventData.text))
    || isAcpStructuredAgentMarkerToolText(stringValue(eventData.delta))
    || isAcpStructuredAgentMarkerToolText(stringValue(eventData.title));
  if (isMarkerOnlyTool && (phase === "start" || phase === "update")) {
    return false;
  }
  if ((phase === "start" || phase === "update") && !isMeaningfulAcpToolInput(rawInput)) {
    return false;
  }
  const effectivePhase = phase === "update" ? "start" : phase;
  const idempotencyKey = `byai-channel:acp-parent-native-tool:${params.event.sessionKey ?? ""}:${params.event.runId ?? ""}:${effectivePhase}:${toolCallId}`;
  try {
    await withLock(
      {
        agentId: parentAgentIdFromSessionKey(params.parentSessionKey),
        sessionKey: params.parentSessionKey,
        sessionId: params.parentSessionId,
        config: params.config,
      },
      async (context) => {
        if (effectivePhase === "start") {
          await context.appendMessage({
            idempotencyLookup: "scan",
            message: {
              role: "assistant",
              ...deliveryMirrorSenderFields(params.deliveryMirror),
              content: [
                {
                  type: "toolCall",
                  id: toolCallId,
                  name: resolvedToolName,
                  arguments: toolArgs,
                  partialArgs: JSON.stringify(
                    toolArgs,
                  ),
                },
              ],
              stopReason: "toolUse",
              idempotencyKey,
              ...deliveryMirrorMessageFields(params.deliveryMirror),
            },
          });
          nativeAcpToolTranscriptStarted.add(transcriptKey);
        } else {
          if (
            !nativeAcpToolTranscriptStarted.has(transcriptKey)
            && toolArgs
            && Object.keys(toolArgs).length > 0
            && !isMarkerOnlyTool
          ) {
            await context.appendMessage({
              idempotencyLookup: "scan",
              message: {
                role: "assistant",
                ...deliveryMirrorSenderFields(params.deliveryMirror),
                content: [
                  {
                    type: "toolCall",
                    id: toolCallId,
                    name: resolvedToolName,
                    arguments: toolArgs,
                    partialArgs: JSON.stringify(toolArgs),
                  },
                ],
                stopReason: "toolUse",
                idempotencyKey: `byai-channel:acp-parent-native-tool:${params.event.sessionKey ?? ""}:${params.event.runId ?? ""}:start:${toolCallId}`,
                ...deliveryMirrorMessageFields(params.deliveryMirror),
              },
            });
            nativeAcpToolTranscriptStarted.add(transcriptKey);
          }
          if (isMarkerOnlyTool) {
            if (nativeAcpToolTranscriptStarted.has(transcriptKey)) {
              await context.appendMessage({
                idempotencyLookup: "scan",
                message: {
                  role: "toolResult",
                  ...deliveryMirrorSenderFields(params.deliveryMirror),
                  toolCallId,
                  toolName: resolvedToolName,
                  content: [],
                  details: {
                    acp: {
                      markerOnly: true,
                    },
                  },
                  isError: false,
                  idempotencyKey,
                  timestamp: Date.now(),
                  openclawDeliveryMirror: params.deliveryMirror,
                },
              });
              await context.publishUpdate();
            }
            return;
          }
          const result = extractAcpToolResult(params.event);
          const resultText = isRecord(result)
            && Array.isArray(result.content)
            && isRecord(result.content[0])
            ? stringValue(result.content[0].text)
            : "";
          const assistantResultText = formatAcpTaskAssistantOutput(resultText);
          const shouldMirrorTaskAssistantOutput = isAcpTaskToolName(resolvedToolName)
            && isMeaningfulAcpTaskAssistantOutput(assistantResultText);
          if (Array.isArray(result.content) && result.content.length > 0) {
            await context.appendMessage({
              idempotencyLookup: "scan",
              message: {
                role: "toolResult",
                ...deliveryMirrorSenderFields(params.deliveryMirror),
                toolCallId,
                toolName: resolvedToolName,
                content: result.content,
                details: result.details,
                isError: /^(error|failed|failure)$/u.test(
                  stringValue(isRecord(params.event.data) ? params.event.data.status : "").toLowerCase(),
                ),
                idempotencyKey,
                timestamp: Date.now(),
                openclawDeliveryMirror: params.deliveryMirror,
              },
            });
          }
          if (shouldMirrorTaskAssistantOutput) {
            await context.appendMessage({
              idempotencyLookup: "scan",
              message: {
                role: "assistant",
                ...deliveryMirrorSenderFields(params.deliveryMirror),
                content: [
                  {
                    type: "text",
                    text: assistantResultText,
                  },
                ],
                stopReason: "stop",
                idempotencyKey: `byai-channel:acp-parent-native-task-assistant:${params.event.sessionKey ?? ""}:${params.event.runId ?? ""}:${toolCallId}`,
                ...deliveryMirrorMessageFields(params.deliveryMirror),
              },
            });
          }
        }
        await context.publishUpdate();
      },
    );
    return true;
  } catch (error) {
    params.api.logger.warn(
      `[byai-channel] ACP native tool transcript append skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function appendAcpNativeAssistantTranscript(params: {
  api: OpenClawPluginApi;
  config?: unknown;
  deliveryMirror: Record<string, unknown>;
  event: AgentEvent;
  parentSessionId: string;
  parentSessionKey: string;
  runtime: TranscriptRuntime;
  text: string;
}): Promise<boolean> {
  const withLock = params.runtime.withSessionTranscriptWriteLock;
  if (!withLock || params.event.stream !== "assistant") {
    return false;
  }
  const text = params.text;
  if (!text.trim()) {
    return true;
  }
  const deliveryAgent = resolveDeliveryMirrorAgent(params.deliveryMirror);
  const baseKey = acpAssistantBaseKey(params.event);
  if (!isConcreteAcpDeliveryAgent(deliveryAgent)) {
    pendingNativeAcpAssistantTextByKey.set(
      baseKey,
      `${pendingNativeAcpAssistantTextByKey.get(baseKey) ?? ""}${text}`,
    );
    return true;
  }
  const pendingText = pendingNativeAcpAssistantTextByKey.get(baseKey) ?? "";
  pendingNativeAcpAssistantTextByKey.delete(baseKey);
  const textDelta = `${pendingText}${text}`;
  if (!textDelta.trim()) {
    return true;
  }
  const transcriptKey = acpAssistantTranscriptKey(params.event, deliveryAgent);
  const idempotencyKey = `byai-channel:acp-parent-native-assistant:${transcriptKey}`;
  const resolveTarget = params.runtime.resolveSessionTranscriptLegacyFileTarget;
  let sessionFile: string | undefined;
  if (resolveTarget) {
    try {
      sessionFile = (await resolveTarget({
        agentId: parentAgentIdFromSessionKey(params.parentSessionKey),
        sessionKey: params.parentSessionKey,
        sessionId: params.parentSessionId,
        config: params.config,
      })).sessionFile;
    } catch (error) {
      params.api.logger.warn(
        `[byai-channel] ACP native assistant transcript target unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  try {
    await withLock(
      {
        agentId: parentAgentIdFromSessionKey(params.parentSessionKey),
        sessionKey: params.parentSessionKey,
        sessionId: params.parentSessionId,
        config: params.config,
      },
      async (context) => {
        const existing = nativeAcpAssistantTranscriptByKey.get(transcriptKey);
        if (existing) {
          existing.text = mergeAcpAssistantText({
            currentText: existing.text,
            event: params.event,
            textDelta,
          });
          Object.assign(existing.message, {
            role: "assistant",
            ...deliveryMirrorSenderFields(params.deliveryMirror),
            content: [
              {
                type: "text",
                text: existing.text,
              },
            ],
            stopReason: "stop",
            ...deliveryMirrorMessageFields(params.deliveryMirror),
            idempotencyKey: existing.idempotencyKey,
          });
          await rewriteTranscriptMessage({
            message: existing.message,
            messageId: existing.messageId,
            sessionFile,
          });
          await context.publishUpdate({
            messageId: existing.messageId,
            sessionKey: params.parentSessionKey,
            acpAssistantDeltaMerged: true,
          });
          return;
        }

        const firstText = textDelta.replace(/^\s+/u, "");
        const message: Record<string, unknown> = {
          role: "assistant",
          ...deliveryMirrorSenderFields(params.deliveryMirror),
          content: [
            {
              type: "text",
              text: firstText,
            },
          ],
          stopReason: "stop",
          idempotencyKey,
          ...deliveryMirrorMessageFields(params.deliveryMirror),
        };
        const appended = await context.appendMessage({
          idempotencyLookup: "scan",
          message,
        });
        if (appended?.messageId) {
          nativeAcpAssistantTranscriptByKey.set(transcriptKey, {
            idempotencyKey,
            message,
            messageId: appended.messageId,
            text: firstText,
          });
        }
        await context.publishUpdate({
          messageId: appended?.messageId,
          sessionKey: params.parentSessionKey,
          acpAssistantDeltaMerged: false,
        });
      },
    );
    return true;
  } catch (error) {
    params.api.logger.warn(
      `[byai-channel] ACP native assistant transcript append skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function appendAcpNativeThinkingTranscript(params: {
  api: OpenClawPluginApi;
  config?: unknown;
  deliveryMirror: Record<string, unknown>;
  event: AgentEvent;
  parentSessionId: string;
  parentSessionKey: string;
  runtime: TranscriptRuntime;
}): Promise<boolean> {
  const withLock = params.runtime.withSessionTranscriptWriteLock;
  const thinkingEvent = buildAcpOpenClawThinkingEvent(params.event);
  if (!withLock || !thinkingEvent) {
    return false;
  }
  const data = isRecord(thinkingEvent.data) ? thinkingEvent.data : {};
  const thinking = (stringValue(data.delta) || stringValue(data.text)).trim();
  if (!thinking) {
    return true;
  }
  try {
    await withLock(
      {
        agentId: parentAgentIdFromSessionKey(params.parentSessionKey),
        sessionKey: params.parentSessionKey,
        sessionId: params.parentSessionId,
        config: params.config,
      },
      async (context) => {
        await context.appendMessage({
          idempotencyLookup: "scan",
          message: {
            role: "assistant",
            ...deliveryMirrorSenderFields(params.deliveryMirror),
            content: [
              {
                type: "thinking",
                thinking,
              },
            ],
            stopReason: "stop",
            idempotencyKey: `byai-channel:acp-parent-native-thinking:${params.event.sessionKey ?? ""}:${params.event.runId ?? ""}:${params.event.stream}:${String(params.event.seq ?? "")}`,
            ...deliveryMirrorMessageFields(params.deliveryMirror),
          },
        });
        await context.publishUpdate();
      },
    );
    return true;
  } catch (error) {
    params.api.logger.warn(
      `[byai-channel] ACP native thinking transcript append skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function resolveDeliveryMirrorSummaryText(event: AgentEvent, text: string): string {
  if (text.trim()) {
    return text.trim();
  }
  const thinkingEvent = buildAcpOpenClawThinkingEvent(event);
  const thinkingData = isRecord(thinkingEvent?.data) ? thinkingEvent.data : {};
  const thinking = stringValue(thinkingData.delta) || stringValue(thinkingData.text);
  if (thinking.trim()) {
    return truncateText(thinking);
  }
  const data = isRecord(event.data) ? event.data : {};
  const toolSummary = stringValue(data.title) || stringValue(data.name) || stringValue(data.toolName);
  if (toolSummary.trim()) {
    return truncateText(toolSummary);
  }
  return event.stream ?? "acp";
}

export async function mirrorAcpChildEventToParentSession(
  api: OpenClawPluginApi,
  request: ActiveSdkRequest,
  event: AgentEvent,
): Promise<void> {
  const childSessionKey = event.sessionKey;
  if (!isAcpChildSessionKey(childSessionKey)) {
    return;
  }
  observeAcpStructuredAgentMarkers({
    childSessionKey,
    event,
  });
  rememberAcpAgentContext({
    childSessionKey,
    event,
    parentSessionId: request.sessionId,
    parentSessionKey: request.sessionKey,
  });
  const text = resolveMirrorText(event);
  const runtime = await resolveTranscriptRuntime();
  if (!runtime) {
    api.logger.warn("[byai-channel] ACP parent mirror skipped: session transcript runtime unavailable");
    return;
  }
  const clientId = acpClientIdFromSessionKey(childSessionKey ?? "");
  const deliveryMirror = buildAcpDeliveryMirror({
    childSessionKey,
    clientId,
    event,
    parentSessionKey: request.sessionKey,
    summaryText: resolveDeliveryMirrorSummaryText(event, text),
  });
  scheduleAcpDirectAnnounceCleanup({
    api,
    config: api.config,
    event,
    parentSessionId: request.sessionId,
    parentSessionKey: request.sessionKey,
    runtime,
  });
  maybeClearAcpAgentContext(event, childSessionKey);
  const nativeToolAppended = await appendAcpNativeToolTranscript({
    api,
    config: api.config,
    deliveryMirror,
    event,
    parentSessionId: request.sessionId,
    parentSessionKey: request.sessionKey,
    runtime,
  });
  if (nativeToolAppended) {
    return;
  }
  if (isAcpToolEvent(event)) {
    return;
  }
  const nativeThinkingAppended = await appendAcpNativeThinkingTranscript({
    api,
    config: api.config,
    deliveryMirror,
    event,
    parentSessionId: request.sessionId,
    parentSessionKey: request.sessionKey,
    runtime,
  });
  if (nativeThinkingAppended) {
    return;
  }
  const nativeAssistantAppended = await appendAcpNativeAssistantTranscript({
    api,
    config: api.config,
    deliveryMirror,
    event,
    parentSessionId: request.sessionId,
    parentSessionKey: request.sessionKey,
    runtime,
    text,
  });
  if (nativeAssistantAppended) {
    return;
  }
  // Lifecycle/runtime status events are represented by diagnostics and raw ACP
  // metadata. Do not write them as visible assistant text in the parent chat.
}
