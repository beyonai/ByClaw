import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveByclawSqliteConfig } from "./config.js";
import { registerSqlExecuteHttpRoute } from "./http.js";
import { SqliteExecutor } from "./sqlite-executor.js";
import { createSqlExecuteTool } from "./tool.js";

export function registerByclawSqlitePlugin(api: OpenClawPluginApi): void {
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
}
