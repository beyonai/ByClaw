import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { registerBaiyingEnhancePlugin } from "./src/register-plugin.js";

export { resolveConfigSyncHotPrefixes, resolveDigEmployeePubSub } from "./src/plugin-config.js";

const plugin = {
  id: "baiying-enhance",
  name: "Baiying Enhance",
  description:
    "Sync authorized Baiying digital employee JSON from Redis into OpenClaw config; sub-agents via sessions_spawn.",
  register(api: OpenClawPluginApi) {
    const registerStarted = performance.now();
    registerBaiyingEnhancePlugin(api);
    api.logger.info(
      `baiying-enhance: register complete (${Math.round(performance.now() - registerStarted)}ms)`,
    );
  },
};

export default plugin;
