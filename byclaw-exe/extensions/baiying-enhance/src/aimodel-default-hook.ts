import {
  resolveAimodelSecretProviderName,
  resolveDefaultBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

type RuntimeApi = {
  on?: (event: string, handler: (event: unknown, ctx: { agentId?: string; sessionKey?: string }) => unknown) => void;
  logger: { info: (message: string) => void; warn: (message: string) => void };
  runtime?: {
    config?: {
      current?: () => any;
      loadConfig?: () => any;
    };
  };
};

function currentConfig(api: RuntimeApi): any {
  return api.runtime?.config?.current?.() ?? api.runtime?.config?.loadConfig?.() ?? {};
}

function modelRegistered(cfg: any, providerKey: string, modelId: string): boolean {
  return Boolean(cfg.models?.providers?.[providerKey]?.models?.some((model: any) => model?.id === modelId));
}

/** Keep the main Agent's effective model aligned with the Redis default before every run. */
export function registerBaiyingDefaultModelHook(params: {
  api: RuntimeApi;
  redisJsonStore: BaiyingRedisJsonStore;
  pluginConfig: BaiyingEnhancePluginConfig;
  ensureConfig: () => Promise<void>;
}): void {
  if (typeof params.api.on !== "function") {
    params.api.logger.warn("baiying-enhance: before_model_resolve hook is unavailable; default LLM repair is startup-only");
    return;
  }
  params.api.on("before_model_resolve", async (_event, ctx) => {
    const mainAgentId = params.pluginConfig.mainParentAgentId?.trim() || "main";
    const agentId = ctx?.agentId?.trim();
    const cfg = currentConfig(params.api);
    const agentEntry = agentId
      ? cfg.agents?.list?.find((entry: any) => entry?.id === agentId)
      : undefined;
    const explicitAgentModel = Boolean(agentEntry?.model?.primary);
    if (agentId && agentId !== mainAgentId && explicitAgentModel) return undefined;

    const resolved = await resolveDefaultBaiyingAimodelProviderBundle({
      redisJsonStore: params.redisJsonStore,
      redisKey: params.pluginConfig.aimodelTypeListRedisKey,
      modelType: params.pluginConfig.aimodelTypeListField,
      secretProviderName: resolveAimodelSecretProviderName(params.pluginConfig.aimodelSecretProviderName),
      log: { warn: (message) => params.api.logger.warn(message) },
    });
    if (!resolved) return undefined;

    const configuredPrimary = cfg.agents?.defaults?.model?.primary;
    const mainEntry = cfg.agents?.list?.find((entry: any) => entry?.id === mainAgentId);
    const mainPrimary = mainEntry?.model?.primary;
    const ready = modelRegistered(cfg, resolved.providerKey, resolved.provider.modelId);
    if (!ready || configuredPrimary !== resolved.modelRef || mainPrimary !== resolved.modelRef) {
      await params.ensureConfig();
      params.api.logger.info(`baiying-enhance: repaired Redis default LLM before run: ${resolved.modelRef}`);
    }
    return {
      providerOverride: resolved.providerKey,
      modelOverride: resolved.provider.modelId,
    };
  });
}
