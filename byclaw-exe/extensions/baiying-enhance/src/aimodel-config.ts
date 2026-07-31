import type {
    AimodelModelCompat,
    AimodelModelInput,
    AimodelProviderApi,
    AimodelThinkingBudgets,
    AimodelThinkingLevel,
    AimodelThinkingLevelMap,
    ProviderBundle,
} from "./agent-adapter.js";
import { rememberAimodelAuthToken } from "./aimodel-auth-cache.js";
import { decryptBaiyingAimodelAuthTokenSafely } from "./aimodel-token-crypto.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";
import { MANAGED_PROVIDER_PREFIX } from "./types.js";

export const DEFAULT_AIMODEL_CONFIG_REDIS_KEY = "byai:aimodel:config";
export const DEFAULT_AIMODEL_TYPELIST_REDIS_KEY = "byai:aimodel:typelist";
export const DEFAULT_AIMODEL_TYPELIST_FIELD = "LLM";
export const DEFAULT_AIMODEL_SECRET_PROVIDER_NAME = "baiying-aimodel-redis";
export const DEFAULT_AIMODEL_TIMEOUT_SECONDS = 600;
export const AIMODEL_TIMEOUT_ENV = "BYCLAW_LLM_IDLE_TIME";
export const AIMODEL_ABILITY_TEXT = "3";
export const AIMODEL_ABILITY_MULTIMODAL = "7";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max"]);
const THINKING_CAPABILITIES = new Set(["unsupported", "binary", "effort", "budget", "adaptive"]);
const THINKING_FORMATS = new Set([
    "auto",
    "openai",
    "qwen",
    "qwen-chat-template",
    "deepseek",
    "openrouter",
    "together",
    "zai",
    "anthropic",
]);

type LoggerLike = {
    warn: (message: string) => void;
};

type SecretRef = {
    source: "exec";
    provider: string;
    id: string;
};

type AiModelConfigRecord = {
    authToken?: unknown;
    instanceId?: unknown;
    instanceParam?: unknown;
    isDefault?: unknown;
    maxContentToken?: unknown;
    modelCode?: unknown;
    modelName?: unknown;
    modelType?: unknown;
    status?: unknown;
    url?: unknown;
};

type BaiyingReasoningConfig = {
    enabled: boolean;
    defaultLevel: AimodelThinkingLevel;
    capability: "unsupported" | "binary" | "effort" | "budget" | "adaptive";
    compatFormat: string;
    supportedEfforts?: string[];
    effortMap?: Record<string, string>;
    budgets?: AimodelThinkingBudgets;
};

function nonEmptyString(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function positiveInt(value: unknown): number | undefined {
    const n =
        typeof value === "number"
            ? value
            : typeof value === "string" && value.trim()
              ? Number(value.trim())
              : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export function resolveAimodelTimeoutSeconds(): number {
    return positiveInt(process.env[AIMODEL_TIMEOUT_ENV]) ?? DEFAULT_AIMODEL_TIMEOUT_SECONDS;
}

function normalizeLowerEnum(value: unknown, allowed: Set<string>, fallback: string): string {
    const candidate = nonEmptyString(value).toLowerCase();
    return allowed.has(candidate) ? candidate : fallback;
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value.map((item) => nonEmptyString(item).toLowerCase()).filter(Boolean);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const out: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = nonEmptyString(key).toLowerCase();
        const normalizedValue = nonEmptyString(rawValue);
        if (normalizedKey && normalizedValue) {
            out[normalizedKey] = normalizedValue;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeThinkingBudgets(value: unknown): AimodelThinkingBudgets | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const out: AimodelThinkingBudgets = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
        const level = normalizeLowerEnum(key, THINKING_LEVELS, "");
        const budget = positiveInt(rawValue);
        if (level && level !== "off" && level !== "xhigh" && level !== "adaptive" && budget) {
            out[level as keyof AimodelThinkingBudgets] = budget;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStatus(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function normalizeDefaultFlag(value: unknown): number | undefined {
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    return normalizeStatus(value);
}

function normalizeProviderKeyPart(value: string): string {
    const trimmed = value.trim();
    const withoutMinus = trimmed.startsWith("-") ? `neg-${trimmed.slice(1)}` : trimmed;
    return (
        withoutMinus
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "unknown"
    );
}

export function providerKeyForBaiyingModelId(modelId: string): string {
    return `${MANAGED_PROVIDER_PREFIX}${normalizeProviderKeyPart(modelId)}`;
}

export function encodeBaiyingAimodelSecretRefId(modelId: string): string {
    return `model:${modelId.trim()}`;
}

export function decodeBaiyingAimodelSecretRefId(id: string): string {
    const trimmed = id.trim();
    return trimmed.startsWith("model:") ? trimmed.slice("model:".length) : trimmed;
}

export function resolveAimodelConfigRedisKey(value: unknown): string {
    return nonEmptyString(value) || DEFAULT_AIMODEL_CONFIG_REDIS_KEY;
}

export function resolveAimodelTypeListRedisKey(value: unknown): string {
    return nonEmptyString(value) || DEFAULT_AIMODEL_TYPELIST_REDIS_KEY;
}

export function resolveAimodelTypeListField(value: unknown): string {
    return nonEmptyString(value).toUpperCase() || DEFAULT_AIMODEL_TYPELIST_FIELD;
}

export function resolveAimodelSecretProviderName(value: unknown): string {
    const candidate = nonEmptyString(value);
    return /^[a-z][a-z0-9_-]{0,63}$/.test(candidate)
        ? candidate
        : DEFAULT_AIMODEL_SECRET_PROVIDER_NAME;
}

function modelIdFromAimodelRecord(raw: AiModelConfigRecord): string {
    return nonEmptyString(raw.instanceId) || nonEmptyString(raw.modelCode);
}

export function normalizeAimodelAbilities(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => String(item).trim()).filter(Boolean);
}

export function resolveAimodelModelInputFromAbilities(abilities: string[]): AimodelModelInput[] {
    if (abilities.includes(AIMODEL_ABILITY_MULTIMODAL)) {
        return ["text", "image"];
    }
    return ["text"];
}

export function resolveAimodelProviderApiFromInstanceParam(
    instanceParam: Record<string, unknown>,
): AimodelProviderApi {
    const candidates = [
        nonEmptyString(instanceParam.providerName),
        nonEmptyString(instanceParam.modelProtocol),
    ];
    for (const candidate of candidates) {
        const normalized = candidate.toLowerCase();
        if (normalized === "anthropic") {
            return "anthropic-messages";
        }
        if (
            normalized === "openai-responses" ||
            normalized === "openai responses" ||
            normalized === "responses"
        ) {
            return "openai-responses";
        }
        if (normalized === "openai") {
            return "openai-completions";
        }
    }
    return "openai-completions";
}

function parseReasoningConfig(instanceParam: Record<string, unknown>): BaiyingReasoningConfig {
    const raw =
        instanceParam.reasoningConfig &&
        typeof instanceParam.reasoningConfig === "object" &&
        !Array.isArray(instanceParam.reasoningConfig)
            ? (instanceParam.reasoningConfig as Record<string, unknown>)
            : {};
    const capability = normalizeLowerEnum(raw.capability, THINKING_CAPABILITIES, "unsupported") as
        | "unsupported"
        | "binary"
        | "effort"
        | "budget"
        | "adaptive";
    const enabled = Boolean(raw.enabled) && capability !== "unsupported";
    return {
        enabled,
        defaultLevel: (enabled
            ? normalizeLowerEnum(raw.defaultLevel, THINKING_LEVELS, "medium")
            : "off") as AimodelThinkingLevel,
        capability,
        compatFormat: normalizeLowerEnum(raw.compatFormat, THINKING_FORMATS, "auto"),
        supportedEfforts: normalizeStringArray(raw.supportedEfforts),
        effortMap: normalizeStringMap(raw.effortMap),
        budgets: normalizeThinkingBudgets(raw.budgets),
    };
}

function inferThinkingFormat(params: {
    api: AimodelProviderApi;
    baseUrl: string;
    modelId: string;
    providerName?: unknown;
    modelProtocol?: unknown;
    configuredFormat: string;
}): string | undefined {
    if (params.configuredFormat && params.configuredFormat !== "auto") {
        return params.configuredFormat;
    }
    const haystack = [
        params.baseUrl,
        params.modelId,
        nonEmptyString(params.providerName),
        nonEmptyString(params.modelProtocol),
    ]
        .join(" ")
        .toLowerCase();
    if (params.api === "anthropic-messages" || haystack.includes("anthropic") || haystack.includes("claude")) {
        return "anthropic";
    }
    if (haystack.includes("deepseek")) {
        return "deepseek";
    }
    if (haystack.includes("qwen") || haystack.includes("dashscope")) {
        return "qwen";
    }
    if (haystack.includes("openrouter")) {
        return "openrouter";
    }
    if (haystack.includes("together")) {
        return "together";
    }
    if (haystack.includes("zai") || haystack.includes("glm")) {
        return "zai";
    }
    return params.api === "openai-completions" || params.api === "openai-responses" ? "openai" : undefined;
}

function defaultEffortMapForFormat(format?: string): Record<string, string> | undefined {
    if (format !== "deepseek") {
        return undefined;
    }
    return {
        minimal: "high",
        low: "high",
        medium: "high",
        high: "high",
        adaptive: "high",
        xhigh: "max",
        max: "max",
    };
}

function defaultSupportedEffortsForFormat(format?: string): string[] | undefined {
    if (format === "deepseek") {
        return ["high", "max"];
    }
    return undefined;
}

function resolveReasoningModelOptions(params: {
    api: AimodelProviderApi;
    baseUrl: string;
    modelId: string;
    instanceParam: Record<string, unknown>;
}): Pick<ProviderBundle, "reasoning" | "thinkingLevelMap" | "thinkingBudgets" | "compat"> {
    const config = parseReasoningConfig(params.instanceParam);
    if (!config.enabled || config.defaultLevel === "off") {
        return { reasoning: false };
    }
    const format = inferThinkingFormat({
        api: params.api,
        baseUrl: params.baseUrl,
        modelId: params.modelId,
        providerName: params.instanceParam.providerName,
        modelProtocol: params.instanceParam.modelProtocol,
        configuredFormat: config.compatFormat,
    });
    const thinkingLevelMap: AimodelThinkingLevelMap = {
        off: config.defaultLevel,
    };
    const effortMap = config.effortMap ?? defaultEffortMapForFormat(format);
    const supportedReasoningEfforts =
        config.supportedEfforts ?? defaultSupportedEffortsForFormat(format);
    const compat: AimodelModelCompat = {};
    if (format && format !== "anthropic") {
        compat.thinkingFormat = format;
    }
    if (supportedReasoningEfforts?.length) {
        compat.supportedReasoningEfforts = supportedReasoningEfforts;
    }
    if (effortMap && Object.keys(effortMap).length > 0) {
        compat.reasoningEffortMap = effortMap;
    }
    return {
        reasoning: true,
        thinkingLevelMap,
        thinkingBudgets: config.budgets,
        compat: Object.keys(compat).length > 0 ? compat : undefined,
    };
}

function parseBaiyingAimodelProviderBundleFromRecord(params: {
    raw: AiModelConfigRecord;
    modelId: string;
    secretProviderName: string;
}): ProviderBundle | null {
    const raw = params.raw;
    if (normalizeStatus(raw.status) !== 1) {
        return null;
    }
    const baseUrl = nonEmptyString(raw.url);
    const modelCode = nonEmptyString(raw.modelCode);
    const authToken = nonEmptyString(raw.authToken);
    if (!baseUrl || !modelCode || !authToken) {
        return null;
    }
    const instanceParam =
        raw.instanceParam && typeof raw.instanceParam === "object"
            ? (raw.instanceParam as Record<string, unknown>)
            : {};
    const abilities = normalizeAimodelAbilities(instanceParam.abilities);
    const api = resolveAimodelProviderApiFromInstanceParam(instanceParam);
    return {
        baseUrl,
        apiKey: buildBaiyingAimodelSecretRef({
            modelId: params.modelId,
            secretProviderName: params.secretProviderName,
        }),
        api,
        timeoutSeconds: resolveAimodelTimeoutSeconds(),
        modelId: modelCode,
        modelName: nonEmptyString(raw.modelName) || modelCode,
        contextWindow: positiveInt(raw.maxContentToken) ?? 128000,
        maxTokens: positiveInt(instanceParam.maxTokens) ?? 8192,
        input: resolveAimodelModelInputFromAbilities(abilities),
        ...resolveReasoningModelOptions({
            api,
            baseUrl,
            modelId: modelCode,
            instanceParam,
        }),
    };
}

export function buildBaiyingAimodelSecretRef(params: {
    modelId: string;
    secretProviderName: string;
}): SecretRef {
    return {
        source: "exec",
        provider: resolveAimodelSecretProviderName(params.secretProviderName),
        id: encodeBaiyingAimodelSecretRefId(params.modelId),
    };
}

export function parseBaiyingAimodelProviderBundle(params: {
    payload: RedisJsonPayload;
    modelId: string;
    secretProviderName: string;
}): ProviderBundle | null {
    if (!params.payload.raw || typeof params.payload.raw !== "object") {
        return null;
    }
    return parseBaiyingAimodelProviderBundleFromRecord({
        raw: params.payload.raw as AiModelConfigRecord,
        modelId: params.modelId,
        secretProviderName: params.secretProviderName,
    });
}

export async function resolveBaiyingAimodelProviderBundle(params: {
    redisJsonStore: BaiyingRedisJsonStore;
    modelId: string;
    redisKey: string;
    secretProviderName: string;
    log: LoggerLike;
}): Promise<{
    providerKey: string;
    modelRef: string;
    provider: ProviderBundle;
    hash: string;
} | null> {
    const modelId = params.modelId.trim();
    if (!modelId) {
        return null;
    }
    const payload = await params.redisJsonStore.getHashJson?.({
        key: resolveAimodelConfigRedisKey(params.redisKey),
        field: modelId,
    });
    if (!payload) {
        params.log.warn(
            `baiying-enhance: Redis AI model config missing/unreadable modelId=${modelId}`,
        );
        return null;
    }
    const provider = parseBaiyingAimodelProviderBundle({
        payload,
        modelId,
        secretProviderName: params.secretProviderName,
    });
    if (!provider) {
        params.log.warn(`baiying-enhance: Redis AI model config invalid modelId=${modelId}`);
        return null;
    }
    rememberAimodelAuthToken({
        modelId,
        token: readAuthTokenFromAimodelPayload(payload),
    });
    const providerKey = providerKeyForBaiyingModelId(modelId);
    return {
        providerKey,
        modelRef: `${providerKey}/${provider.modelId}`,
        provider,
        hash: payload.hash,
    };
}

export async function resolveDefaultBaiyingAimodelProviderBundle(params: {
    redisJsonStore: BaiyingRedisJsonStore;
    redisKey?: string;
    modelType?: string;
    secretProviderName: string;
    log: LoggerLike;
}): Promise<{
    providerKey: string;
    modelRef: string;
    provider: ProviderBundle;
    hash: string;
} | null> {
    const redisKey = resolveAimodelTypeListRedisKey(params.redisKey);
    const typelistField = resolveAimodelTypeListField(params.modelType);
    const payload = await params.redisJsonStore.getHashJson?.({
        key: redisKey,
        field: typelistField,
    });
    if (!payload) {
        params.log.warn(
            `baiying-enhance: Redis AI model typelist missing/unreadable key=${redisKey} field=${typelistField}`,
        );
        return null;
    }
    if (!Array.isArray(payload.raw)) {
        params.log.warn(
            `baiying-enhance: Redis AI model typelist invalid key=${redisKey} field=${typelistField}`,
        );
        return null;
    }
    const records = payload.raw.filter(
        (item): item is AiModelConfigRecord => item && typeof item === "object",
    );
    const isUsableModelType = (record: AiModelConfigRecord): boolean => {
        const recordModelType = resolveAimodelTypeListField(record.modelType);
        return (
            normalizeStatus(record.status) === 1 &&
            (recordModelType === typelistField ||
                (!nonEmptyString(record.modelType) && typelistField === DEFAULT_AIMODEL_TYPELIST_FIELD))
        );
    };
    const usable = records.filter(isUsableModelType);
    // Prefer the explicit Redis default marker; fall back to list order only for legacy payloads.
    const defaultMarked = usable.filter(
        (record) => normalizeDefaultFlag(record.isDefault) === 1,
    );
    const selected = defaultMarked[0] ?? usable[0];
    const defaultMarkedCount = defaultMarked.length;
    if (defaultMarkedCount > 1) {
        params.log.warn(
            `baiying-enhance: Redis ${typelistField} typelist has ${defaultMarkedCount} models with isDefault=1; default is taken from the first marked entry. Re-save default in manager or restart byclaw-be to sync typelist.`,
        );
    }
    if (selected && usable[0] && selected !== usable[0]) {
        params.log.warn(
            `baiying-enhance: Redis ${typelistField} typelist first entry (${modelIdFromAimodelRecord(usable[0]) || "?"}) is not isDefault=1; selecting marked default ${modelIdFromAimodelRecord(selected) || "?"}. Typelist order may be stale.`,
        );
    } else if (selected && normalizeDefaultFlag(selected.isDefault) !== 1) {
        params.log.warn(
            `baiying-enhance: Redis ${typelistField} typelist has no isDefault=1 entry; falling back to first usable model (${modelIdFromAimodelRecord(selected) || "?"}).`,
        );
    }
    if (!selected) {
        params.log.warn(
            `baiying-enhance: Redis AI model typelist has no active ${typelistField} model key=${redisKey} field=${typelistField}`,
        );
        return null;
    }
    const modelId = modelIdFromAimodelRecord(selected);
    if (!modelId) {
        params.log.warn(
            `baiying-enhance: Redis AI model typelist default ${typelistField} missing instanceId/modelCode key=${redisKey}`,
        );
        return null;
    }
    const provider = parseBaiyingAimodelProviderBundleFromRecord({
        raw: selected,
        modelId,
        secretProviderName: params.secretProviderName,
    });
    if (!provider) {
        params.log.warn(
            `baiying-enhance: Redis AI model typelist default ${typelistField} invalid modelId=${modelId}`,
        );
        return null;
    }
    rememberAimodelAuthToken({
        modelId,
        token: readAuthTokenFromAimodelTypeListPayload(payload, modelId),
    });
    const providerKey = providerKeyForBaiyingModelId(modelId);
    return {
        providerKey,
        modelRef: `${providerKey}/${provider.modelId}`,
        provider,
        hash: payload.hash,
    };
}

export function readAuthTokenFromAimodelPayload(payload: RedisJsonPayload | null): string | null {
    if (!payload?.raw || typeof payload.raw !== "object") {
        return null;
    }
    const raw = payload.raw as AiModelConfigRecord;
    if (normalizeStatus(raw.status) !== 1) {
        return null;
    }
    const token = decryptBaiyingAimodelAuthTokenSafely(nonEmptyString(raw.authToken));
    return token || null;
}

export function readAuthTokenFromAimodelTypeListPayload(
    payload: RedisJsonPayload | null,
    modelId: string,
): string | null {
    const target = modelId.trim();
    if (!target || !Array.isArray(payload?.raw)) {
        return null;
    }
    for (const item of payload.raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const raw = item as AiModelConfigRecord;
        if (modelIdFromAimodelRecord(raw) !== target) {
            continue;
        }
        if (normalizeStatus(raw.status) !== 1) {
            return null;
        }
        const token = decryptBaiyingAimodelAuthTokenSafely(nonEmptyString(raw.authToken));
        return token || null;
    }
    return null;
}
