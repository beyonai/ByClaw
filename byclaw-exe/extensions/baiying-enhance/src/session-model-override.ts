import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
    resolveAimodelConfigRedisKey,
    resolveAimodelSecretProviderName,
    resolveBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";
import { getSharedRedisJsonStore, type RedisJsonPayload } from "./redis-json-store.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

/**
 * 会话级模型覆盖键：由 ByClaw BE 在每轮对话解析出有效选择后写入，
 * 值为 `{modelId, modelCode, modelName, providerName}` 的 JSON。
 */
export const SESSION_MODEL_OVERRIDE_KEY_PREFIX = "byai:chat:session_model:";

type LoggerLike = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
};

/** 会话级模型覆盖解析结果：可直接用于会话条目的 provider/model 对齐。 */
export type SessionModelOverrideRef = {
    providerKey: string;
    modelRef: string;
    model: string;
};

export function sessionModelOverrideRedisKey(sessionId: string): string {
    return `${SESSION_MODEL_OVERRIDE_KEY_PREFIX}${sessionId.trim()}`;
}
function currentRuntimeConfig(api: OpenClawPluginApi): OpenClawConfig {
    return api.runtime.config.current?.() ?? api.runtime.config.loadConfig();
}

type SessionModelEnsurer = (modelId: string, options?: { forceRefresh?: boolean; refreshDesired?: boolean }) => Promise<void>;
let sessionModelEnsurer: SessionModelEnsurer | undefined;
const preparedModelIds = new Set<string>();

function providerHasModel(cfg: OpenClawConfig, providerKey: string, modelId: string): boolean {
    return Boolean(cfg.models?.providers?.[providerKey]?.models?.some((model) => model.id === modelId));
}

export function resetSessionModelSyncStateForTests(): void {
    sessionModelEnsurer = undefined;
    preparedModelIds.clear();
}

export function setSessionModelEnsurer(ensurer: SessionModelEnsurer | undefined): void {
    sessionModelEnsurer = ensurer;
}

function readString(raw: unknown, key: string): string {
    if (!raw || typeof raw !== "object") {
        return "";
    }
    const value = (raw as Record<string, unknown>)[key];
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function sessionSelectionChanged(before: RedisJsonPayload | null, after: RedisJsonPayload | null): boolean {
    return readString(before?.raw, "revision") !== readString(after?.raw, "revision")
        || readString(before?.raw, "modelId") !== readString(after?.raw, "modelId");
}

async function resolveLatestAfterEnsure(
    params: Parameters<typeof resolveSessionModelOverride>[0],
    before: RedisJsonPayload | null,
    resolved: SessionModelOverrideRef,
): Promise<SessionModelOverrideRef | undefined> {
    const after = await readOverridePayload({ sessionId: params.sessionId!.trim(), log: params.log });
    if (!sessionSelectionChanged(before, after)) return resolved;
    return resolveSessionModelOverride(params);
}

async function readOverridePayload(params: {
    sessionId: string;
    log: LoggerLike;
}): Promise<RedisJsonPayload | null> {
    const store = getSharedRedisJsonStore({ logger: params.log });
    try {
        return await store.getJsonByKey(sessionModelOverrideRedisKey(params.sessionId));
    } catch (error) {
        params.log.warn?.(
            `baiying-enhance: session model override read failed, sessionId=${params.sessionId}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        return null;
    }
}

/**
 * 解析本会话的用户选择模型，必要时把它的 provider 注册进运行时配置。
 *
 * <p>返回 undefined 表示没有会话覆盖或覆盖不可用，调用方应回退到数字员工配置模型。
 */
export async function resolveSessionModelOverride(params: {
    api: OpenClawPluginApi;
    pluginConfig: BaiyingEnhancePluginConfig;
    sessionId?: string;
    aimodelSecretResolverScriptPath?: string;
    log: LoggerLike;
    /** Pub/Sub model-change events set this so same-ID Redis parameter edits use the canonical reload path. */
    forceModelSync?: boolean;
    /** Re-read the authoritative Redis model bundle, but write only when hash/fingerprint changed. */
    refreshModelConfig?: boolean;
    /** Hook fast path: resolve an already prepared provider without reading the model-config hash. */
    prepareModelConfig?: boolean;
}): Promise<SessionModelOverrideRef | undefined> {
    const sessionId = params.sessionId?.trim();
    if (!sessionId) {
        return undefined;
    }
    const payload = await readOverridePayload({ sessionId, log: params.log });
    const modelId = readString(payload?.raw, "modelId");
    if (!modelId) {
        return undefined;
    }

    if (params.prepareModelConfig === false) {
        const modelCode = readString(payload?.raw, "modelCode");
        const providerKey = `baiying-m-${modelId}`;
        if (!modelCode || !providerHasModel(currentRuntimeConfig(params.api), providerKey, modelCode)) {
            return undefined;
        }
        return { providerKey, modelRef: `${providerKey}/${modelCode}`, model: modelCode };
    }

    const selectedModelCode = readString(payload?.raw, "modelCode");
    const selectedProviderKey = `baiying-m-${modelId}`;
    if (!params.forceModelSync && !params.refreshModelConfig && preparedModelIds.has(modelId) && selectedModelCode
        && providerHasModel(currentRuntimeConfig(params.api), selectedProviderKey, selectedModelCode)) {
        return { providerKey: selectedProviderKey, modelRef: `${selectedProviderKey}/${selectedModelCode}`, model: selectedModelCode };
    }

    const redisJsonStore = getSharedRedisJsonStore({ logger: params.log });
    const bundle = await resolveBaiyingAimodelProviderBundle({
        redisJsonStore,
        modelId,
        redisKey: resolveAimodelConfigRedisKey(params.pluginConfig.aimodelConfigRedisKey),
        secretProviderName: resolveAimodelSecretProviderName(params.pluginConfig.aimodelSecretProviderName),
        log: { warn: (message) => params.log.warn?.(message), info: (message) => params.log.info?.(message) },
    });
    if (!bundle) {
        params.log.warn?.(
            `baiying-enhance: session model override unavailable, sessionId=${sessionId}, modelId=${modelId}; falling back to agent model`,
        );
        return undefined;
    }
    const cfg = currentRuntimeConfig(params.api);
    if (!params.forceModelSync && !params.refreshModelConfig
        && providerHasModel(cfg, bundle.providerKey, bundle.provider.modelId)) {
        // Register the dependency with the canonical watchdog even when no reload is needed;
        // otherwise a later managed-agent merge could prune this session-only provider.
        await sessionModelEnsurer?.(modelId);
        preparedModelIds.add(modelId);
        return resolveLatestAfterEnsure(params, payload, {
            providerKey: bundle.providerKey, modelRef: bundle.modelRef, model: bundle.provider.modelId,
        });
    }
    if (!sessionModelEnsurer) {
        params.log.warn?.(`baiying-enhance: session model sync coordinator unavailable, modelId=${modelId}`);
        return undefined;
    }
    await sessionModelEnsurer(modelId, {
        forceRefresh: params.forceModelSync === true,
        refreshDesired: params.refreshModelConfig === true,
    });
    preparedModelIds.add(modelId);
    // The watchdog owns the native config mutation and its afterWrite reload policy.
    // Its ensure promise drains the exact queued flush that covers this dependency;
    // no hook polls a plugin instance that may be replaced by hot reload.
    params.log.info?.(
        `baiying-enhance: registered session model override provider ${bundle.modelRef} for sessionId=${sessionId}`,
    );
    return resolveLatestAfterEnsure(params, payload, {
        providerKey: bundle.providerKey,
        modelRef: bundle.modelRef,
        model: bundle.provider.modelId,
    });
}
