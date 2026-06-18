import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/compat";

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
): Promise<void> {
  const runtimeConfig = api.runtime.config as MutableConfigRuntime;
  if (typeof runtimeConfig.mutateConfigFile === "function") {
    await runtimeConfig.mutateConfigFile({
      afterWrite: { mode: "auto" },
      mutate: (base) => {
        const next = mutator(base);
        return replaceConfigContents(base, next);
      },
    });
    return;
  }
  const base = runtimeConfig.loadConfig();
  await runtimeConfig.writeConfigFile(mutator(base));
}
