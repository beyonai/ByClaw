import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  applySessionModelFromPrimary,
  isManagedModelRegisteredInConfig,
  parseModelPrimaryRef,
} from "./agent-session-model-reconcile.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

function resolveAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const trimmed = sessionKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^agent:([^:]+):/i.exec(trimmed);
  return match?.[1]?.trim();
}

export type ManagedAgentModelResolveResult = {
  providerOverride: string;
  modelOverride: string;
};

function currentRuntimeConfig(api: OpenClawPluginApi) {
  return api.runtime.config.current?.() ?? api.runtime.config.loadConfig();
}

/**
 * Resolve the canonical managed-agent model from in-process config.
 * Used by `before_model_resolve` so each embedded run tracks Redis sync /
 * hot-reload updates even when an in-memory session snapshot is stale.
 */
export function resolveManagedAgentModelFromConfig(params: {
  cfg: {
    agents?: { list?: Array<{ id?: string; model?: { primary?: string } }> };
    models?: {
      providers?: Record<
        string,
        {
          models?: Array<{ id?: string }>;
        }
      >;
    };
  };
  agentId?: string;
}): ManagedAgentModelResolveResult | undefined {
  const agentId = params.agentId?.trim();
  if (!agentId?.startsWith(MANAGED_AGENT_PREFIX)) {
    return undefined;
  }
  const entry = params.cfg.agents?.list?.find((item) => item.id === agentId);
  const primary = entry?.model?.primary?.trim();
  if (!primary) {
    return undefined;
  }
  const parsed = parseModelPrimaryRef(primary);
  if (!parsed) {
    return undefined;
  }
  if (!isManagedModelRegisteredInConfig(params.cfg, parsed.provider, parsed.model)) {
    return undefined;
  }
  return {
    providerOverride: parsed.provider,
    modelOverride: parsed.model,
  };
}

export function buildManagedAgentRuntimeModelSystemContext(params: {
  cfg: {
    agents?: { list?: Array<{ id?: string; model?: { primary?: string } }> };
    models?: {
      providers?: Record<
        string,
        {
          models?: Array<{ id?: string; name?: string }>;
        }
      >;
    };
  };
  agentId?: string;
}): string | undefined {
  const resolved = resolveManagedAgentModelFromConfig(params);
  if (!resolved) {
    return undefined;
  }
  const modelName = params.cfg.models?.providers?.[resolved.providerOverride]?.models
    ?.find((entry) => entry?.id?.trim() === resolved.modelOverride)
    ?.name?.trim();
  const modelRef = `${resolved.providerOverride}/${resolved.modelOverride}`;
  return [
    "Baiying managed model runtime fact:",
    `- Current runtime model for this managed digital employee is ${modelRef}${modelName && modelName !== resolved.modelOverride ? ` (${modelName})` : ""}.`,
    "- If the user asks what model you are using, answer from this runtime fact.",
    "- Ignore earlier transcript self-identification if it names a different model; it may be stale after a live platform model switch.",
  ].join("\n");
}

const UNRESOLVED_SECRETREF_MARKER = "secretref-managed";

export function hasManagedModelConfigDrift(params: {
  cfg: {
    agents?: { list?: Array<{ id?: string; model?: { primary?: string } }> };
  };
  managed: Array<{ agentId: string; modelRef?: string }>;
}): boolean {
  for (const agent of params.managed) {
    const expected = agent.modelRef?.trim();
    if (!expected) {
      continue;
    }
    const entry = params.cfg.agents?.list?.find((item) => item.id === agent.agentId);
    const primary = entry?.model?.primary?.trim() ?? "";
    if (primary !== expected) {
      return true;
    }
  }
  return false;
}

function isUnresolvedProviderApiKey(apiKey: unknown): boolean {
  if (typeof apiKey === "string") {
    return apiKey.trim() === UNRESOLVED_SECRETREF_MARKER;
  }
  if (!apiKey || typeof apiKey !== "object") {
    return false;
  }
  return "source" in apiKey;
}

export function logManagedProviderRuntimeDiagnostics(params: {
  cfg: {
    models?: {
      providers?: Record<string, { models?: Array<{ id?: string }> }>;
    };
  };
  managed: Array<{ agentId: string; providerKey?: string; modelRef?: string }>;
  log: { info: (message: string) => void };
}): void {
  const providerKeys = Object.keys(params.cfg.models?.providers ?? {}).filter((key) =>
    key.startsWith("baiying-m-"),
  );
  params.log.info(
    `baiying-enhance: runtime models.providers (baiying-m-*): ${
      providerKeys.length > 0 ? providerKeys.join(", ") : "(none)"
    }`,
  );
  for (const agent of params.managed) {
    const providerKey = agent.providerKey?.trim();
    if (!providerKey) {
      params.log.info(
        `baiying-enhance: ${agent.agentId} has no managed provider (modelRef=${agent.modelRef ?? "none"})`,
      );
      continue;
    }
    const modelIds = (params.cfg.models?.providers?.[providerKey]?.models ?? [])
      .map((entry) => entry?.id?.trim())
      .filter((id): id is string => Boolean(id));
    params.log.info(
      `baiying-enhance: ${agent.agentId} expects ${agent.modelRef ?? "no model"}; runtime ${providerKey} catalog ids=[${modelIds.join(", ") || "MISSING"}]`,
    );
  }
}

export function warnUnresolvedManagedProviderApiKeysAfterSync(params: {
  cfg: {
    models?: {
      providers?: Record<string, { apiKey?: unknown }>;
    };
  };
  managed: Array<{ providerKey?: string; modelRef?: string; agentId: string }>;
  log: { warn: (message: string) => void };
}): void {
  for (const agent of params.managed) {
    const providerKey = agent.providerKey?.trim();
    if (!providerKey) {
      continue;
    }
    const provider = params.cfg.models?.providers?.[providerKey];
    if (!provider) {
      params.log.warn(
        `baiying-enhance: runtime config missing models.providers.${providerKey} after sync for ${agent.agentId} (${agent.modelRef ?? "no model"}); check config hot reload / secrets activation`,
      );
      continue;
    }
    if (isUnresolvedProviderApiKey(provider.apiKey)) {
      params.log.warn(
        `baiying-enhance: runtime secrets snapshot did not materialize apiKey for models.providers.${providerKey} (${agent.modelRef ?? "no model"}); inbound LLM calls will fail auth until gateway secrets refresh succeeds (look for SECRETS_RELOADER_DEGRADED or exec provider errors for baiying-aimodel-redis)`,
      );
    }
  }
}

export function warnUnregisteredManagedModelPrimaries(params: {
  cfg: {
    agents?: { list?: Array<{ id?: string; model?: { primary?: string } }> };
    models?: {
      providers?: Record<
        string,
        {
          models?: Array<{ id?: string }>;
        }
      >;
    };
  };
  managed: Array<{ agentId: string; listEntry: { model?: { primary?: string } } }>;
  log: { warn: (message: string) => void };
}): void {
  for (const agent of params.managed) {
    const primary = agent.listEntry.model?.primary?.trim();
    if (!primary) {
      continue;
    }
    const parsed = parseModelPrimaryRef(primary);
    if (!parsed) {
      continue;
    }
    if (isManagedModelRegisteredInConfig(params.cfg, parsed.provider, parsed.model)) {
      continue;
    }
    params.log.warn(
      `baiying-enhance: agent ${agent.agentId} model.primary=${primary} is not registered under models.providers yet (aimodel sync incomplete or config hot reload pending); inbound runs will skip forced model override until the provider exists`,
    );
  }
}

/**
 * Align one session entry with the managed agent's config primary before get-reply
 * runs. Reconcile-after-sync only touches sessions that already exist; brand-new
 * SDK/web sessions (for example byai-channel direct peers) need this per message.
 */
export async function syncManagedAgentSessionModelForInbound(params: {
  api: OpenClawPluginApi;
  sessionKey?: string;
  agentId?: string;
}): Promise<void> {
  const agentId = params.agentId?.trim() || resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId?.startsWith(MANAGED_AGENT_PREFIX)) {
    return;
  }
  const resolved = resolveManagedAgentModelFromConfig({
    cfg: currentRuntimeConfig(params.api),
    agentId,
  });
  if (!resolved) {
    return;
  }
  const sessionApi = params.api.runtime?.agent?.session;
  if (!sessionApi?.updateSessionStoreEntry || !sessionApi?.resolveStorePath) {
    return;
  }
  const cfg = currentRuntimeConfig(params.api);
  const storePath = sessionApi.resolveStorePath(cfg.session?.store, { agentId });
  const sessionKey = params.sessionKey?.trim();
  if (!storePath || !sessionKey) {
    return;
  }
  const parsed = parseModelPrimaryRef(`${resolved.providerOverride}/${resolved.modelOverride}`);
  if (!parsed) {
    return;
  }
  await sessionApi.updateSessionStoreEntry({
    storePath,
    sessionKey,
    update: async (entry) => {
      applySessionModelFromPrimary(entry as Record<string, unknown>, parsed);
    },
  });
}

export function registerManagedAgentModelHooks(api: OpenClawPluginApi): void {
  api.on("before_dispatch", async (event, ctx) => {
    const sessionKey = ctx.sessionKey?.trim() || event.sessionKey?.trim();
    await syncManagedAgentSessionModelForInbound({
      api,
      sessionKey,
      agentId: resolveAgentIdFromSessionKey(sessionKey),
    });
  });

  api.on("before_model_resolve", async (_event, ctx) => {
    const agentId = ctx.agentId?.trim();
    const resolve = () =>
      resolveManagedAgentModelFromConfig({
        cfg: currentRuntimeConfig(api),
        agentId,
      });
    const resolved = resolve();
    if (resolved) {
      return resolved;
    }
    const entry = currentRuntimeConfig(api).agents?.list?.find((item) => item.id === agentId);
    const primary = entry?.model?.primary?.trim();
    const parsed = primary ? parseModelPrimaryRef(primary) : null;
    if (!parsed || !agentId?.startsWith(MANAGED_AGENT_PREFIX)) {
      return undefined;
    }
    // Config hot reload can apply agents.list before models.providers is visible
    // to the runtime catalog; one short retry avoids Unknown model on fast follow-ups.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const retried = resolve();
    if (!retried) {
      api.logger.warn(
        `baiying-enhance: skip before_model_resolve override for ${agentId} (${primary}): models.providers entry not ready yet`,
      );
    }
    return retried;
  });

  api.on("before_prompt_build", async (_event, ctx) => {
    const agentId = ctx.agentId?.trim();
    return {
      appendSystemContext: buildManagedAgentRuntimeModelSystemContext({
        cfg: currentRuntimeConfig(api),
        agentId,
      }),
    };
  });
}
