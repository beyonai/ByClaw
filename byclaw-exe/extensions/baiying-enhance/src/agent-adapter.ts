import { parseCorePersonaDefinition } from "./core-persona-definition.js";
import {
  MANAGED_AGENT_PREFIX,
  type AgentListEntry,
  type BaiyingAssociatedResource,
  type BaiyingCoreCompetency,
} from "./types.js";

type BaiyingRunConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: string;
};

type BaiyingAgentListItem = {
  id?: number;
  name?: string;
  instructions?: string;
  runConfig?: BaiyingRunConfig;
};

type BaiyingExport = {
  agent_list?: BaiyingAgentListItem[];
};

type NativeAgentJson = {
  id?: string | number;
  name?: string;
  model?: string;
  systemPrompt?: string;
  instructions?: string;
  skills?: string[];
  runConfig?: BaiyingRunConfig;
  allowSpawnFrom?: string[];
};

export type ProviderBundle = {
  baseUrl: string;
  apiKey: unknown;
  api: "openai-completions";
  modelId: string;
};

export type AdaptedManagedAgent = {
  sourceKey: string;
  agentId: string;
  providerKey: string;
  modelRef: string;
  allowSpawnFrom: string[];
  listEntry: AgentListEntry;
  provider?: ProviderBundle;
  /** Agent instructions used for workspace seeding (SOUL.md). */
  systemPrompt?: string;
  /** Absolute path to the source JSON (for workspace seeding). */
  sourceFilePath?: string;
  /** Parsed source JSON when the authoritative copy came from Redis instead of disk. */
  sourceJson?: unknown;
  /** SSE endpoint for INTERFACE-type agents. */
  agentSseUrl?: string;
  /** Integration type: "NONE" (proxy LLM) or "INTERFACE" (SSE backend). */
  integrationType?: string;
  /** Associated resources from Baiying detail. */
  associatedResources?: BaiyingAssociatedResource[];
  /** Core competencies from Baiying detail. */
  coreCompetencies?: BaiyingCoreCompetency[];
};

function slugifyBase(name: string): string {
  const s = name
    .replace(/\.json$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "agent";
}

function normalizeAllowSpawnFrom(raw?: string[]): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ["main"];
  }
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function nonEmpty(val: unknown): string {
  return typeof val === "string" && val.trim() ? val.trim() : "";
}

/** OpenClaw `agents.list[].skills`: default `[]`; fill from `relSkills` on Baiying detail / agent JSON, else legacy root `skills`. */
function normalizeAgentListSkills(raw: Record<string, unknown>): string[] {
  const toStrings = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];

  const fromRel = toStrings(raw.relSkills);
  if (fromRel.length > 0) {
    return fromRel;
  }
  const fromSkills = toStrings(raw.skills);
  if (fromSkills.length > 0) {
    return fromSkills;
  }
  return [];
}

/** Check if raw is a Baiying platform detail response (has resourceId + resourceName at root). */
function isRawBaiyingDetail(raw: Record<string, unknown>): boolean {
  return typeof raw.resourceId === "string" && typeof raw.resourceName === "string";
}

function adaptRawBaiyingDetail(params: {
  raw: Record<string, unknown>;
  fileName: string;
  embedApiKeysFromJson: boolean;
  envApiKeyTemplate?: string;
  defaultProxyUrl?: string;
  defaultApiKey?: string;
}): AdaptedManagedAgent | { error: string } {
  const detail = params.raw;
  const sourceKey = String(detail.resourceId);
  const name = nonEmpty(detail.resourceName) || `baiying-${sourceKey}`;

  const coreRaw =
    typeof detail.corePersonaDefinition === "string" ? detail.corePersonaDefinition.trim() : "";
  const personaParsed = parseCorePersonaDefinition(coreRaw || undefined);
  const corePersonaBlock =
    personaParsed.extensions.length > 0
      ? "百应业务拓展属性见工作区文件 BYAI_BUSINESS_EXTENSIONS.md。"
      : coreRaw || "";

  // Compose instructions: `corePersonaDefinition` 为平台核心人格长文时优先；JSON 拓展数组则改为引用拓展 MD（与 SOUL.md 一致）。
  const instructionParts = [
    ...(corePersonaBlock ? [corePersonaBlock] : []),
    nonEmpty(detail.roleAttributes),
    nonEmpty(detail.processingFlow),
    nonEmpty(detail.ability),
    nonEmpty(detail.constraints),
    nonEmpty(detail.personalityDimensions),
    nonEmpty(detail.wordPreferences),
    nonEmpty(detail.sentenceAndTone),
    nonEmpty(detail.faqs),
  ].filter(Boolean);
  const instructions = instructionParts.join("\n\n") || "You are a helpful assistant.";

  // Integration type and SSE URL.
  const integrationType = nonEmpty(detail.integrationType) || undefined;
  const agentSseUrl = nonEmpty(detail.agentSseUrl) || undefined;

  // Associated resources (API may return either relResourceInfoList or relResourceList).
  const relResources = Array.isArray(detail.relResourceInfoList)
    ? detail.relResourceInfoList
    : Array.isArray(detail.relResourceList)
      ? detail.relResourceList
      : [];
  const associatedResources: BaiyingAssociatedResource[] = relResources
    .filter(
      (r: unknown) =>
        r && typeof r === "object" && typeof (r as Record<string, unknown>).resourceId === "string",
    )
    .map((r: Record<string, unknown>) => ({
      resourceId: String(r.resourceId),
      resourceName: nonEmpty(r.resourceName) || String(r.resourceId),
      resourceType: nonEmpty(r.resourceBizType) || nonEmpty(r.resourceType) || "UNKNOWN",
      ...(nonEmpty(r.resourceBizType) ? { resourceBizType: nonEmpty(r.resourceBizType) } : {}),
      ...(nonEmpty(r.resourceCode) ? { resourceCode: nonEmpty(r.resourceCode) } : {}),
      ...(nonEmpty(r.resourceDesc) ? { resourceDesc: nonEmpty(r.resourceDesc) } : {}),
      ...(r.resourceSourcePkId != null
        ? { resourceSourcePkId: String(r.resourceSourcePkId) }
        : {}),
      ...(nonEmpty(r.systemCode) ? { systemCode: nonEmpty(r.systemCode) } : {}),
      ...(nonEmpty(r.implType) ? { implType: nonEmpty(r.implType) } : {}),
      ...(nonEmpty(r.hostType) ? { hostType: nonEmpty(r.hostType) } : {}),
      ...(nonEmpty(r.parentResourceId)
        ? { parentResourceId: nonEmpty(r.parentResourceId) }
        : {}),
      raw: r,
    }));

  // Core competencies.
  const parsedCompetencies = safeJsonParse(detail.coreCompetencies);
  const coreCompetencies: BaiyingCoreCompetency[] = Array.isArray(parsedCompetencies)
    ? parsedCompetencies
    : [];

  const agentId = `${MANAGED_AGENT_PREFIX}${sourceKey}`;

  // For INTERFACE/A2A/PAGE agents: they have their own backend (agentSseUrl or agentWebUrl),
  // no LLM provider needed. They are registered as tool-based agents and work via baiying_call.
  const isBackendAgent =
    integrationType === "INTERFACE" || integrationType === "A2A" || integrationType === "PAGE";

  const listSkills = normalizeAgentListSkills(detail);

  if (isBackendAgent) {
    const listEntry: AgentListEntry = {
      id: agentId,
      name,
      identity: { name },
      skills: listSkills,
      tools: {
        alsoAllow: ["baiying_call"],
      },
    };

    return {
      sourceKey,
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry,
      systemPrompt: instructions,
      integrationType,
      agentSseUrl,
      associatedResources: associatedResources.length > 0 ? associatedResources : undefined,
      coreCompetencies: coreCompetencies.length > 0 ? coreCompetencies : undefined,
    };
  }

  // For NONE-type agents, do not bind model/provider from agent JSON.
  // Leave model unset so OpenClaw can use its default model configuration.
  const listEntry: AgentListEntry = {
    id: agentId,
    name,
    identity: { name },
    skills: listSkills,
    tools: {
      alsoAllow: ["baiying_call"],
    },
  };

  return {
    sourceKey,
    agentId,
    providerKey: "",
    modelRef: "",
    allowSpawnFrom: ["main"],
    listEntry,
    systemPrompt: instructions,
    integrationType,
    agentSseUrl,
    associatedResources: associatedResources.length > 0 ? associatedResources : undefined,
    coreCompetencies: coreCompetencies.length > 0 ? coreCompetencies : undefined,
  };
}

/**
 * Map a Baiying export or a small native JSON into a managed OpenClaw agent entry + optional provider.
 */
export function adaptAgentJson(params: {
  raw: unknown;
  fileName: string;
  embedApiKeysFromJson: boolean;
  envApiKeyTemplate?: string;
  defaultProxyUrl?: string;
  defaultApiKey?: string;
}): AdaptedManagedAgent | { error: string } {
  const baseName = slugifyBase(params.fileName);

  if (!params.raw || typeof params.raw !== "object") {
    return { error: "invalid JSON root" };
  }

  const asRecord = params.raw as Record<string, unknown>;

  // Format 1: Raw Baiying platform detail response (resourceId + resourceName at root).
  if (isRawBaiyingDetail(asRecord)) {
    return adaptRawBaiyingDetail({
      raw: asRecord,
      fileName: params.fileName,
      embedApiKeysFromJson: params.embedApiKeysFromJson,
      envApiKeyTemplate: params.envApiKeyTemplate,
      defaultProxyUrl: params.defaultProxyUrl,
      defaultApiKey: params.defaultApiKey,
    });
  }

  // Format 2: Baiying agent_list export.
  const baiying = asRecord as BaiyingExport;

  if (Array.isArray(baiying.agent_list) && baiying.agent_list.length > 0) {
    const item = baiying.agent_list[0];
    if (!item || typeof item !== "object") {
      return { error: "agent_list[0] missing" };
    }
    const idNum = typeof item.id === "number" && Number.isFinite(item.id) ? item.id : undefined;
    const sourceKey = idNum != null ? String(idNum) : baseName;
    const name =
      typeof item.name === "string" && item.name.trim() ? item.name.trim() : `baiying-${sourceKey}`;
    const instructions =
      typeof item.instructions === "string" && item.instructions.trim()
        ? item.instructions.trim()
        : "You are a helpful assistant.";
    const agentId = `${MANAGED_AGENT_PREFIX}${sourceKey}`;
    const listEntry: AgentListEntry = {
      id: agentId,
      name,
      identity: { name },
      skills: normalizeAgentListSkills(asRecord),
    };

    return {
      sourceKey,
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry,
      systemPrompt: instructions,
    };
  }

  const native = asRecord as NativeAgentJson;
  const idRaw =
    typeof native.id === "string" && native.id.trim()
      ? native.id.trim()
      : typeof native.id === "number"
        ? String(native.id)
        : baseName;
  const sourceKey = idRaw.replace(/^baiying-agent-/i, "");
  const agentId = idRaw.startsWith(MANAGED_AGENT_PREFIX)
    ? idRaw
    : `${MANAGED_AGENT_PREFIX}${sourceKey}`;

  const systemPrompt =
    typeof native.systemPrompt === "string" && native.systemPrompt.trim()
      ? native.systemPrompt.trim()
      : typeof native.instructions === "string" && native.instructions.trim()
        ? native.instructions.trim()
        : "You are a helpful assistant.";

  const listEntry: AgentListEntry = {
    id: agentId,
    name: typeof native.name === "string" && native.name.trim() ? native.name.trim() : agentId,
    identity: {
      name: typeof native.name === "string" && native.name.trim() ? native.name.trim() : agentId,
    },
    skills: normalizeAgentListSkills(asRecord),
  };

  return {
    sourceKey,
    agentId,
    providerKey: "",
    modelRef: "",
    allowSpawnFrom: normalizeAllowSpawnFrom(native.allowSpawnFrom),
    listEntry,
    systemPrompt,
  };
}
