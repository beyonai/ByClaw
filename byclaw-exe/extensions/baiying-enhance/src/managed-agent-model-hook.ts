import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { AimodelDefaultRunSyncDeps } from "./aimodel-default-run-sync.js";
import {
    buildMainDefaultAimodelRuntimeSystemContext,
    resolveMainDefaultAimodelOnAgentRun,
} from "./aimodel-default-run-sync.js";
import {
    applySessionModelFromPrimary,
    isManagedModelRegisteredInConfig,
    parseModelPrimaryRef,
} from "./agent-session-model-reconcile.js";
import { resolveAgentIdFromSessionKey } from "./session-agent-id.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

export { resolveAgentIdFromSessionKey } from "./session-agent-id.js";

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

function sameResolvedModel(
  a: ManagedAgentModelResolveResult | undefined,
  b: ManagedAgentModelResolveResult | undefined,
): boolean {
  return Boolean(
    a &&
      b &&
      a.providerOverride === b.providerOverride &&
      a.modelOverride === b.modelOverride,
  );
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
  currentProvider?: string;
  currentModel?: string;
}): string | undefined {
  const resolved = resolveManagedAgentModelFromConfig(params);
  if (!resolved) {
    return undefined;
  }
  if (
    shouldDeferManagedAgentModelOverrideForRun({
      resolved,
      currentProvider: params.currentProvider,
      currentModel: params.currentModel,
    })
  ) {
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

export function shouldDeferManagedAgentModelOverrideForRun(params: {
  resolved: ManagedAgentModelResolveResult;
  currentProvider?: string;
  currentModel?: string;
}): boolean {
  const currentProvider = params.currentProvider?.trim();
  const currentModel = params.currentModel?.trim();
  if (!currentProvider || !currentModel) {
    return false;
  }
  if (!currentProvider.startsWith("baiying-m-")) {
    return false;
  }
  return (
    currentProvider !== params.resolved.providerOverride ||
    currentModel !== params.resolved.modelOverride
  );
}

const UNRESOLVED_SECRETREF_MARKER = "secretref-managed";
const MAIN_INBOUND_DEFAULT_MODEL_RUNTIME_WAIT_MS = 5000;
const MANAGED_INBOUND_MODEL_RUNTIME_WAIT_MS = 15000;
const INBOUND_MODEL_RUNTIME_POLL_MS = 100;

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

function isBaiyingAimodelSecretRef(apiKey: unknown): boolean {
  if (!apiKey || typeof apiKey !== "object") {
    return false;
  }
  const ref = apiKey as { source?: unknown; id?: unknown };
  return ref.source === "exec" && typeof ref.id === "string" && ref.id.trim().startsWith("model:");
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
      providers?: Record<string, { api?: unknown; apiKey?: unknown }>;
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
    if (isUnresolvedProviderApiKey(provider.apiKey) && !isBaiyingAimodelSecretRef(provider.apiKey)) {
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

async function waitForManagedAgentModelFromConfig(params: {
  api: OpenClawPluginApi;
  agentId: string;
  timeoutMs: number;
  pollMs?: number;
  expected?: ManagedAgentModelResolveResult;
}): Promise<ManagedAgentModelResolveResult | undefined> {
  const pollMs = params.pollMs ?? INBOUND_MODEL_RUNTIME_POLL_MS;
  const deadline = Date.now() + Math.max(0, params.timeoutMs);

  for (;;) {
    const resolved = resolveManagedAgentModelFromConfig({
      cfg: currentRuntimeConfig(params.api),
      agentId: params.agentId,
    });
    if (resolved && (!params.expected || sameResolvedModel(resolved, params.expected))) {
      return resolved;
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, Math.max(10, pollMs)),
    );
  }
}

async function resolveManagedAgentModelForInbound(params: {
  api: OpenClawPluginApi;
  agentId: string;
  flushNow?: () => Promise<void>;
  flushBeforeResolve?: boolean;
  runtimeConfigWaitMs?: number;
}): Promise<ManagedAgentModelResolveResult | undefined> {
  let resolved = resolveManagedAgentModelFromConfig({
    cfg: currentRuntimeConfig(params.api),
    agentId: params.agentId,
  });
  if (params.flushNow && (params.flushBeforeResolve || !resolved)) {
    await params.flushNow();
    const expected = resolveManagedAgentModelFromConfig({
      cfg: params.api.runtime.config.loadConfig(),
      agentId: params.agentId,
    });
    const currentAfterFlush = resolveManagedAgentModelFromConfig({
      cfg: currentRuntimeConfig(params.api),
      agentId: params.agentId,
    });
    if (expected && sameResolvedModel(currentAfterFlush, expected)) {
      resolved = currentAfterFlush;
    } else if (expected || !currentAfterFlush) {
      resolved = await waitForManagedAgentModelFromConfig({
        api: params.api,
        agentId: params.agentId,
        timeoutMs: params.runtimeConfigWaitMs ?? MANAGED_INBOUND_MODEL_RUNTIME_WAIT_MS,
        expected,
      });
      if (!resolved && expected) {
        params.api.logger?.warn?.(
          `baiying-enhance: managed inbound model sync for ${params.agentId} wrote ${expected.providerOverride}/${expected.modelOverride}, but runtime config did not expose it before dispatch`,
        );
      }
    } else {
      resolved = currentAfterFlush;
    }
  }
  return resolved;
}

/**
 * Align one session entry with the managed agent's config primary before get-reply
 * runs. Reconcile-after-sync only touches sessions that already exist; brand-new
 * SDK/web sessions (for example byai-channel direct peers) need this per message.
 */
async function syncMainAgentSessionModelForInbound(params: {
  api: OpenClawPluginApi;
  sessionKey?: string;
  agentId?: string;
  mainParentAgentId: string;
}): Promise<void> {
  const agentId = params.agentId?.trim() || resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId || agentId !== params.mainParentAgentId) {
    return;
  }
  const cfg = currentRuntimeConfig(params.api);
  const entry = cfg.agents?.list?.find((item) => item.id === agentId);
  const primary =
    (typeof entry?.model === "object" && entry.model?.primary?.trim()) ||
    (typeof entry?.model === "string" && entry.model.trim()) ||
    (typeof cfg.agents?.defaults?.model === "object" && cfg.agents.defaults.model.primary?.trim()) ||
    "";
  const parsed = primary ? parseModelPrimaryRef(primary) : null;
  if (!parsed || !isManagedModelRegisteredInConfig(cfg, parsed.provider, parsed.model)) {
    return;
  }
  const sessionApi = params.api.runtime?.agent?.session;
  if (!sessionApi?.updateSessionStoreEntry || !sessionApi?.resolveStorePath) {
    return;
  }
  const storePath = sessionApi.resolveStorePath(cfg.session?.store, { agentId });
  const sessionKey = params.sessionKey?.trim();
  if (!storePath || !sessionKey) {
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

export async function syncManagedAgentSessionModelForInbound(params: {
  api: OpenClawPluginApi;
  sessionKey?: string;
  agentId?: string;
  flushNow?: () => Promise<void>;
  flushBeforeResolve?: boolean;
  runtimeConfigWaitMs?: number;
}): Promise<void> {
  const agentId = params.agentId?.trim() || resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId?.startsWith(MANAGED_AGENT_PREFIX)) {
    return;
  }
  const resolved = await resolveManagedAgentModelForInbound({
    api: params.api,
    agentId,
    flushNow: params.flushNow,
    flushBeforeResolve: params.flushBeforeResolve,
    runtimeConfigWaitMs: params.runtimeConfigWaitMs,
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

export function registerManagedAgentModelHooks(
  api: OpenClawPluginApi,
  aimodelRunSync?: AimodelDefaultRunSyncDeps,
): void {
  const mainParentAgentId = aimodelRunSync?.pluginConfig.mainParentAgentId?.trim() || "main";
  const managedInboundFlushChecked = new Set<string>();
  api.logger.info(
    `baiying-enhance: registered typed hooks for main default LLM run-check (mainParentAgentId=${mainParentAgentId}, aimodelRunSync=${aimodelRunSync ? "on" : "off"})`,
  );

  api.on("before_dispatch", async (event, ctx) => {
    const sessionKey = ctx.sessionKey?.trim() || event.sessionKey?.trim();
    const agentId = resolveAgentIdFromSessionKey(sessionKey) ?? ctx.agentId?.trim();
    if (aimodelRunSync) {
      await resolveMainDefaultAimodelOnAgentRun(aimodelRunSync, agentId, {
        runtimeConfigWaitMs: MAIN_INBOUND_DEFAULT_MODEL_RUNTIME_WAIT_MS,
      });
      await syncMainAgentSessionModelForInbound({
        api,
        sessionKey,
        agentId,
        mainParentAgentId,
      });
    }
    await syncManagedAgentSessionModelForInbound({
      api,
      sessionKey,
      agentId,
      flushNow: aimodelRunSync?.getFlushNow(),
      flushBeforeResolve:
        Boolean(agentId?.startsWith(MANAGED_AGENT_PREFIX)) &&
        !managedInboundFlushChecked.has(agentId!),
      runtimeConfigWaitMs: MANAGED_INBOUND_MODEL_RUNTIME_WAIT_MS,
    });
    if (
      agentId?.startsWith(MANAGED_AGENT_PREFIX) &&
      resolveManagedAgentModelFromConfig({
        cfg: currentRuntimeConfig(api),
        agentId,
      })
    ) {
      managedInboundFlushChecked.add(agentId);
    }
  });

  api.on("before_model_resolve", async (_event, ctx) => {
    const agentId = ctx.agentId?.trim() || resolveAgentIdFromSessionKey(ctx.sessionKey);
    if (aimodelRunSync) {
      const mainDefault = await resolveMainDefaultAimodelOnAgentRun(aimodelRunSync, agentId);
      if (mainDefault) {
        return mainDefault;
      }
    }
    const resolve = () =>
      resolveManagedAgentModelFromConfig({
        cfg: currentRuntimeConfig(api),
        agentId,
      });
    const resolved = resolve();
    if (resolved) {
      if (
        shouldDeferManagedAgentModelOverrideForRun({
          resolved,
          currentProvider: ctx.modelProviderId,
          currentModel: ctx.modelId,
        })
      ) {
        api.logger.info(
          `baiying-enhance: defer before_model_resolve override for ${agentId} (${ctx.modelProviderId ?? "unknown"}/${ctx.modelId ?? "unknown"} → ${resolved.providerOverride}/${resolved.modelOverride}); current run was prepared with the previous config snapshot`,
        );
        return undefined;
      }
      return resolved;
    }
    if (agentId?.startsWith(MANAGED_AGENT_PREFIX)) {
      const flushed = await resolveManagedAgentModelForInbound({
        api,
        agentId,
        flushNow: aimodelRunSync?.getFlushNow(),
        flushBeforeResolve: true,
        runtimeConfigWaitMs: MANAGED_INBOUND_MODEL_RUNTIME_WAIT_MS,
      });
      if (flushed) {
        return flushed;
      }
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
    const agentId = ctx.agentId?.trim() || resolveAgentIdFromSessionKey(ctx.sessionKey);
    const managedContext = buildManagedAgentRuntimeModelSystemContext({
      cfg: currentRuntimeConfig(api),
      agentId,
      currentProvider: ctx.modelProviderId,
      currentModel: ctx.modelId,
    });
    if (!aimodelRunSync || agentId !== mainParentAgentId) {
      return managedContext ? { appendSystemContext: managedContext } : undefined;
    }
    const mainDefault = await resolveMainDefaultAimodelOnAgentRun(aimodelRunSync, agentId, {
      allowConfigMutation: false,
    });
    if (!mainDefault) {
      return managedContext ? { appendSystemContext: managedContext } : undefined;
    }
    const mainContext = buildMainDefaultAimodelRuntimeSystemContext({
      providerKey: mainDefault.providerOverride,
      modelRef: `${mainDefault.providerOverride}/${mainDefault.modelOverride}`,
      modelCode: mainDefault.modelOverride,
      hash: "",
    });
    const parts = [mainContext, managedContext].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? { appendSystemContext: parts.join("\n\n") } : undefined;
  });
}
