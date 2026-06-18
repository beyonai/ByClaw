import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
    DEFAULT_AIMODEL_TYPELIST_FIELD,
    resolveAimodelSecretProviderName,
    resolveAimodelTypeListRedisKey,
    resolveDefaultBaiyingAimodelProviderBundle,
} from "./aimodel-config.js";
import {
    aimodelDefaultLlmIndexChanged,
    buildAimodelDefaultLlmSnapshotFromBundle,
    loadAimodelDefaultLlmIndex,
    resolveAimodelDefaultLlmIndexPath,
    saveAimodelDefaultLlmIndex,
} from "./aimodel-default-index.js";
import {
    isManagedModelRegisteredInConfig,
    parseModelPrimaryRef,
} from "./agent-session-model-reconcile.js";
import { mergeDefaultAimodelIntoConfig } from "./agent-registry.js";
import type { ManagedAgentModelResolveResult } from "./managed-agent-model-hook.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

export type AimodelDefaultRunSyncDeps = {
    api: OpenClawPluginApi;
    redisJsonStore: BaiyingRedisJsonStore;
    pluginConfig: BaiyingEnhancePluginConfig;
    getFlushNow: () =>
        | ((opts?: { fullWorkspaceReseed?: boolean; deletedSourceKeys?: string[] }) => Promise<void>)
        | undefined;
    aimodelSecretResolverScriptPath?: string;
};

export type AimodelDefaultRunSyncOptions = {
    /**
     * When false, resolve Redis/index state for model overrides and prompt context only.
     * Skips config flush, disk repair, and index writes so mid-run hooks (e.g.
     * before_prompt_build during tool rounds) cannot interleave with the embedded
     * session transcript lock.
     */
    allowConfigMutation?: boolean;
    /**
     * Wait for OpenClaw hot reload to expose the newly written model provider
     * through runtime config before returning an override. This is important for
     * first inbound messages, where using the override before the model catalog
     * is live would only trade one Unknown model failure for another.
     */
    runtimeConfigWaitMs?: number;
    runtimeConfigPollMs?: number;
};

type ResolvedDefaultBundle = {
    providerKey: string;
    modelRef: string;
    modelCode: string;
    hash: string;
    provider: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultBaiyingAimodelProviderBundle>>
    >["provider"];
};

let flushInFlight: Promise<void> | null = null;

function loadDiskConfig(api: OpenClawPluginApi) {
    return api.runtime.config.loadConfig();
}

function isDefaultModelRegisteredInCurrentConfig(
    api: OpenClawPluginApi,
    provider: string,
    model: string,
): boolean {
    return isManagedModelRegisteredInConfig(
        api.runtime.config.current?.() ?? loadDiskConfig(api),
        provider,
        model,
    );
}

async function waitForDefaultModelRegisteredInCurrentConfig(
    api: OpenClawPluginApi,
    provider: string,
    model: string,
    options?: AimodelDefaultRunSyncOptions,
): Promise<boolean> {
    const timeoutMs = options?.runtimeConfigWaitMs ?? 250;
    const pollMs = options?.runtimeConfigPollMs ?? 50;
    const deadline = Date.now() + Math.max(0, timeoutMs);

    for (;;) {
        if (isDefaultModelRegisteredInCurrentConfig(api, provider, model)) {
            return true;
        }
        if (Date.now() >= deadline) {
            return false;
        }
        await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, Math.max(10, pollMs)),
        );
    }
}

function isDefaultModelRegisteredOnDisk(
    api: OpenClawPluginApi,
    provider: string,
    model: string,
): boolean {
    return isManagedModelRegisteredInConfig(loadDiskConfig(api), provider, model);
}

function resolveMainParentAgentId(pluginConfig: BaiyingEnhancePluginConfig): string {
    return pluginConfig.mainParentAgentId?.trim() || "main";
}

function toModelOverride(bundle: ResolvedDefaultBundle): ManagedAgentModelResolveResult | undefined {
    const parsed = parseModelPrimaryRef(bundle.modelRef);
    if (!parsed) {
        return undefined;
    }
    return {
        providerOverride: parsed.provider,
        modelOverride: parsed.model,
    };
}

async function queueConfigFlush(
    getFlushNow: () => (() => Promise<void>) | undefined,
    log: { warn: (message: string) => void },
): Promise<boolean> {
    const flush = getFlushNow();
    if (!flush) {
        log.warn(
            "baiying-enhance: aimodel default changed but agent watchdog is not started yet (__flushNow unavailable)",
        );
        return false;
    }
    if (flushInFlight) {
        await flushInFlight;
        return true;
    }
    flushInFlight = flush().finally(() => {
        flushInFlight = null;
    });
    await flushInFlight;
    return true;
}

async function syncDefaultModelDirectly(params: {
    deps: AimodelDefaultRunSyncDeps;
    bundle: ResolvedDefaultBundle;
    reason: string;
}): Promise<void> {
    const next = mergeDefaultAimodelIntoConfig({
        base: loadDiskConfig(params.deps.api),
        defaultModel: {
            providerKey: params.bundle.providerKey,
            modelRef: params.bundle.modelRef,
            provider: params.bundle.provider,
        },
        mainParentAgentId: resolveMainParentAgentId(params.deps.pluginConfig),
        aimodelConfigRedisKey: params.deps.pluginConfig.aimodelConfigRedisKey,
        aimodelTypeListRedisKey: params.deps.pluginConfig.aimodelTypeListRedisKey,
        aimodelSecretProviderName: params.deps.pluginConfig.aimodelSecretProviderName,
        aimodelSecretResolverCommand: process.execPath,
        aimodelSecretResolverArgs: [
            params.deps.aimodelSecretResolverScriptPath ?? "aimodel-secret-resolver-cli.js",
        ],
    });
    await params.deps.api.runtime.config.writeConfigFile(next);
    params.deps.api.logger.info(
        `baiying-enhance: synced platform default LLM ${params.bundle.modelRef} (${params.reason})`,
    );
}

/**
 * On each agent run for the main parent agent: read Redis typelist default LLM,
 * diff against the on-disk index, and auto-switch when the platform default changed.
 */
export async function resolveMainDefaultAimodelOnAgentRun(
    deps: AimodelDefaultRunSyncDeps,
    agentId: string | undefined,
    options?: AimodelDefaultRunSyncOptions,
): Promise<ManagedAgentModelResolveResult | undefined> {
    const allowConfigMutation = options?.allowConfigMutation !== false;
    const trimmedAgentId = agentId?.trim();
    const mainId = resolveMainParentAgentId(deps.pluginConfig);
    if (!trimmedAgentId || trimmedAgentId !== mainId) {
        return undefined;
    }

    const aimodelTypeListRedisKey = resolveAimodelTypeListRedisKey(
        deps.pluginConfig.aimodelTypeListRedisKey,
    );
    const warnLog = { warn: (m: string) => deps.api.logger.warn(m) };
    const resolved = await resolveDefaultBaiyingAimodelProviderBundle({
        redisJsonStore: deps.redisJsonStore,
        redisKey: aimodelTypeListRedisKey,
        modelType: DEFAULT_AIMODEL_TYPELIST_FIELD,
        secretProviderName: resolveAimodelSecretProviderName(
            deps.pluginConfig.aimodelSecretProviderName,
        ),
        log: warnLog,
    });
    if (!resolved) {
        deps.api.logger.warn(
            `baiying-enhance: main agent run could not read Redis default LLM (key=${aimodelTypeListRedisKey}); check REDIS_* env for the gateway process`,
        );
        return undefined;
    }

    const bundle: ResolvedDefaultBundle = {
        providerKey: resolved.providerKey,
        modelRef: resolved.modelRef,
        modelCode: resolved.provider.modelId,
        hash: resolved.hash,
        provider: resolved.provider,
    };
    const snapshot = buildAimodelDefaultLlmSnapshotFromBundle({
        redisKey: aimodelTypeListRedisKey,
        typelistField: DEFAULT_AIMODEL_TYPELIST_FIELD,
        providerKey: bundle.providerKey,
        modelRef: bundle.modelRef,
        typelistHash: bundle.hash,
        modelCode: bundle.modelCode,
    });
    const indexPath = resolveAimodelDefaultLlmIndexPath();
    const previous = await loadAimodelDefaultLlmIndex(indexPath, warnLog);
    const changed = aimodelDefaultLlmIndexChanged(previous, snapshot);
    const override = toModelOverride(bundle);
    if (!override) {
        return undefined;
    }

    deps.api.logger.info(
        `baiying-enhance: main aimodel run-check agentId=${trimmedAgentId} changed=${changed} redis=${bundle.modelRef} index=${previous?.modelRef ?? "(none)"}`,
    );

    if (!changed) {
        if (
            isDefaultModelRegisteredInCurrentConfig(
                deps.api,
                override.providerOverride,
                override.modelOverride,
            )
        ) {
            deps.api.logger.info(
                `baiying-enhance: main agent run using Redis default LLM ${bundle.modelRef} (index unchanged)`,
            );
            return override;
        }
        if (!allowConfigMutation) {
            deps.api.logger.info(
                `baiying-enhance: main agent run-check read-only; skipping config repair for ${bundle.modelRef}`,
            );
            return override;
        }
        await syncDefaultModelDirectly({
            deps,
            bundle,
            reason: "main run aimodel config repair",
        });
        if (await waitForDefaultModelRegisteredInCurrentConfig(
            deps.api,
            override.providerOverride,
            override.modelOverride,
            options,
        )) {
            return override;
        }
        deps.api.logger.warn(
            `baiying-enhance: Redis default LLM ${bundle.modelRef} is not ready under models.providers; run sync or check config hot reload`,
        );
        return undefined;
    }

    deps.api.logger.info(
        `baiying-enhance: Redis default LLM changed on agent run (${previous?.modelRef ?? "(none)"} → ${snapshot.modelRef}); auto-switching main`,
    );

    if (
        isDefaultModelRegisteredInCurrentConfig(
            deps.api,
            override.providerOverride,
            override.modelOverride,
        )
    ) {
        if (allowConfigMutation) {
            await saveAimodelDefaultLlmIndex(indexPath, snapshot, warnLog);
        }
        return override;
    }

    if (!allowConfigMutation) {
        deps.api.logger.info(
            `baiying-enhance: main agent run-check read-only; skipping default LLM switch to ${bundle.modelRef}`,
        );
        return override;
    }

    await queueConfigFlush(deps.getFlushNow, warnLog);

    if (
        isDefaultModelRegisteredInCurrentConfig(
            deps.api,
            override.providerOverride,
            override.modelOverride,
        )
    ) {
        await saveAimodelDefaultLlmIndex(indexPath, snapshot, warnLog);
        return override;
    }

    await syncDefaultModelDirectly({
        deps,
        bundle,
        reason: "main run aimodel diff",
    });

    if (isDefaultModelRegisteredOnDisk(deps.api, override.providerOverride, override.modelOverride)) {
        await saveAimodelDefaultLlmIndex(indexPath, snapshot, warnLog);
    }

    if (await waitForDefaultModelRegisteredInCurrentConfig(
        deps.api,
        override.providerOverride,
        override.modelOverride,
        options,
    )) {
        return override;
    }

    deps.api.logger.warn(
        `baiying-enhance: default LLM ${bundle.modelRef} written to config but not visible in current runtime yet; main run keeps prior model until hot reload applies`,
    );
    return undefined;
}

export function buildMainDefaultAimodelRuntimeSystemContext(
    bundle: ResolvedDefaultBundle,
): string {
    return [
        "Baiying platform default LLM runtime fact:",
        `- Current platform default LLM for the main agent is ${bundle.modelRef}.`,
        "- If the user asks what model you are using, answer from this runtime fact.",
        "- Ignore earlier transcript self-identification if it names a different model; it may be stale after a platform default model switch.",
    ].join("\n");
}

/** Reset flush coalescing between tests. */
export function resetAimodelDefaultRunSyncForTests(): void {
    flushInFlight = null;
}
