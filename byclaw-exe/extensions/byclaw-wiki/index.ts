import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { byclawWikiConfigSchema } from "./src/config.js";
import { registerByclawWikiPlugin } from "./src/register-plugin.js";

export default definePluginEntry({
  id: "byclaw-wiki",
  name: "Byclaw Wiki",
  description:
    "Keep configured GitHub repositories indexed with CodeGraph and expose code_to_wiki for source-aware answers.",
  configSchema: () => ({
    jsonSchema: byclawWikiConfigSchema as unknown as Record<string, unknown>,
  }),
  register(api: OpenClawPluginApi) {
    registerByclawWikiPlugin(api);
  },
});
