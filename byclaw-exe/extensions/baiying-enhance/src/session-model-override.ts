import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { hasManagedProviderConfigDrift, mergeAimodelProviderIntoConfig } from "./agent-registry.js";
import {
    resolveAimodelConfigRedisKey,
    resolveAimodelSecretProviderName,
    resolveBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";
import { mutateOpenClawConfigFile } from "./config-writer.js";
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

function readString(raw: unknown, key: string): string {
    if (!raw || typeof raw !== "object") {
        return "";
    }
    const value = (raw as Record<string, unknown>)[key];
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
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
    if (!hasManagedProviderConfigDrift(cfg, bundle.providerKey, bundle.provider)) {
        return { providerKey: bundle.providerKey, modelRef: bundle.modelRef, model: bundle.provider.modelId };
    }
    await mutateOpenClawConfigFile(params.api, (base) =>
        mergeAimodelProviderIntoConfig({
            base,
            providerKey: bundle.providerKey,
            provider: bundle.provider,
            aimodelConfigRedisKey: params.pluginConfig.aimodelConfigRedisKey,
            aimodelTypeListRedisKey: params.pluginConfig.aimodelTypeListRedisKey,
            aimodelSecretProviderName: params.pluginConfig.aimodelSecretProviderName,
            aimodelSecretResolverCommand: process.execPath,
            aimodelSecretResolverArgs: [
                params.aimodelSecretResolverScriptPath ?? "aimodel-secret-resolver-cli.js",
            ],
        }),
    );
    // Same provider/model IDs can still carry stale window and reasoning values.
    // Do not let a dispatch capture the previous runtime snapshot after writing.
    const deadline = Date.now() + 3000;
    for (;;) {
        const current = currentRuntimeConfig(params.api);
        if (!hasManagedProviderConfigDrift(current, bundle.providerKey, bundle.provider)) break;
        if (Date.now() >= deadline) throw new Error("Session model configuration reload timed out");
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    params.log.info?.(
        `baiying-enhance: registered session model override provider ${bundle.modelRef} for sessionId=${sessionId}`,
    );
    return {
        providerKey: bundle.providerKey,
        modelRef: bundle.modelRef,
        model: bundle.provider.modelId,
    };
}
