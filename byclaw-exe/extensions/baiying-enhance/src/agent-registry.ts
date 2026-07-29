import type { OpenClawConfig } from "openclaw/plugin-sdk/compat";
import type { AdaptedManagedAgent, ProviderBundle } from "./agent-adapter.js";
import {
  DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  providerKeyForBaiyingModelId,
  resolveAimodelConfigRedisKey,
  resolveAimodelSecretProviderName,
  resolveAimodelTypeListRedisKey,
} from "./aimodel-config.js";
import { MANAGED_AGENT_PREFIX, MANAGED_PROVIDER_PREFIX } from "./types.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

function defaultModelDefinition(provider: ProviderBundle) {
  return {
    id: provider.modelId,
    name: provider.modelName ?? provider.modelId,
    api: provider.api,
    reasoning: provider.reasoning ?? false,
    input: provider.input ?? (["text"] as Array<"text" | "image">),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: provider.contextWindow ?? 128000,
    maxTokens: provider.maxTokens ?? 8192,
  };
}

export type ManagedAimodel = {
  providerKey: string;
  modelRef: string;
  provider: ProviderBundle;
};

type ConfigWithSecrets = OpenClawConfig & {
  secrets?: { providers?: Record<string, unknown> };
};

function upsertAimodelSecretProvider(
  cfg: OpenClawConfig,
  params: {
    secretProviderName?: string;
    aimodelConfigRedisKey?: string;
    aimodelTypeListRedisKey?: string;
    aimodelSecretResolverCommand?: string;
    aimodelSecretResolverArgs?: string[];
  },
): void {
  const name = resolveAimodelSecretProviderName(
    params.secretProviderName ?? DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  );
  const withSecrets = cfg as ConfigWithSecrets;
  withSecrets.secrets = withSecrets.secrets ?? {};
  withSecrets.secrets.providers = withSecrets.secrets.providers ?? {};
  withSecrets.secrets.providers[name] = {
    source: "exec",
    command: params.aimodelSecretResolverCommand ?? process.execPath,
    args: params.aimodelSecretResolverArgs ?? ["aimodel-secret-resolver-cli.js"],
    passEnv: [
      "REDIS_CLUSTER_HOST",
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_DATABASE",
      "REDIS_USERNAME",
      "REDIS_PASSWORD",
      "REDIS_KEY_SCHEMA_VERSION",
      "BAIYING_ENV_FILE",
      "BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX",
      "OPENCLAW_STATE_DIR",
    ],
    env: {
      BAIYING_AIMODEL_CONFIG_REDIS_KEY: resolveAimodelConfigRedisKey(params.aimodelConfigRedisKey),
      BAIYING_AIMODEL_TYPELIST_REDIS_KEY: resolveAimodelTypeListRedisKey(params.aimodelTypeListRedisKey),
    },
    jsonOnly: true,
    allowInsecurePath: true,
    timeoutMs: 30000,
    noOutputTimeoutMs: 30000,
  };
}

function upsertAimodelProvider(
  cfg: OpenClawConfig,
  model: ManagedAimodel,
): void {
  cfg.models!.providers![model.providerKey] = {
    baseUrl: model.provider.baseUrl,
    apiKey: model.provider.apiKey,
    api: model.provider.api,
    models: [defaultModelDefinition(model.provider)],
  };
}

function syncAimodelAllowlist(
  cfg: OpenClawConfig,
  models: ManagedAimodel[],
): void {
  cfg.agents!.defaults = cfg.agents!.defaults ?? {};
  const aliases = cfg.agents!.defaults.models ?? {};
  for (const model of models) {
    aliases[model.modelRef] = { alias: model.provider.modelName ?? model.provider.modelId };
  }
  cfg.agents!.defaults.models = aliases;
}

function firstRegisteredProviderModelId(provider: unknown): string | undefined {
  if (!provider || typeof provider !== "object") return undefined;
  const candidate = provider as {
    baseUrl?: unknown;
    apiKey?: unknown;
    api?: unknown;
    models?: unknown;
  };
  const apiKey = candidate.apiKey;
  const supportedApi = ["openai-completions", "openai-responses", "anthropic-messages"].includes(
    String(candidate.api),
  );
  const usableApiKey =
    typeof apiKey === "string"
      ? Boolean(apiKey.trim())
      : Boolean(apiKey) &&
        typeof apiKey === "object" &&
        !Array.isArray(apiKey) &&
        Object.keys(apiKey).length > 0;
  if (
    typeof candidate.baseUrl !== "string" ||
    !candidate.baseUrl.trim() ||
    !supportedApi ||
    !usableApiKey
  ) {
    return undefined;
  }
  const models = candidate.models;
  if (!Array.isArray(models)) return undefined;
  for (const model of models) {
    if (!model || typeof model !== "object") continue;
    const id = (model as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

/** Merge only the dynamic model catalog, preserving all existing agents. */
export function mergeDynamicAimodelsIntoConfig(params: {
  base: OpenClawConfig;
  models: ManagedAimodel[];
  defaultModel?: ManagedAimodel | null;
  mainParentAgentId: string;
  aimodelConfigRedisKey?: string;
  aimodelTypeListRedisKey?: string;
  aimodelSecretProviderName?: string;
  aimodelSecretResolverCommand?: string;
  aimodelSecretResolverArgs?: string[];
}): OpenClawConfig {
  const cfg = structuredClone(params.base);
  if (!cfg.agents) cfg.agents = {};
  if (!cfg.models) cfg.models = {};
  if (!cfg.models.providers) cfg.models.providers = {};
  const currentKeys = new Set(params.models.map((model) => model.providerKey));
  for (const key of Object.keys(cfg.models.providers)) {
    if (key.startsWith(MANAGED_PROVIDER_PREFIX) && !currentKeys.has(key)) {
      delete cfg.models.providers[key];
    }
  }
  for (const model of params.models) upsertAimodelProvider(cfg, model);
  syncAimodelAllowlist(cfg, params.models);
  if (params.models.length > 0) upsertAimodelSecretProvider(cfg, params);
  if (params.defaultModel?.modelRef) {
    cfg.agents.defaults = cfg.agents.defaults ?? {};
    cfg.agents.defaults.model = {
      ...(cfg.agents.defaults.model ?? {}),
      primary: params.defaultModel.modelRef,
    };
    const list = cfg.agents.list ?? [];
    const mainIdx = list.findIndex((entry) => entry.id === params.mainParentAgentId);
    if (mainIdx >= 0) {
      list[mainIdx] = { ...list[mainIdx], model: { primary: params.defaultModel.modelRef } };
      cfg.agents.list = list;
    }
  }
  return cfg;
}

/**
 * Merge managed Baiying agents into a copy of the active OpenClaw config.
 * Removes prior managed entries (same id prefix / provider prefix) before applying.
 */
export function mergeManagedAgentsIntoConfig(params: {
  base: OpenClawConfig;
  managed: AdaptedManagedAgent[];
  defaultModel?: ManagedAimodel | null;
  dynamicModels?: ManagedAimodel[];
  /** Provider keys from the current valid Redis model catalog that managed agents may bind to. */
  bindableModelProviderKeys?: ReadonlySet<string>;
  mainParentAgentId: string;
  mergeAllowSpawnForMain: boolean;
  aimodelConfigRedisKey?: string;
  aimodelTypeListRedisKey?: string;
  aimodelSecretProviderName?: string;
  aimodelSecretResolverCommand?: string;
  aimodelSecretResolverArgs?: string[];
}): OpenClawConfig {
  const cfg = structuredClone(params.base);

  if (!cfg.agents) {
    cfg.agents = {};
  }
  if (!cfg.models) {
    cfg.models = {};
  }
  if (!cfg.models.providers) {
    cfg.models.providers = {};
  }

  const providers = cfg.models.providers;
  const bindableModelProviderKeys = params.bindableModelProviderKeys ?? new Set<string>();
  const existingList = cfg.agents.list ?? [];
  const existingWorkspaceById = new Map(
    existingList
      .filter((entry) => entry.id && typeof entry.workspace === "string" && entry.workspace.trim())
      .map((entry) => [entry.id!, entry.workspace!.trim()]),
  );
  const list = [...existingList].filter(
    (entry) => !entry.id?.startsWith(MANAGED_AGENT_PREFIX),
  );

  const dynamicModels = params.dynamicModels ?? (params.defaultModel ? [params.defaultModel] : undefined);
  if (dynamicModels) {
    const currentKeys = new Set(dynamicModels.map((model) => model.providerKey));
    for (const key of Object.keys(providers)) {
      if (key.startsWith(MANAGED_PROVIDER_PREFIX) && !currentKeys.has(key)) {
        delete providers[key];
      }
    }
    for (const model of dynamicModels) {
      upsertAimodelProvider(cfg, model);
    }
    syncAimodelAllowlist(cfg, dynamicModels);
    if (dynamicModels.length > 0) upsertAimodelSecretProvider(cfg, params);
  }

  for (const m of params.managed) {
    const workspaceDir =
      existingWorkspaceById.get(m.agentId) ?? resolveDefaultManagedWorkspacePath(m.agentId);
    const providerKey = m.baiyingModelId
      ? providerKeyForBaiyingModelId(m.baiyingModelId)
      : undefined;
    const modelId = providerKey && bindableModelProviderKeys.has(providerKey)
      ? firstRegisteredProviderModelId(providers[providerKey])
      : undefined;
    list.push({
      ...m.listEntry,
      workspace: workspaceDir,
      ...(providerKey && modelId ? { model: { primary: `${providerKey}/${modelId}` } } : {}),
    });
    if (m.provider && m.providerKey) {
      providers[m.providerKey] = {
        baseUrl: m.provider.baseUrl,
        apiKey: m.provider.apiKey,
        api: m.provider.api,
        models: [defaultModelDefinition(m.provider)],
      };
    }
  }

  cfg.agents.list = list;

  if (params.defaultModel?.modelRef) {
    cfg.agents.defaults = cfg.agents.defaults ?? {};
    cfg.agents.defaults.model = {
      ...(cfg.agents.defaults.model ?? {}),
      primary: params.defaultModel.modelRef,
    };
    const mainIdx = list.findIndex((a) => a.id === params.mainParentAgentId);
    if (mainIdx >= 0) {
      list[mainIdx] = {
        ...list[mainIdx],
        model: { primary: params.defaultModel.modelRef },
      };
      cfg.agents.list = list;
    }
  }

  const managedIds = params.managed.map((m) => m.agentId);
  if (params.mergeAllowSpawnForMain) {
    const mainIdx = list.findIndex((a) => a.id === params.mainParentAgentId);
    if (mainIdx >= 0) {
      const main = list[mainIdx];
      const prev = main.subagents?.allowAgents ?? [];
      // Keep non-managed entries, drop stale managed ones, add current managed ones.
      const allow = new Set(prev.filter((id) => !id.startsWith(MANAGED_AGENT_PREFIX)));
      for (const id of managedIds) {
        allow.add(id);
      }
      list[mainIdx] = {
        ...main,
        subagents: {
          ...main.subagents,
          allowAgents: Array.from(allow),
        },
      };
      cfg.agents.list = list;
    }
  }

  return cfg;
}
