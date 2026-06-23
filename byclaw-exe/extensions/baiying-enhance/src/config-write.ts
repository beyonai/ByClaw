import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { MANAGED_PROVIDER_PREFIX } from "./types.js";

/** Managed Baiying providers always need stream_options.include_usage on MiniMax-like endpoints. */
export const MANAGED_MODEL_STREAMING_USAGE_COMPAT = {
    supportsUsageInStreaming: true,
} as const;

export function collectManagedProviderModelCompatExplicitSetPaths(
    cfg: OpenClawConfig,
): string[][] {
    const paths: string[][] = [];
    const providers = cfg.models?.providers;
    if (!providers) {
        return paths;
    }
    for (const [providerKey, provider] of Object.entries(providers)) {
        if (!providerKey.startsWith(MANAGED_PROVIDER_PREFIX)) {
            continue;
        }
        if (!Array.isArray(provider?.models)) {
            continue;
        }
        provider.models.forEach((_, index) => {
            paths.push(["models", "providers", providerKey, "models", String(index), "compat"]);
        });
    }
    return paths;
}

export function hasManagedProviderModelCompatDrift(cfg: OpenClawConfig): boolean {
    const providers = cfg.models?.providers;
    if (!providers) {
        return false;
    }
    for (const [providerKey, provider] of Object.entries(providers)) {
        if (!providerKey.startsWith(MANAGED_PROVIDER_PREFIX)) {
            continue;
        }
        if (!Array.isArray(provider?.models)) {
            continue;
        }
        for (const model of provider.models) {
            if (model?.compat?.supportsUsageInStreaming !== true) {
                return true;
            }
        }
    }
    return false;
}

type WriteConfigOptions = NonNullable<Parameters<OpenClawPluginApi["runtime"]["config"]["writeConfigFile"]>[1]>;

export async function writeBaiyingMergedConfig(
    api: OpenClawPluginApi,
    next: OpenClawConfig,
    options?: WriteConfigOptions,
): Promise<void> {
    const explicitSetPaths = collectManagedProviderModelCompatExplicitSetPaths(next);
    await api.runtime.config.writeConfigFile(next, {
        ...options,
        explicitSetPaths: [...explicitSetPaths, ...(options?.explicitSetPaths ?? [])],
    } as WriteConfigOptions);
}
