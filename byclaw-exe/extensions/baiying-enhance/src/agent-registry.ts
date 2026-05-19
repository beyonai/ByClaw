import type { OpenClawConfig } from "openclaw/plugin-sdk/compat";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { MANAGED_AGENT_PREFIX, MANAGED_PROVIDER_PREFIX } from "./types.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

function defaultModelDefinition(modelId: string) {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions" as const,
    reasoning: false,
    input: ["text"] as Array<"text" | "image">,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 8192,
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
  const list = [...existingList].filter(
    (entry) => !entry.id?.startsWith(MANAGED_AGENT_PREFIX),
  );

  for (const key of Object.keys(providers)) {
    if (key.startsWith(MANAGED_PROVIDER_PREFIX)) {
      delete providers[key];
    }
  }

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
        models: [defaultModelDefinition(m.provider.modelId)],
      };
    }
  }

  cfg.agents.list = list;

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
