import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";

const LIVE_MODEL_SWITCH_PENDING_KEY = "liveModelSwitchPending";

export type AgentSessionModelReconcileTarget = {
    agentId: string;
    modelPrimary: string;
};

type ConfigWithProviders = {
    models?: {
        providers?: Record<
            string,
            {
                models?: Array<{ id?: string }>;
            }
        >;
    };
};

export function isManagedModelRegisteredInConfig(
    cfg: ConfigWithProviders,
    provider: string,
    model: string,
): boolean {
    const providers = cfg.models?.providers;
    if (!providers || typeof providers !== "object") {
        return false;
    }
    const providerKey = provider.trim();
    const modelId = model.trim();
    if (!providerKey || !modelId) {
        return false;
    }
    const providerEntry = providers[providerKey];
    if (!providerEntry || !Array.isArray(providerEntry.models)) {
        return false;
    }
    return providerEntry.models.some(
        (entry) => typeof entry?.id === "string" && entry.id.trim() === modelId,
    );
}

export function parseModelPrimaryRef(
    primary: string,
): { provider: string; model: string } | null {
    const trimmed = primary.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash >= trimmed.length - 1) {
        return null;
    }
    const provider = trimmed.slice(0, slash).trim();
    const model = trimmed.slice(slash + 1).trim();
    if (!provider || !model) {
        return null;
    }
    return { provider, model };
}

function sessionRuntimeModel(entry: Record<string, unknown>): {
    provider: string;
    model: string;
} {
    return {
        provider: typeof entry.modelProvider === "string" ? entry.modelProvider.trim() : "",
        model: typeof entry.model === "string" ? entry.model.trim() : "",
    };
}

function sessionOverrideModel(entry: Record<string, unknown>): {
    provider: string;
    model: string;
} {
    return {
        provider:
            typeof entry.providerOverride === "string" ? entry.providerOverride.trim() : "",
        model: typeof entry.modelOverride === "string" ? entry.modelOverride.trim() : "",
    };
}

/**
 * Align session model with platform `agents.list[].model.primary`.
 *
 * OpenClaw auto-reply (`createModelSelectionState` + directive fast lane) only
 * applies session **overrides**, not bare `model` / `modelProvider`. Gateway
 * `resolveSessionModelRef` does read runtime fields, but channel replies go
 * through override-aware selection first.
 */
export function applySessionModelFromPrimary(
    entry: Record<string, unknown>,
    parsed: { provider: string; model: string },
): { changed: boolean; liveSwitchRequested: boolean } {
    const runtime = sessionRuntimeModel(entry);
    const overrides = sessionOverrideModel(entry);
    const runtimeChanged =
        runtime.provider !== parsed.provider || runtime.model !== parsed.model;
    const overridesChanged =
        overrides.provider !== parsed.provider || overrides.model !== parsed.model;

    let changed = false;
    if (runtimeChanged) {
        entry.modelProvider = parsed.provider;
        entry.model = parsed.model;
        changed = true;
        if (entry.contextTokens !== undefined) {
            delete entry.contextTokens;
            changed = true;
        }
    }

    if (overridesChanged) {
        entry.providerOverride = parsed.provider;
        entry.modelOverride = parsed.model;
        entry.modelOverrideSource = "auto";
        changed = true;
    } else if (
        overrides.model &&
        !overrides.provider &&
        entry.modelOverrideSource === undefined
    ) {
        entry.providerOverride = parsed.provider;
        entry.modelOverrideSource = "auto";
        changed = true;
    }

    const liveSwitchRequested = runtimeChanged || overridesChanged;
    if (!liveSwitchRequested && !changed) {
        if (entry[LIVE_MODEL_SWITCH_PENDING_KEY] !== undefined) {
            delete entry[LIVE_MODEL_SWITCH_PENDING_KEY];
            return { changed: true, liveSwitchRequested: false };
        }
        return { changed: false, liveSwitchRequested: false };
    }

    if (liveSwitchRequested) {
        entry[LIVE_MODEL_SWITCH_PENDING_KEY] = true;
        changed = true;
    }

    return { changed, liveSwitchRequested };
}

export function collectModelReconcileTargets(params: {
    managed: Array<{
        agentId: string;
        listEntry: { model?: { primary?: string } };
        modelRef?: string;
    }>;
    added: Array<{ agentId: string }>;
    updated: Array<{ agentId: string }>;
    forceFullWorkspaceReseed: boolean;
    previousConfigModelPrimaryByAgentId: ReadonlyMap<string, string>;
}): AgentSessionModelReconcileTarget[] {
    const addedUpdatedIds = new Set(
        [...params.added, ...params.updated].map((agent) => agent.agentId),
    );
    const targets = new Map<string, string>();

    for (const agent of params.managed) {
        const modelPrimary = agent.listEntry.model?.primary?.trim() || agent.modelRef?.trim() || "";
        if (!modelPrimary) {
            continue;
        }
        if (addedUpdatedIds.has(agent.agentId)) {
            targets.set(agent.agentId, modelPrimary);
            continue;
        }
        if (params.forceFullWorkspaceReseed) {
            targets.set(agent.agentId, modelPrimary);
            continue;
        }
        const previousPrimary = params.previousConfigModelPrimaryByAgentId.get(agent.agentId);
        if (previousPrimary !== modelPrimary) {
            targets.set(agent.agentId, modelPrimary);
        }
    }

    return [...targets.entries()].map(([agentId, modelPrimary]) => ({ agentId, modelPrimary }));
}

/**
 * Push managed-agent model changes into OpenClaw's in-process session store.
 *
 * Writes both session overrides (for auto-reply model selection) and runtime
 * model fields (for status / resolveSessionModelRef). Sets
 * `liveModelSwitchPending` when the effective model changes so active embedded
 * runs can restart without a manual `/model`.
 */
export async function reconcileAgentSessionModelsAfterSync(params: {
    api: OpenClawPluginApi;
    agents: AgentSessionModelReconcileTarget[];
    log: { info: (message: string) => void; warn: (message: string) => void };
}): Promise<void> {
    const sessionApi = params.api.runtime?.agent?.session;
    if (!sessionApi?.updateSessionStore || !sessionApi?.resolveStorePath) {
        params.log.warn(
            "baiying-enhance: session model reconcile skipped (plugin runtime session API unavailable)",
        );
        return;
    }

    const cfg = params.api.runtime.config.loadConfig();
    const targetsByAgent = new Map<string, string>();
    for (const agent of params.agents) {
        const agentId = agent.agentId.trim();
        const modelPrimary = agent.modelPrimary.trim();
        if (!agentId || !modelPrimary) {
            continue;
        }
        targetsByAgent.set(agentId, modelPrimary);
    }

    for (const [agentId, modelPrimary] of targetsByAgent) {
        const parsed = parseModelPrimaryRef(modelPrimary);
        if (!parsed) {
            params.log.warn(
                `baiying-enhance: session model reconcile skipped for ${agentId} (invalid model primary ${modelPrimary})`,
            );
            continue;
        }

        const storePath = sessionApi.resolveStorePath(cfg.session?.store, { agentId });
        try {
            let touched = 0;
            let liveSwitchSessions = 0;
            await sessionApi.updateSessionStore(storePath, (store) => {
                touched = 0;
                liveSwitchSessions = 0;
                for (const entry of Object.values(store)) {
                    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                        continue;
                    }
                    const result = applySessionModelFromPrimary(
                        entry as Record<string, unknown>,
                        parsed,
                    );
                    if (result.changed) {
                        touched += 1;
                    }
                    if (result.liveSwitchRequested) {
                        liveSwitchSessions += 1;
                    }
                }
                return touched;
            });
            if (touched > 0) {
                const liveSwitchNote =
                    liveSwitchSessions > 0
                        ? `; ${liveSwitchSessions} session(s) marked liveModelSwitchPending`
                        : "";
                params.log.info(
                    `baiying-enhance: reconciled session model for ${agentId} (${touched} session(s) → ${modelPrimary}${liveSwitchNote})`,
                );
            }
        } catch (err) {
            params.log.warn(
                `baiying-enhance: session model reconcile failed for ${agentId}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
}
