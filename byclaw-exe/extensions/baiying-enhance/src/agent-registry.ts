import type { OpenClawConfig } from "openclaw/plugin-sdk/compat";
import type { AdaptedManagedAgent, ProviderBundle } from "./agent-adapter.js";
import {
  DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  resolveAimodelConfigRedisKey,
  resolveAimodelSecretProviderName,
} from "./aimodel-config.js";
import { MANAGED_AGENT_PREFIX, MANAGED_PROVIDER_PREFIX } from "./types.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

type SecretProviderConfig = {
  source: "exec";
  command: string;
  args: string[];
  passEnv: string[];
  env: Record<string, string>;
  jsonOnly: true;
  allowInsecurePath: true;
  timeoutMs: number;
};

type ConfigWithSecrets = OpenClawConfig & {
  secrets?: {
    providers?: Record<string, unknown>;
  };
};

function defaultModelDefinition(provider: ProviderBundle) {
  return {
    id: provider.modelId,
    name: provider.modelName ?? provider.modelId,
    api: "openai-completions" as const,
    reasoning: false,
    input: ["text"] as Array<"text" | "image">,
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

function buildAimodelSecretProviderConfig(params: {
  command: string;
  args: string[];
  redisKey: string;
}): SecretProviderConfig {
  return {
    source: "exec",
    command: params.command,
    args: params.args,
    passEnv: [
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_USERNAME",
      "REDIS_PASSWORD",
      "REDIS_DATABASE",
      "BAIYING_ENV_FILE",
      "OPENCLAW_STATE_DIR",
      "BAIYING_REDIS_JSON_CONNECT_TIMEOUT_MS",
      "BAIYING_REDIS_JSON_RETRY_DELAY_MS",
    ],
    env: {
      BAIYING_AIMODEL_CONFIG_REDIS_KEY: params.redisKey,
    },
    jsonOnly: true,
    allowInsecurePath: true,
    timeoutMs: 5000,
  };
}

/**
 * Merge managed Baiying agents into a copy of the active OpenClaw config.
 * Removes prior managed entries (same id prefix / provider prefix) before applying.
 */
export function mergeManagedAgentsIntoConfig(params: {
  base: OpenClawConfig;
  managed: AdaptedManagedAgent[];
  mainParentAgentId: string;
  mergeAllowSpawnForMain: boolean;
  aimodelConfigRedisKey?: string;
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
  const existingList = cfg.agents.list ?? [];
  const existingWorkspaceById = new Map(
    existingList
      .filter((entry) => entry.id && typeof entry.workspace === "string" && entry.workspace.trim())
      .map((entry) => [entry.id!, entry.workspace!.trim()]),
  );
  const list = [...existingList].filter((entry) => !entry.id?.startsWith(MANAGED_AGENT_PREFIX));

  for (const key of Object.keys(providers)) {
    if (key.startsWith(MANAGED_PROVIDER_PREFIX)) {
      delete providers[key];
    }
  }

  const secretProviderName = resolveAimodelSecretProviderName(
    params.aimodelSecretProviderName ?? DEFAULT_AIMODEL_SECRET_PROVIDER_NAME,
  );
  const hasManagedProviders = params.managed.some((m) => m.provider && m.providerKey);

  for (const m of params.managed) {
    const workspaceDir =
      existingWorkspaceById.get(m.agentId) ?? resolveDefaultManagedWorkspacePath(m.agentId);
    list.push({
      ...m.listEntry,
      workspace: workspaceDir,
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

  const cfgWithSecrets = cfg as ConfigWithSecrets;
  if (hasManagedProviders) {
    if (!cfgWithSecrets.secrets) {
      cfgWithSecrets.secrets = {};
    }
    if (!cfgWithSecrets.secrets.providers) {
      cfgWithSecrets.secrets.providers = {};
    }
    cfgWithSecrets.secrets.providers[secretProviderName] = buildAimodelSecretProviderConfig({
      command: params.aimodelSecretResolverCommand ?? process.execPath,
      args: params.aimodelSecretResolverArgs ?? ["aimodel-secret-resolver-cli.js"],
      redisKey: resolveAimodelConfigRedisKey(params.aimodelConfigRedisKey),
    });
  } else if (cfgWithSecrets.secrets?.providers) {
    delete cfgWithSecrets.secrets.providers[secretProviderName];
  }

  cfg.agents.list = list;
  syncManagedModelsToAgentsDefaults(cfg, params.managed);

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

/**
 * Register each managed agent's `model.primary` in `agents.defaults.models` so
 * OpenClaw allowlist / `/model` paths accept dynamic baiying-m-* providers.
 */
function syncManagedModelsToAgentsDefaults(
  cfg: OpenClawConfig,
  managed: AdaptedManagedAgent[],
): void {
  if (!cfg.agents) {
    cfg.agents = {};
  }
  if (!cfg.agents.defaults) {
    cfg.agents.defaults = {};
  }
  const existing = cfg.agents.defaults.models ?? {};
  const next: Record<string, { alias?: string }> = {
    ...existing,
  };
  for (const m of managed) {
    const primary = m.listEntry.model?.primary?.trim() || m.modelRef?.trim() || "";
    if (!primary || primary in next) {
      continue;
    }
    const alias =
      m.listEntry.name?.trim() ||
      (typeof m.listEntry.identity === "object" &&
      m.listEntry.identity &&
      "name" in m.listEntry.identity &&
      typeof m.listEntry.identity.name === "string"
        ? m.listEntry.identity.name.trim()
        : "");
    next[primary] = alias ? { alias } : {};
  }
  cfg.agents.defaults.models = next;
}
