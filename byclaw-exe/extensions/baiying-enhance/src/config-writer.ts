import { withThinkingProviderReloadConfig } from "./configured-thinking.js";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  createRuntimeUpdateQueue,
  isRuntimeUpdateApplying,
  RuntimeUpdateDeferredError,
  type RuntimeUpdatePayload,
  readPendingRuntimeUpdate,
} from "../../shared/src/redis-runtime-update-gate.js";
import { classifyRuntimeConfigUpdate } from "./config-update-policy.js";

const modelUpdates = createRuntimeUpdateQueue();

export function stopRuntimeConfigUpdates(): Promise<void> {
  return modelUpdates.stop();
}

export function assertSafeRuntimeConfigUpdate(
  before: OpenClawConfig,
  after: OpenClawConfig,
  runtimeVersion?: string,
): void {
  const policy = classifyRuntimeConfigUpdate({
    before,
    after: withThinkingProviderReloadConfig(after),
    runtimeVersion: runtimeVersion ?? "unknown",
  });
  if (!policy.safe) throw new RuntimeUpdateDeferredError(policy.reason ?? "Plugin reload remains pending");
}

export type QueuedConfigRefresh = {
  key: string;
  payload?: RuntimeUpdatePayload;
  /** Re-read the source when the queued job runs, rather than retaining a config snapshot. */
  refresh: () => Promise<void>;
  enqueueOnly?: boolean;
};

export async function waitForQueuedRuntimeConfig(
  key: string,
  ready: () => boolean,
  signal?: AbortSignal,
): Promise<void> {
  while (!ready()) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("task cancelled");
    const pending = await readPendingRuntimeUpdate(key);
    if (pending?.blocked) throw new RuntimeUpdateDeferredError(`Model update pending maintenance: ${pending.error}`);
    if (!pending) throw new RuntimeUpdateDeferredError("Queued model update completed without making the selected model available");
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 100);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}

type MutableConfigRuntime = OpenClawPluginApi["runtime"]["config"] & {
  mutateConfigFile?: (params: {
    afterWrite: { mode: "auto" };
    mutate: (
      config: OpenClawConfig,
    ) => OpenClawConfig | void | Promise<OpenClawConfig | void>;
  }) => Promise<void>;
};

function replaceConfigContents(target: OpenClawConfig, next: OpenClawConfig): OpenClawConfig {
  const mutableTarget = target as Record<string, unknown>;
  for (const key of Object.keys(mutableTarget)) {
    delete mutableTarget[key];
  }
  Object.assign(target, next);
  return target;
}

export async function mutateOpenClawConfigFile(
  api: OpenClawPluginApi,
  mutator: (base: OpenClawConfig) => OpenClawConfig,
  queued?: QueuedConfigRefresh,
): Promise<void> {
  if (!isRuntimeUpdateApplying()) {
    if (!queued) throw new RuntimeUpdateDeferredError("Config mutation must be submitted through the Redis update queue");
    modelUpdates.register(queued.key, queued.refresh);
    modelUpdates.start();
    if (queued.enqueueOnly) {
      await modelUpdates.enqueue(queued.key, queued.payload);
      throw new RuntimeUpdateDeferredError(`Config update queued: ${queued.key}`);
    }
    if (await modelUpdates.applyNow(queued.key, queued.payload) !== "applied") {
      throw new RuntimeUpdateDeferredError(`Config update queued: ${queued.key}`);
    }
    return;
  }
  const runtimeConfig = api.runtime.config as MutableConfigRuntime;
  if (typeof runtimeConfig.mutateConfigFile === "function") {
    await runtimeConfig.mutateConfigFile({
      afterWrite: { mode: "auto" },
      mutate: (base) => {
        const next = withThinkingProviderReloadConfig(mutator(structuredClone(base)));
        assertSafeRuntimeConfigUpdate(base, next, api.runtime.version);
        return replaceConfigContents(base, next);
      },
    });
    return;
  }
  const base = runtimeConfig.loadConfig();
  const next = withThinkingProviderReloadConfig(mutator(structuredClone(base)));
  assertSafeRuntimeConfigUpdate(base, next, api.runtime.version);
  await runtimeConfig.writeConfigFile(next);
}
