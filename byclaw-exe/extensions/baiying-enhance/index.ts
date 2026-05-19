import { homedir } from "node:os";
import path from "node:path";
import type {
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/compat";
import { AgentRegistryState } from "./src/agent-state.js";
import { createAgentWatchdog } from "./src/agent-watchdog.js";
import { createBaiyingCallToolFactory } from "./src/baiying-call-tool.js";
import { createDigEmployeeAuthWatch } from "./src/dig-employee-auth-watch.js";
import { createDigEmployeeChangeSubscriber } from "./src/dig-employee-change-subscriber.js";
import { registerBaiyingHttpRoutes } from "./src/http-routes.js";
import { resolveDefaultContentIndexPath } from "./src/agent-content-index.js";
import { resolveBundledBaiyingResourcesDir } from "./src/plugin-paths.js";
import { createRedisJsonStore, setSharedRedisJsonStore } from "./src/redis-json-store.js";
import { loadBaiyingRedisEnvDefaults } from "./src/redis-env.js";
import { createWorkspaceArchiveApi } from "./src/workspace-archive-api.js";
import {
  loadMainAgentsTemplate,
  resolveEffectiveMainAgentsMdMode,
  seedMainAgentAgentsMd,
} from "./src/main-workspace-seed.js";
import type { BaiyingEnhancePluginConfig } from "./src/types.js";

/** Resolve a path, treating `~` as home dir and relative paths relative to ~/.openclaw/. */
function resolvePluginPath(api: OpenClawPluginApi, raw: string): string {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
  // api.resolvePath uses CWD which may be wrong for global installs.
  // Try api.resolvePath first (supports ~ expansion), but for bare relative paths
  // resolve relative to the openclaw state dir (~/.openclaw/) instead of CWD.
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw");
  return path.join(stateDir, raw);
}

function resolveAgentConfigDir(
  api: OpenClawPluginApi,
  workspaceDir: string | undefined,
  cfg: BaiyingEnhancePluginConfig,
): string {
  const raw = cfg.agentConfigDir?.trim() || "resources/dig_employee";
  return resolvePluginPath(api, raw);
}

export function resolveDigEmployeePubSub(pluginCfg: BaiyingEnhancePluginConfig): {
  subscribe: boolean;
  strictAuth: boolean;
  channel: string;
} {
  const subscribe =
    pluginCfg.digEmployeeChangeSubscribe !== undefined
      ? pluginCfg.digEmployeeChangeSubscribe
      : process.env.BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE !== "false";
  const strictAuth =
    pluginCfg.digEmployeeChangeSubscribeStrictAuth !== undefined
      ? pluginCfg.digEmployeeChangeSubscribeStrictAuth
      : process.env.BAIYING_DIG_CHANGE_SUBSCRIBE_STRICT_AUTH !== "false";
  const channel =
    pluginCfg.digEmployeeChangeChannel?.trim() ||
    process.env.BAIYING_DIG_EMPLOYEE_CHANGE_CHANNEL?.trim() ||
    process.env.DIG_EMPLOYEE_PUBSUB_CHANNEL?.trim() ||
    "byai:pub:dig_employee_change";
  return { subscribe, strictAuth, channel };
}

function resolveExecutorResourcesDir(api: OpenClawPluginApi, cfg: BaiyingEnhancePluginConfig): string {
  const raw = cfg.executorResourcesDir?.trim();
  if (!raw) {
    return resolveBundledBaiyingResourcesDir();
  }
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
  return resolvePluginPath(api, raw);
}

/** `plugins.entries.*` paths registered as in-process reload when this plugin syncs via `writeConfigFile` (see `configSyncHotPluginEntriesPrefixes` in openclaw.json). */
export function resolveConfigSyncHotPrefixes(cfg: BaiyingEnhancePluginConfig): string[] {
  const out = new Set<string>(["plugins.entries.baiying-enhance", "agents"]);
  const extras = cfg.configSyncHotPluginEntriesPrefixes;
  if (Array.isArray(extras)) {
    for (const entry of extras) {
      if (typeof entry !== "string") continue;
      const t = entry.trim();
      if (!t) continue;
      out.add(t.startsWith("plugins.entries.") ? t : `plugins.entries.${t}`);
    }
  }
  return Array.from(out);
}

const registry = new AgentRegistryState();

console.log("============Baiying Enhance module imported============");
const plugin = {
  id: "baiying-enhance",
  name: "Baiying Enhance",
  description:
    "Sync authorized Baiying digital employee JSON from Redis into OpenClaw config; sub-agents via sessions_spawn.",
  register(api: OpenClawPluginApi) {
    console.log("============Baiying Enhance register============");
    loadBaiyingRedisEnvDefaults({
      logger: {
        info: (message) => api.logger.info(message),
        warn: (message) => api.logger.warn(message),
      },
    });
    const pluginCfg = (api.pluginConfig ?? {}) as BaiyingEnhancePluginConfig;
    api.registerReload({
      hotPrefixes: resolveConfigSyncHotPrefixes(pluginCfg),
    });
    const debounceMs = pluginCfg.watchDebounceMs ?? 500;
    const executorResourcesDir = resolveExecutorResourcesDir(api, pluginCfg);
    const redisJsonStore = createRedisJsonStore({
      logger: {
        info: (message) => api.logger.info(message),
        warn: (message) => api.logger.warn(message),
        error: (message) => api.logger.error(message),
      },
    });
    setSharedRedisJsonStore(redisJsonStore);

    registerBaiyingHttpRoutes({ api, registry });


    // Register baiying_call tool for managed agents with SSE URL or associated resources.
    api.registerTool(
      createBaiyingCallToolFactory({
        registry,
        executorPath: executorResourcesDir,
        embedApiKeysFromJson: pluginCfg.embedApiKeysFromJson === true,
        envApiKeyTemplate: pluginCfg.envApiKeyTemplate,
        defaultProxyUrl: pluginCfg.defaultProxyUrl,
        defaultApiKey: pluginCfg.defaultApiKey,
        logger: {
          info: (message) => api.logger.info(message),
          warn: (message) => api.logger.warn(message),
          error: (message) => api.logger.error(message),
        },
      }) as any,
      { name: "baiying_call" },
    );

    let agentWatch: Awaited<ReturnType<typeof createAgentWatchdog>> | undefined;
    let digEmployeeAuthWatch: ReturnType<typeof createDigEmployeeAuthWatch> | undefined;
    let digEmployeeChangeSubscriber: ReturnType<typeof createDigEmployeeChangeSubscriber> | undefined;

    api.registerService({
      id: "baiying-enhance-watchdogs",
      start: async (ctx) => {
        const absoluteDir = resolveAgentConfigDir(api, ctx.workspaceDir, pluginCfg);
        const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw");
        const contentIndexPath = pluginCfg.agentContentIndexPath?.trim()
          ? resolvePluginPath(api, pluginCfg.agentContentIndexPath.trim())
          : resolveDefaultContentIndexPath(stateDir, "redis-dig-employee");
        api.logger.info(`baiying-enhance: Redis digital employee source enabled (deprecated agentConfigDir ignored: ${absoluteDir})`);
        api.logger.info(`baiying-enhance: executor resources dir deprecated for Baiying resource snapshots: ${executorResourcesDir}`);
        if (pluginCfg.persistAgentContentIndex !== false) {
          api.logger.info(`baiying-enhance: agent content index path: ${contentIndexPath}`);
        }
        {
          const mdMode = resolveEffectiveMainAgentsMdMode(pluginCfg);
          const tpl = await loadMainAgentsTemplate(pluginCfg);
          const tplLabel = tpl?.kind === "file" ? tpl.path : tpl ? "bundled" : "none";
          api.logger.info(
            `baiying-enhance: main AGENTS.md — mode=${mdMode}, mainWorkspaceAgentsAutoSeed=${pluginCfg.mainWorkspaceAgentsAutoSeed !== false}, foreignTakeover=${pluginCfg.mainAgentsMdForeignTakeover !== false}, template=${tplLabel}`,
          );
        }
        const pub = resolveDigEmployeePubSub(pluginCfg);
        if (pub.subscribe) {
          api.logger.info(`baiying-enhance: dig-employee Redis Pub/Sub enabled channel=${pub.channel}`);
        }
        const workspaceArchiveApi =
          pluginCfg.workspaceArchiveBackend === "local"
            ? undefined
            : createWorkspaceArchiveApi({
                logger: {
                  info: (message) => api.logger.info(message),
                  warn: (message) => api.logger.warn(message),
                },
              });
        digEmployeeAuthWatch = createDigEmployeeAuthWatch({
          logger: {
            info: (message) => api.logger.info(message),
            warn: (message) => api.logger.warn(message),
            error: (message) => api.logger.error(message),
          },
          onChange: async (authorizedIds) => {
            api.logger.info(
              `baiying-enhance: dig-employee auth changed (${authorizedIds.size} authorized id(s)); triggering managed agent sync`,
            );
            await agentWatch?.__flushNow?.({ fullWorkspaceReseed: true });
          },
        });
        agentWatch = createAgentWatchdog({
          api,
          registry,
          redisJsonStore,
          contentIndexPath,
          executorPath: executorResourcesDir,
          pluginConfig: pluginCfg,
          debounceMs,
          workspaceArchiveApi,
          authorizationFilter: {
            // Keep `undefined` to mean "auth not ready"; the watchdog defers managed sync instead of clearing config.
            // Only return a Set when auth data exists and filtering should apply.
            getAuthorizedSourceKeys: () => digEmployeeAuthWatch?.getAuthorizedIds(),
          },
        });
        if (pub.subscribe) {
          digEmployeeChangeSubscriber = createDigEmployeeChangeSubscriber({
            logger: {
              info: (message) => api.logger.info(message),
              warn: (message) => api.logger.warn(message),
              error: (message) => api.logger.error(message),
            },
            channel: pub.channel,
            strictAuth: pub.strictAuth,
            debounceMs,
            getAuthorizedIds: () => digEmployeeAuthWatch?.getAuthorizedIds(),
            flushNow: async (opts) => {
              await agentWatch?.__flushNow?.(opts);
            },
          });
        }
        // Start sync engine before Redis auth so `onChange` always has `agentWatch`; defer first scan until dig auth has run once.
        await agentWatch.start({ deferInitialFlush: true });
        await digEmployeeAuthWatch.start();
        await digEmployeeChangeSubscriber?.start();
        // First flush runs cold-start workspace reconcile (auth ids vs workspace-baiying-agent-*) before restore.
        await agentWatch.__flushNow?.({ fullWorkspaceReseed: true });
      },
      stop: async () => {
        await digEmployeeChangeSubscriber?.stop();
        digEmployeeChangeSubscriber = undefined;
        await digEmployeeAuthWatch?.stop();
        digEmployeeAuthWatch = undefined;
        await agentWatch?.stop();
        agentWatch = undefined;
        await redisJsonStore.close();
        setSharedRedisJsonStore(null);
      },
    });
  },
};

export default plugin;
