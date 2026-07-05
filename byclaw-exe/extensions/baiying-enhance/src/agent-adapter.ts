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

const CODE_TO_WIKI_EMPLOYEE_NAME = "百应平台赋能助手";
const CODE_TO_WIKI_TOOL_NAME = "code_to_wiki";

function isSkillRelResource(raw: Record<string, unknown>): boolean {
    const t = String(raw.resourceBizType ?? raw.resourceType ?? "").trim().toUpperCase();
    return t === "SKILL";
}

export type AimodelProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages";
export type AimodelModelInput = "text" | "image";
export type AimodelThinkingLevel =
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "adaptive"
    | "max";
export type AimodelThinkingLevelMap = Partial<Record<AimodelThinkingLevel, string | null>>;
export type AimodelThinkingBudgets = Partial<
    Record<Exclude<AimodelThinkingLevel, "off" | "xhigh" | "adaptive">, number>
>;

export type AimodelModelCompat = {
    thinkingFormat?: string;
    supportedReasoningEfforts?: string[];
    reasoningEffortMap?: Record<string, string>;
    supportsUsageInStreaming?: boolean;
};

export type ProviderBundle = {
    baseUrl: string;
    apiKey: unknown;
    api: AimodelProviderApi;
    modelId: string;
    modelName?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: AimodelModelInput[];
    reasoning?: boolean;
    thinkingLevelMap?: AimodelThinkingLevelMap;
    thinkingBudgets?: AimodelThinkingBudgets;
    compat?: AimodelModelCompat;
};

export type BaiyingHubSkillRef = {
    skillCode: string;
    skillUrl: string;
    versionUrl: string;
};

export type AdaptedManagedAgent = {
    sourceKey: string;
    agentId: string;
    providerKey: string;
    modelRef: string;
    allowSpawnFrom: string[];
    listEntry: AgentListEntry;
    provider?: ProviderBundle;
    /** Agent description from Baiying detail. */
    resourceDesc?: string;
    /** Agent instructions used for workspace seeding (SOUL.md). */
    systemPrompt?: string;
    /** Absolute path to the source JSON (for workspace seeding). */
    sourceFilePath?: string;
    /** Parsed source JSON when the authoritative copy came from Redis instead of disk. */
    sourceJson?: unknown;
    /** Baiying `prologue.modelId`, used to resolve model transport details from Redis. */
    baiyingModelId?: string;
    /** SSE endpoint for INTERFACE-type agents. */
    agentSseUrl?: string;
    /** Home URL for PAGE-type / home-page based backend agents. */
    agentHomeUrl?: string;
    /** Integration type: "NONE" (proxy LLM) or "INTERFACE" (SSE backend). */
    integrationType?: string;
    /** Associated resources from Baiying detail. */
    associatedResources?: BaiyingAssociatedResource[];
    /** Core competencies from Baiying detail. */
    coreCompetencies?: BaiyingCoreCompetency[];
    /** Hub skills that need local version sync before OpenClaw loads them. */
    hubSkills?: BaiyingHubSkillRef[];
    /** Workspace/extra skill roots referenced by object-form relSkills or extraSkills. */
    extraSkillPaths?: string[];
};

const MANAGED_AGENT_EXPERIMENTAL: NonNullable<AgentListEntry["experimental"]> = {
    // Baiying employees need the baiying_call plugin tool directly visible.
    // Global lean mode compacts plugin tools behind exec/wait, which breaks that contract.
    localModelLean: false,
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

function normalizeStringList(raw: unknown): string[] {
    const value =
        typeof raw === "string" && raw.trim().startsWith("[") ? safeJsonParse(raw) : raw;
    return Array.isArray(value) ? value.map((s) => String(s).trim()).filter(Boolean) : [];
}

function normalizeModelId(raw: unknown): string | undefined {
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        return trimmed || undefined;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
    }
    return undefined;
}

export function extractBaiyingPrologueModelId(raw: unknown): string | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const prologueRaw = (raw as Record<string, unknown>).prologue;
    const prologue =
        typeof prologueRaw === "string" && prologueRaw.trim()
            ? safeJsonParse(prologueRaw)
            : prologueRaw;
    if (!prologue || typeof prologue !== "object") {
        return undefined;
    }
    return normalizeModelId((prologue as Record<string, unknown>).modelId);
}

function normalizeSkillRefCode(raw: unknown): string {
    if (typeof raw === "string" || typeof raw === "number") {
        return String(raw).trim();
    }
    return "";
}

function normalizeSkillPath(raw: unknown): string {
    return typeof raw === "string" ? raw.trim() : "";
}

function recordFromMaybeJson(raw: unknown): Record<string, unknown> | null {
    const parsed =
        typeof raw === "string" && raw.trim().startsWith("{") ? safeJsonParse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }
    return parsed as Record<string, unknown>;
}

function extractExtraSkillPath(raw: unknown): string {
    if (typeof raw === "string") {
        const path = normalizeSkillPath(raw);
        return path.includes("/skills/") || path.endsWith("/SKILL.md") ? path : "";
    }
    const record = recordFromMaybeJson(raw);
    if (!record) {
        return "";
    }
    const target = recordFromMaybeJson(record.targetContent);
    return (
        normalizeSkillPath(record.skillPath) ||
        normalizeSkillPath(record.skillDocObjectKey) ||
        (target
            ? normalizeSkillPath(target.skillPath) || normalizeSkillPath(target.skillDocObjectKey)
            : "")
    );
}

function normalizeHubSkillRef(raw: Record<string, unknown>): BaiyingHubSkillRef | null {
    const skillType = nonEmpty(raw.skillType).toLowerCase();
    if (skillType !== "hub") {
        return null;
    }
    const skillCode = normalizeSkillRefCode(raw.skillCode);
    const skillUrl = nonEmpty(raw.skillUrl);
    const versionUrl = nonEmpty(raw.versionUrl);
    if (!skillCode || !skillUrl || !versionUrl) {
        return null;
    }
    return { skillCode, skillUrl, versionUrl };
}

function normalizeRelSkillCodes(raw: unknown): string[] {
    const value =
        typeof raw === "string" && raw.trim().startsWith("[") ? safeJsonParse(raw) : raw;
    if (!Array.isArray(value)) {
        return [];
    }
    const out: string[] = [];
    for (const item of value) {
        if (typeof item === "string" || typeof item === "number") {
            const name = normalizeSkillRefCode(item);
            if (name) {
                out.push(name);
            }
            continue;
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        if (extractExtraSkillPath(item)) {
            continue;
        }
        const skillCode = normalizeSkillRefCode((item as Record<string, unknown>).skillCode);
        if (skillCode) {
            out.push(skillCode);
        }
    }
    return out;
}

function normalizeHubSkillRefs(raw: unknown): BaiyingHubSkillRef[] {
    const value =
        typeof raw === "string" && raw.trim().startsWith("[") ? safeJsonParse(raw) : raw;
    if (!Array.isArray(value)) {
        return [];
    }
    const out: BaiyingHubSkillRef[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const ref = normalizeHubSkillRef(item as Record<string, unknown>);
        if (!ref || seen.has(ref.skillCode)) {
            continue;
        }
        seen.add(ref.skillCode);
        out.push(ref);
    }
    return out;
}

function normalizeExtraSkillPaths(...groups: unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const group of groups) {
        const value =
            typeof group === "string" && group.trim().startsWith("[") ? safeJsonParse(group) : group;
        const items = Array.isArray(value) ? value : value == null ? [] : [value];
        for (const item of items) {
            const path = extractExtraSkillPath(item);
            if (!path || seen.has(path)) {
                continue;
            }
            seen.add(path);
            out.push(path);
        }
    }
    return out;
}

/** OpenClaw `agents.list[].skills`: default `[]`; fill from `relSkills` on Baiying detail / agent JSON, else legacy root `skills`. */
function normalizeAgentListSkills(raw: Record<string, unknown>): string[] {
    const fromRel = normalizeRelSkillCodes(raw.relSkills);
    if (fromRel.length > 0) {
        return Array.from(new Set(fromRel));
    }
    const fromSkills = normalizeStringList(raw.skills);
    if (fromSkills.length > 0) {
        return fromSkills;
    }
    return [];
}

/** OpenClaw `agents.list[].tools`: map root `relTools` to `tools.allow` and keep the plugin bridge available. */
function normalizeAgentListTools(
    raw: Record<string, unknown>,
): NonNullable<AgentListEntry["tools"]> {
    const allow = normalizeStringList(raw.relTools);
    const extraTools =
        nonEmpty(raw.resourceName) === CODE_TO_WIKI_EMPLOYEE_NAME ||
        nonEmpty(raw.name) === CODE_TO_WIKI_EMPLOYEE_NAME
            ? [CODE_TO_WIKI_TOOL_NAME]
            : [];
    return allow.length > 0
        ? {
              allow: Array.from(new Set([...allow, "baiying_call", ...extraTools])),
          }
        : {
              alsoAllow: Array.from(new Set(["baiying_call", ...extraTools])),
          };
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

    // Integration type and backend URLs.
    const integrationType = nonEmpty(detail.integrationType) || undefined;
    const agentSseUrl = nonEmpty(detail.agentSseUrl) || undefined;
    const agentHomeUrl = nonEmpty(detail.agentHomeUrl) || undefined;

    // Associated resources from Baiying detail.
    const relResources = Array.isArray(detail.relResourceList) ? detail.relResourceList : [];
    const associatedResources: BaiyingAssociatedResource[] = relResources
        .filter(
            (r: unknown) =>
                r &&
                typeof r === "object" &&
                typeof (r as Record<string, unknown>).resourceId === "string" &&
                !isSkillRelResource(r as Record<string, unknown>),
        )
        .map((r: Record<string, unknown>) => ({
            resourceId: String(r.resourceId),
            resourceName: nonEmpty(r.resourceName) || String(r.resourceId),
            resourceType: nonEmpty(r.resourceBizType) || nonEmpty(r.resourceType) || "UNKNOWN",
            ...(nonEmpty(r.resourceBizType)
                ? { resourceBizType: nonEmpty(r.resourceBizType) }
                : {}),
            ...(nonEmpty(r.resourceCode) ? { resourceCode: nonEmpty(r.resourceCode) } : {}),
            ...(nonEmpty(r.ontologyBaseCode)
                ? { ontologyBaseCode: nonEmpty(r.ontologyBaseCode) }
                : {}),
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

    const listSkills = normalizeAgentListSkills(detail);
    const hubSkills = normalizeHubSkillRefs(detail.relSkills);
    const extraSkillPaths = normalizeExtraSkillPaths(detail.relSkills, detail.extraSkills);
    const listTools = normalizeAgentListTools(detail);

    // For NONE-type agents, do not bind model/provider from agent JSON.
    // Leave model unset so OpenClaw can use its default model configuration.
    const listEntry: AgentListEntry = {
        id: agentId,
        name,
        identity: { name },
        experimental: MANAGED_AGENT_EXPERIMENTAL,
        skills: listSkills,
        tools: listTools,
    };

    return {
        sourceKey,
        agentId,
        providerKey: "",
        modelRef: "",
        allowSpawnFrom: ["main"],
        listEntry,
        systemPrompt: instructions,
        baiyingModelId: extractBaiyingPrologueModelId(detail),
        integrationType,
        agentSseUrl,
        agentHomeUrl,
        resourceDesc: String(detail.resourceDesc),
        associatedResources: associatedResources.length > 0 ? associatedResources : undefined,
        coreCompetencies: coreCompetencies.length > 0 ? coreCompetencies : undefined,
        hubSkills: hubSkills.length > 0 ? hubSkills : undefined,
        extraSkillPaths: extraSkillPaths.length > 0 ? extraSkillPaths : undefined,
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
            typeof item.name === "string" && item.name.trim()
                ? item.name.trim()
                : `baiying-${sourceKey}`;
        const instructions =
            typeof item.instructions === "string" && item.instructions.trim()
                ? item.instructions.trim()
                : "You are a helpful assistant.";
        const agentId = `${MANAGED_AGENT_PREFIX}${sourceKey}`;
        const listEntry: AgentListEntry = {
            id: agentId,
            name,
            identity: { name },
            experimental: MANAGED_AGENT_EXPERIMENTAL,
            skills: normalizeAgentListSkills(asRecord),
        };
        const hubSkills = normalizeHubSkillRefs(asRecord.relSkills);
        const extraSkillPaths = normalizeExtraSkillPaths(asRecord.relSkills, asRecord.extraSkills);

        return {
            sourceKey,
            agentId,
            providerKey: "",
            modelRef: "",
            allowSpawnFrom: ["main"],
            listEntry,
            systemPrompt: instructions,
            hubSkills: hubSkills.length > 0 ? hubSkills : undefined,
            extraSkillPaths: extraSkillPaths.length > 0 ? extraSkillPaths : undefined,
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
            name:
                typeof native.name === "string" && native.name.trim()
                    ? native.name.trim()
                    : agentId,
        },
        experimental: MANAGED_AGENT_EXPERIMENTAL,
        skills: normalizeAgentListSkills(asRecord),
    };
    const hubSkills = normalizeHubSkillRefs(asRecord.relSkills);
    const extraSkillPaths = normalizeExtraSkillPaths(asRecord.relSkills, asRecord.extraSkills);

    return {
        sourceKey,
        agentId,
        providerKey: "",
        modelRef: "",
        allowSpawnFrom: normalizeAllowSpawnFrom(native.allowSpawnFrom),
        listEntry,
        systemPrompt,
        hubSkills: hubSkills.length > 0 ? hubSkills : undefined,
        extraSkillPaths: extraSkillPaths.length > 0 ? extraSkillPaths : undefined,
    };
}
