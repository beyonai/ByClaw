import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { byclawSqliteConfigSchema, resolveByclawSqliteConfig } from "./src/config.js";
import { registerSqlExecuteHttpRoute } from "./src/http.js";
import { SqliteExecutor } from "./src/sqlite-executor.js";
import { createSqlExecuteTool } from "./src/tool.js";

export default definePluginEntry({
  id: "byclaw-sqlite",
  name: "Byclaw SQLite",
  description: "Expose the local byclaw SQLite database through a single sqlExecute capability.",
  configSchema: () => ({
    jsonSchema: byclawSqliteConfigSchema as unknown as Record<string, unknown>,
  }),
  register(api: OpenClawPluginApi) {
    const config = resolveByclawSqliteConfig(api.pluginConfig);
    const executor = new SqliteExecutor({
      config,
      logger: api.logger,
    });

    api.registerTool(createSqlExecuteTool({ config, executor }), {
      name: config.toolName,
    });
    registerSqlExecuteHttpRoute({ api, config, executor });
    api.registerService({
      id: "byclaw-sqlite-runtime",
      start: async () => {
        api.logger.info(`byclaw-sqlite: ready (${config.dbPath})`);
      },
      stop: async () => {
        executor.close();
      },
    });
  },
});
