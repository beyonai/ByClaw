import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { registerBaiyingEnhancePlugin } from "./src/register-plugin.js";

export { resolveConfigSyncHotPrefixes, resolveDigEmployeePubSub } from "./src/plugin-config.js";

const plugin = {
  id: "baiying-enhance",
  name: "Baiying Enhance",
  description:
    "Sync authorized Baiying digital employees from Redis and expose Baiying resource and RepoWiki tools.",
  register(api: OpenClawPluginApi) {
    const registerStarted = performance.now();
    registerBaiyingEnhancePlugin(api);
    api.logger.info(
      `baiying-enhance: register complete (${Math.round(performance.now() - registerStarted)}ms)`,
    );
  },
};

export default plugin;
