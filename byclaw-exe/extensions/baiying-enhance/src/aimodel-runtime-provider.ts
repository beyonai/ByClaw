import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { getCachedAimodelAuthToken } from "./aimodel-auth-cache.js";
import {
    decodeBaiyingAimodelSecretRefId,
    resolveAimodelSecretProviderName,
} from "./aimodel-config.js";
import {
    BAIYING_AIMODEL_PROVIDER_API,
    MANAGED_PROVIDER_PREFIX,
    type BaiyingEnhancePluginConfig,
} from "./types.js";

type SecretRefLike = {
    source?: unknown;
    provider?: unknown;
    id?: unknown;
};

type ProviderConfigLike = {
    apiKey?: unknown;
};

function normalizeString(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveModelIdFromApiKeyRef(
    apiKey: unknown,
    expectedSecretProviderName: string,
): string | null {
    if (!apiKey || typeof apiKey !== "object") {
        return null;
    }
    const ref = apiKey as SecretRefLike;
    if (ref.source !== "exec") {
        return null;
    }
    const provider = normalizeString(ref.provider);
    if (provider && provider !== expectedSecretProviderName) {
        return null;
    }
    const id = normalizeString(ref.id);
    if (!id) {
        return null;
    }
    const modelId = decodeBaiyingAimodelSecretRefId(id);
    return modelId || null;
}

function resolveModelIdFromProviderId(providerId: string): string | null {
    const normalized = providerId.trim();
    if (!normalized.startsWith(MANAGED_PROVIDER_PREFIX)) {
        return null;
    }
    const suffix = normalized.slice(MANAGED_PROVIDER_PREFIX.length);
    if (!suffix) {
        return null;
    }
    if (suffix.startsWith("neg-")) {
        const positivePart = suffix.slice("neg-".length);
        return positivePart ? `-${positivePart}` : null;
    }
    return suffix;
}

export function registerBaiyingAimodelRuntimeProvider(
    api: OpenClawPluginApi,
    pluginConfig: BaiyingEnhancePluginConfig,
): Parameters<OpenClawPluginApi["registerProvider"]>[0] {
    const secretProviderName = resolveAimodelSecretProviderName(
        pluginConfig.aimodelSecretProviderName,
    );
    const provider: Parameters<OpenClawPluginApi["registerProvider"]>[0] = {
        id: BAIYING_AIMODEL_PROVIDER_API,
        label: "Baiying AI Model",
        // Legacy API aliases remain for auth compatibility. On 7.1 they do not
        // claim arbitrary dynamic provider IDs; targeted adapters register exact IDs.
        hookAliases: ["openai-completions", "openai-responses", "anthropic-messages"],
        auth: [],
        resolveSyntheticAuth: ({ provider, providerConfig }) => {
            const providerId = normalizeString(provider);
            if (!providerId.startsWith(MANAGED_PROVIDER_PREFIX)) {
                return undefined;
            }
            const modelId =
                resolveModelIdFromApiKeyRef(
                    (providerConfig as ProviderConfigLike | undefined)?.apiKey,
                    secretProviderName,
                ) ?? resolveModelIdFromProviderId(providerId);
            if (!modelId) {
                return undefined;
            }
            const apiKey = getCachedAimodelAuthToken(modelId);
            if (!apiKey) {
                return undefined;
            }
            return {
                apiKey,
                source: `baiying-enhance Redis authToken (${modelId})`,
                mode: "api-key" as const,
            };
        },
    };
    api.registerProvider(provider);
    return provider;
}

export { BAIYING_AIMODEL_PROVIDER_API };
