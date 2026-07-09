import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveByclawAcpAdapterConfig } from "./config.js";
import { PLUGIN } from "./constants.js";
import { registerByclawAcpGatewayMethods } from "./gateway.js";
import { registerByclawAcpHttpRoutes } from "./http.js";
import { ByclawRegistry } from "./registry.js";
import { ByclawAcpRunStore } from "./sqlite-store.js";
import { createByclawAcpPlanTool, createByclawAcpRunTool } from "./tool.js";
import { createByclawCallAcpAgentTool } from "./call-acp-agent-tool.js";

export function registerByclawAcpAdapterPlugin(api: OpenClawPluginApi): void {
  const config = resolveByclawAcpAdapterConfig(api.pluginConfig);
  const registry = new ByclawRegistry(config.redis);
  const store = new ByclawAcpRunStore(config.sqlitePath);

  if (config.acpMode === "callAgent") {
    const callAcpAgentToolFactory = createByclawCallAcpAgentTool({
      config,
      registry,
      logger: {
        info: (message) => api.logger.info(message),
        warn: (message) => api.logger.warn(message),
        error: (message) => api.logger.error(message),
      },
    });
    api.registerTool((ctx) => callAcpAgentToolFactory(ctx), {
      name: config.toolNames.callAcpAgent,
    });
  } else {
    api.registerTool(createByclawAcpPlanTool({ config, registry }), {
      name: config.toolNames.plan,
    });
    api.registerTool(createByclawAcpRunTool({ config, registry, store }), {
      name: config.toolNames.run,
    });
  }
  registerByclawAcpGatewayMethods({ api, config, registry, store });
  registerByclawAcpHttpRoutes({ api, config, registry, store });

  api.registerService({
    id: PLUGIN.runtimeServiceId,
    start: async () => {
      api.logger.info(
        `${PLUGIN.id}: ready (acpMode=${config.acpMode}, redis=${config.redis.host}:${config.redis.port}/${config.redis.database}, sqlite=${config.sqlitePath}, acpAgent=${config.defaultAcpAgentId})`,
      );
    },
    stop: async () => {
      registry.close();
      store.close();
    },
  });
}
