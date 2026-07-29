import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { byclawAcpAdapterConfigSchema } from "./src/config.js";
import { PLUGIN } from "./src/constants.js";
import { registerByclawAcpAdapterPlugin } from "./src/register-plugin.js";

export default definePluginEntry({
  id: PLUGIN.id,
  name: PLUGIN.name,
  description: PLUGIN.description,
  configSchema: () => ({
    jsonSchema: byclawAcpAdapterConfigSchema as unknown as Record<string, unknown>,
  }),
  register(api: OpenClawPluginApi) {
    registerByclawAcpAdapterPlugin(api);
  },
});
