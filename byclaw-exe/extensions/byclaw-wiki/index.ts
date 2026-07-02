import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { byclawWikiConfigSchema } from "./src/config.js";
import { registerByclawWikiPlugin } from "./src/register-plugin.js";

export default definePluginEntry({
  id: "byclaw-wiki",
  name: "Byclaw Wiki",
  description:
    "Clone requested Git repositories for CodeGraph analysis and Zread Wiki generation.",
  configSchema: () => ({
    jsonSchema: byclawWikiConfigSchema as unknown as Record<string, unknown>,
  }),
  register(api: OpenClawPluginApi) {
    registerByclawWikiPlugin(api);
  },
});
