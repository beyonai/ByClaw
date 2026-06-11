import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { byclawSqliteConfigSchema } from "./src/config.js";
import { registerByclawSqlitePlugin } from "./src/register-plugin.js";

export default definePluginEntry({
  id: "byclaw-sqlite",
  name: "Byclaw SQLite",
  description: "Expose the local byclaw SQLite database through a single sqlExecute capability.",
  configSchema: () => ({
    jsonSchema: byclawSqliteConfigSchema as unknown as Record<string, unknown>,
  }),
  register(api: OpenClawPluginApi) {
    registerByclawSqlitePlugin(api);
  },
});
