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
): void {
    const secretProviderName = resolveAimodelSecretProviderName(
        pluginConfig.aimodelSecretProviderName,
    );
    api.registerProvider({
        id: BAIYING_AIMODEL_PROVIDER_API,
        label: "Baiying AI Model",
        // Dynamic Baiying providers use the built-in OpenAI-compatible or Anthropic
        // transport. Route providerConfig.api through this hook, then guard inside
        // resolveSyntheticAuth so unrelated providers are left alone.
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
    });
}

export { BAIYING_AIMODEL_PROVIDER_API };
