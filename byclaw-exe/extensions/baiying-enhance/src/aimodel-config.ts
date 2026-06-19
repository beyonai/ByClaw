import type { ProviderBundle } from "./agent-adapter.js";
import type { BaiyingRedisJsonStore, RedisJsonPayload } from "./redis-json-store.js";
import { MANAGED_PROVIDER_PREFIX } from "./types.js";

export const DEFAULT_AIMODEL_CONFIG_REDIS_KEY = "byai:aimodel:config";
export const DEFAULT_AIMODEL_SECRET_PROVIDER_NAME = "baiying-aimodel-redis";

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
    instanceParam?: unknown;
    maxContentToken?: unknown;
    modelCode?: unknown;
    modelName?: unknown;
    status?: unknown;
    url?: unknown;
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

export function resolveAimodelSecretProviderName(value: unknown): string {
    const candidate = nonEmptyString(value);
    return /^[a-z][a-z0-9_-]{0,63}$/.test(candidate)
        ? candidate
        : DEFAULT_AIMODEL_SECRET_PROVIDER_NAME;
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
    const raw = params.payload.raw as AiModelConfigRecord;
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
    return {
        baseUrl,
        apiKey: buildBaiyingAimodelSecretRef({
            modelId: params.modelId,
            secretProviderName: params.secretProviderName,
        }),
        api: "openai-completions",
        modelId: modelCode,
        modelName: nonEmptyString(raw.modelName) || modelCode,
        contextWindow: positiveInt(raw.maxContentToken) ?? 128000,
        maxTokens: positiveInt(instanceParam.maxTokens) ?? 8192,
    };
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
    const token = nonEmptyString(raw.authToken);
    return token || null;
}
