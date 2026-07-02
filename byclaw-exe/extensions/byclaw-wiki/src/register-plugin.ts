import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveByclawWikiConfig } from "./config.js";
import { registerByclawWikiHttpRoute } from "./http.js";
import { ByclawWikiRepositoryService } from "./repository-service.js";
import { createCodeToWikiTool } from "./tool.js";
import { CODE_TO_WIKI_TOOL_NAME } from "./types.js";

export function registerByclawWikiPlugin(api: OpenClawPluginApi): void {
  const config = resolveByclawWikiConfig(api.pluginConfig);
  const service = new ByclawWikiRepositoryService(config, api.logger);

  api.registerTool(createCodeToWikiTool({ config, service, logger: api.logger }), {
    name: CODE_TO_WIKI_TOOL_NAME,
  });
  registerByclawWikiHttpRoute({ api, service });
  api.registerService({
    id: "byclaw-wiki-repository-runtime",
    start: async () => {
      await service.start();
      api.logger.info("byclaw-wiki: ready (request-level repositories, CodeGraph + Zread)");
    },
    stop: async () => {
      await service.stop();
    },
  });
}
