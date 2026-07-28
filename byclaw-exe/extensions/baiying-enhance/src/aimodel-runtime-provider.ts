import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { getCachedAimodelAuthToken } from "./aimodel-auth-cache.js";
import {
  decodeBaiyingAimodelSecretRefId,
  resolveAimodelSecretProviderName,
} from "./aimodel-config.js";
import { MANAGED_PROVIDER_PREFIX, type BaiyingEnhancePluginConfig } from "./types.js";

export const BAIYING_AIMODEL_PROVIDER_API = "baiying-dynamic";

function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveModelIdFromProvider(provider: string): string | null {
  const value = provider.trim();
  if (!value.startsWith(MANAGED_PROVIDER_PREFIX)) return null;
  const suffix = value.slice(MANAGED_PROVIDER_PREFIX.length);
  if (!suffix) return null;
  return suffix.startsWith("neg-") ? `-${suffix.slice("neg-".length)}` : suffix;
}

function resolveModelIdFromSecretRef(apiKey: unknown, secretProviderName: string): string | null {
  if (!apiKey || typeof apiKey !== "object") return null;
  const ref = apiKey as { source?: unknown; provider?: unknown; id?: unknown };
  if (ref.source !== "exec") return null;
  const provider = text(ref.provider);
  if (provider && provider !== secretProviderName) return null;
  const id = text(ref.id);
  return id ? decodeBaiyingAimodelSecretRefId(id) : null;
}

/** Register runtime authentication for dynamically generated Baiying providers. */
export function registerBaiyingAimodelRuntimeProvider(
  api: OpenClawPluginApi,
  pluginConfig: BaiyingEnhancePluginConfig,
): void {
  const registerProvider = (api as unknown as {
    registerProvider?: (provider: unknown) => void;
  }).registerProvider;
  if (typeof registerProvider !== "function") {
    api.logger.warn("baiying-enhance: OpenClaw runtime does not expose registerProvider; dynamic model auth is disabled");
    return;
  }
  const secretProviderName = resolveAimodelSecretProviderName(pluginConfig.aimodelSecretProviderName);
  registerProvider.call(api, {
    id: BAIYING_AIMODEL_PROVIDER_API,
    label: "Baiying AI Model",
    hookAliases: ["openai-completions", "openai-responses", "anthropic-messages"],
    auth: [],
    resolveSyntheticAuth: ({ provider, providerConfig }: { provider: unknown; providerConfig?: { apiKey?: unknown } }) => {
      const providerId = text(provider);
      if (!providerId.startsWith(MANAGED_PROVIDER_PREFIX)) return undefined;
      const modelId = resolveModelIdFromSecretRef(providerConfig?.apiKey, secretProviderName) ?? resolveModelIdFromProvider(providerId);
      const apiKey = modelId ? getCachedAimodelAuthToken(modelId) : null;
      return apiKey ? { apiKey, source: `baiying-enhance Redis authToken (${modelId})`, mode: "api-key" } : undefined;
    },
  });
}
