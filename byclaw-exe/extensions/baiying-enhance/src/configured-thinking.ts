import type { BaiyingReasoningConfig } from "./agent-adapter.js";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";

type ProviderPlugin = Parameters<OpenClawPluginApi["registerProvider"]>[0];
export const THINKING_PROVIDER_IDS_CONFIG = "thinkingProviderIds";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "adaptive"];

type ConfiguredModel = {
    id: string;
    api?: string;
    baseUrl?: string;
    reasoning?: boolean;
    thinkingLevelMap?: Partial<Record<string, string>>;
    params?: Record<string, unknown>;
};

type PayloadEvent = {
    model: ConfiguredModel;
    options?: { reasoning?: string };
    payload: unknown;
};

/** Only generated visual configuration opts in; IDs, URLs and model names are irrelevant. */
export function readConfiguredThinking(model: ConfiguredModel): BaiyingReasoningConfig | undefined {
    const raw = model.params?.baiyingReasoningConfig;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const config = raw as BaiyingReasoningConfig;
    if (typeof config.enabled !== "boolean" || typeof config.compatFormat !== "string" ||
        !["unsupported", "binary", "effort", "budget", "adaptive"].includes(config.capability)) return undefined;
    return config;
}

export function hasConfiguredThinking(model: ConfiguredModel): boolean {
    return readConfiguredThinking(model) !== undefined;
}

/** Implement the explicit Bailian format; preserve existing native/Qwen contracts. */
export function patchConfiguredThinkingPayload({ model, options, payload }: PayloadEvent): void {
    const config = readConfiguredThinking(model);
    if (model.api !== "openai-completions" || !config ||
        config.compatFormat !== "bailian" ||
        !payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const level = options?.reasoning;
    const disabled = !config.enabled || config.capability === "unsupported" ||
        !level || level === "off" || level === "none";
    const body = payload as Record<string, unknown>;
    delete body.thinking;
    delete body.reasoning;
    delete body.reasoningEffort;
    delete body.reasoning_effort;
    delete body.thinking_budget;
    body.enable_thinking = !disabled;
    // Keep unrelated template options, but avoid a contradictory second switch.
    const template = body.chat_template_kwargs;
    if (template && typeof template === "object" && !Array.isArray(template)) {
        const { enable_thinking: _ignored, ...rest } = template as Record<string, unknown>;
        if (Object.keys(rest).length) body.chat_template_kwargs = rest;
        else delete body.chat_template_kwargs;
    }
    if (disabled) return;
    if (config.capability === "effort") {
        const effort = config.effortMap?.[level] ?? model.thinkingLevelMap?.[level] ?? level;
        if (effort !== "adaptive") body.reasoning_effort = effort;
    } else if (config.capability === "budget") {
        const budget = (config.budgets as Record<string, number> | undefined)?.[level];
        if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) body.thinking_budget = budget;
    }
}

export function resolveConfiguredThinkingProfile(
    config: OpenClawConfig,
    context: { provider?: string; modelId?: string },
): { levels: Array<{ id: string }> } | undefined {
    const provider = context.provider ? config.models?.providers?.[context.provider] : undefined;
    const model = provider?.models?.find((candidate) => candidate.id === context.modelId);
    if (!provider || !model || !hasConfiguredThinking({
        ...model,
        api: model.api ?? provider.api,
        baseUrl: provider.baseUrl,
    })) {
        return undefined;
    }
    const reasoning = readConfiguredThinking(model)!;
    if (!reasoning.enabled || reasoning.capability === "unsupported") return { levels: [{ id: "off" }] };
    const supported = reasoning.supportedEfforts;
    const levels = supported?.length ? supported : THINKING_LEVELS;
    return {
        levels: [...new Set(["off", ...levels.filter((level) => THINKING_LEVELS.includes(level))])]
            .map((id) => ({ id })),
    };
}

/** Sorted capability membership, not credentials or provider-name prefixes. */
export function collectConfiguredThinkingProviderIds(config: OpenClawConfig): string[] {
    return Object.entries(config.models?.providers ?? {})
        .filter(([, provider]) => provider.models?.some((model) => hasConfiguredThinking({
            ...model, api: model.api ?? provider.api, baseUrl: provider.baseUrl,
        })))
        .map(([id]) => id).sort();
}

/** Write membership with models atomically so 7.1 rebuilds all cached plugin registries. */
export function withThinkingProviderReloadConfig(config: OpenClawConfig): OpenClawConfig {
    const ids = collectConfiguredThinkingProviderIds(config);
    const entry = config.plugins?.entries?.["baiying-enhance"];
    const previous = entry?.config?.[THINKING_PROVIDER_IDS_CONFIG];
    if ((!ids.length && previous === undefined) || JSON.stringify(previous) === JSON.stringify(ids)) {
        return config;
    }
    return {
        ...config,
        plugins: {
            ...config.plugins,
            entries: {
                ...config.plugins?.entries,
                "baiying-enhance": {
                    ...entry,
                    config: { ...entry?.config, [THINKING_PROVIDER_IDS_CONFIG]: ids },
                },
            },
        },
    };
}

/** Public ProviderPlugin hooks only. No core patches, global hooks or fetch replacement. */
export function registerConfiguredThinkingAdapter(
    api: OpenClawPluginApi,
    resolveSyntheticAuth?: ProviderPlugin["resolveSyntheticAuth"],
): void {
    // Use the loader's snapshot: a disk read here could register providers before their
    // config reload is committed, or leak a provider into a differently scoped registry.
    for (const id of collectConfiguredThinkingProviderIds(api.config)) {
        api.registerProvider({
            id,
            label: "Configured model thinking",
            auth: [],
            resolveSyntheticAuth,
            resolveThinkingProfile: (context) => resolveConfiguredThinkingProfile(
                api.runtime.config.current?.() ?? api.runtime.config.loadConfig(), { provider: id, modelId: context.modelId },
            ) as ReturnType<NonNullable<ProviderPlugin["resolveThinkingProfile"]>>,
            wrapStreamFn: (context) => {
                const policy = context.model && readConfiguredThinking(context.model);
                if (!context.streamFn || context.model?.api !== "openai-completions" || !policy ||
                    policy.compatFormat !== "bailian") return undefined;
                const streamFn = context.streamFn;
                const thinkingLevel = context.thinkingLevel;
                return (model, messages, options) => {
                    if (!hasConfiguredThinking(model)) return streamFn(model, messages, options);
                    return streamFn(model, messages, {
                        ...options,
                        onPayload: async (payload, payloadModel) => {
                            const replacement = await options?.onPayload?.(payload, payloadModel);
                            const body = replacement ?? payload;
                            patchConfiguredThinkingPayload({
                                model, options: { reasoning: thinkingLevel }, payload: body,
                            });
                            return body;
                        },
                    });
                };
            },
        });
    }
}
