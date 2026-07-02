import type { BaiyingEnhancePluginConfig } from "./types.js";

export function resolveDigEmployeePubSub(pluginCfg: BaiyingEnhancePluginConfig): {
  subscribe: boolean;
  strictAuth: boolean;
  channel: string;
} {
  const subscribe =
    pluginCfg.digEmployeeChangeSubscribe !== undefined
      ? pluginCfg.digEmployeeChangeSubscribe
      : process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE !== "false";
  const strictAuth =
    pluginCfg.digEmployeeChangeSubscribeStrictAuth !== undefined
      ? pluginCfg.digEmployeeChangeSubscribeStrictAuth
      : process.env.BAIYING_DIG_CHANGE_SUBSCRIBE_STRICT_AUTH !== "false";
  const channel =
    pluginCfg.digEmployeeChangeChannel?.trim() ||
    process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL?.trim() ||
    process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL?.trim() ||
    "byai:pub:dig_employee_change";
  return { subscribe, strictAuth, channel };
}

/** `plugins.entries.*` paths registered as in-process reload when this plugin syncs via `writeConfigFile`. */
export function resolveConfigSyncHotPrefixes(cfg: BaiyingEnhancePluginConfig): string[] {
  const out = new Set<string>(["plugins.entries.baiying-enhance", "agents", "models"]);
  const extras = cfg.configSyncHotPluginEntriesPrefixes;
  if (Array.isArray(extras)) {
    for (const entry of extras) {
      if (typeof entry !== "string") continue;
      const t = entry.trim();
      if (!t) continue;
      out.add(t.startsWith("plugins.entries.") ? t : `plugins.entries.${t}`);
    }
  }
  return Array.from(out);
}
