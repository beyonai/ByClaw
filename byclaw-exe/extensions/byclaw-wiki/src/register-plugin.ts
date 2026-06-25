import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveByclawWikiConfig } from "./config.js";
import { registerByclawWikiHttpRoute } from "./http.js";
import { ByclawWikiRepositoryService } from "./repository-service.js";
import { createCodeToWikiTool } from "./tool.js";

export function registerByclawWikiPlugin(api: OpenClawPluginApi): void {
  const config = resolveByclawWikiConfig(api.pluginConfig);
  const service = new ByclawWikiRepositoryService(config, api.logger);

  api.registerTool(createCodeToWikiTool({ config, service, logger: api.logger }), {
    name: config.toolName,
  });
  registerByclawWikiHttpRoute({ api, config, service });
  api.registerService({
    id: "byclaw-wiki-repository-sync",
    start: async () => {
      await service.start();
      api.logger.info(
        `byclaw-wiki: ready (${config.repositories.length} repos, weekly ${config.timezone} day=${config.syncDayOfWeek} ${config.syncHour}:${String(config.syncMinute).padStart(2, "0")})`,
      );
    },
    stop: async () => {
      await service.stop();
    },
  });
}
