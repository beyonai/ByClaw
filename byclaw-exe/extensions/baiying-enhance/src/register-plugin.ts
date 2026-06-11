import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { AgentRegistryState } from "./agent-state.js";
import { registerBaiyingAimodelRuntimeProvider } from "./aimodel-runtime-provider.js";
import { resolveDefaultContentIndexPath } from "./agent-content-index.js";
import { registerBaiyingHttpRoutes } from "./http-routes.js";
import { resolveConfigSyncHotPrefixes, resolveDigEmployeePubSub } from "./plugin-config.js";
import { resolveBundledBaiyingResourcesDir } from "./plugin-paths.js";
import { registerManagedAgentModelHooks } from "./managed-agent-model-hook.js";
import { createRedisJsonStore, setSharedRedisJsonStore } from "./redis-json-store.js";
import { loadBaiyingRedisEnvDefaults } from "./redis-env.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

function resolvePluginPath(api: OpenClawPluginApi, raw: string): string {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith("~")) {
    return path.join(homedir(), raw.slice(1));
  }
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

function resolveExecutorResourcesDir(
  api: OpenClawPluginApi,
  cfg: BaiyingEnhancePluginConfig,
): string {
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

const registry = new AgentRegistryState();
const pluginRuntimeDir = path.dirname(fileURLToPath(import.meta.url));

export function registerBaiyingEnhancePlugin(api: OpenClawPluginApi): void {
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

  let agentWatch: Awaited<ReturnType<typeof import("./agent-watchdog.js").createAgentWatchdog>> | undefined;
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
  registerBaiyingAimodelRuntimeProvider(api, pluginCfg);

  registerBaiyingHttpRoutes({ api, registry });

  let baiyingCallToolFactory: ((ctx: unknown) => unknown) | undefined;
  let baiyingCallToolFactoryReady: Promise<void> | undefined;

  const installBaiyingCallToolFactory = (
    createBaiyingCallToolFactory: typeof import("./baiying-call-tool.js").createBaiyingCallToolFactory,
  ) => {
    baiyingCallToolFactory = createBaiyingCallToolFactory({
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
    });
  };

  const ensureBaiyingCallToolFactoryReady = (): Promise<void> => {
    if (baiyingCallToolFactory) {
      return Promise.resolve();
    }
    baiyingCallToolFactoryReady ??= import("./baiying-call-tool.js")
      .then(({ createBaiyingCallToolFactory }) => {
        installBaiyingCallToolFactory(createBaiyingCallToolFactory);
        api.logger.info("baiying-enhance: baiying_call tool factory ready (preload)");
      })
      .catch((err) => {
        baiyingCallToolFactoryReady = undefined;
        throw err;
      });
    return baiyingCallToolFactoryReady;
  };

  api.registerTool(
    (ctx) => baiyingCallToolFactory?.(ctx) ?? null,
    { name: "baiying_call" },
  );

  void ensureBaiyingCallToolFactoryReady().catch((err) => {
    api.logger.warn(
      `baiying-enhance: baiying_call tool factory preload failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  registerManagedAgentModelHooks(api, {
    api,
    redisJsonStore,
    pluginConfig: pluginCfg,
    getFlushNow: () => agentWatch?.__flushNow?.bind(agentWatch),
    aimodelSecretResolverScriptPath: path.join(
      pluginRuntimeDir,
      "aimodel-secret-resolver-cli.js",
    ),
  });

  let digEmployeeAuthWatch:
    | ReturnType<typeof import("./dig-employee-auth-watch.js").createDigEmployeeAuthWatch>
    | undefined;
  let digEmployeeChangeSubscriber:
    | ReturnType<typeof import("./dig-employee-change-subscriber.js").createDigEmployeeChangeSubscriber>
    | undefined;
  let serviceStopped = false;

  api.registerService({
    id: "baiying-enhance-watchdogs",
    start: async (ctx) => {
      const startMs = performance.now();
      serviceStopped = false;

      await ensureBaiyingCallToolFactoryReady();
      const [
        { createAgentWatchdog },
        { createDigEmployeeAuthWatch },
        { createDigEmployeeChangeSubscriber },
        { resolveEffectiveMainAgentsMdMode, loadMainAgentsTemplate },
      ] = await Promise.all([
        import("./agent-watchdog.js"),
        import("./dig-employee-auth-watch.js"),
        import("./dig-employee-change-subscriber.js"),
        import("./main-workspace-seed.js"),
      ]);

      api.logger.info(
        `baiying-enhance: baiying_call tool factory ready (${Math.round(performance.now() - startMs)}ms since service start)`,
      );

      const absoluteDir = resolveAgentConfigDir(api, ctx.workspaceDir, pluginCfg);
      const stateDir =
        process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw");
      const contentIndexPath = pluginCfg.agentContentIndexPath?.trim()
        ? resolvePluginPath(api, pluginCfg.agentContentIndexPath.trim())
        : resolveDefaultContentIndexPath(stateDir, "redis-dig-employee");
      api.logger.info(
        `baiying-enhance: Redis digital employee source enabled (deprecated agentConfigDir ignored: ${absoluteDir})`,
      );
      api.logger.info(
        `baiying-enhance: executor resources dir deprecated for Baiying resource snapshots: ${executorResourcesDir}`,
      );
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
        api.logger.info(
          `baiying-enhance: dig-employee Redis Pub/Sub enabled channel=${pub.channel}`,
        );
      }
      const workspaceArchiveApi =
        pluginCfg.workspaceArchiveBackend === "local"
          ? undefined
          : (
              await import("./workspace-archive-api.js")
            ).createWorkspaceArchiveApi({
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
          if (serviceStopped) {
            return;
          }
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
        aimodelSecretResolverScriptPath: path.join(
          pluginRuntimeDir,
          "aimodel-secret-resolver-cli.js",
        ),
        debounceMs,
        workspaceArchiveApi,
        authorizationFilter: {
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
            if (serviceStopped) {
              return;
            }
            await agentWatch?.__flushNow?.(opts);
          },
        });
      }
      await agentWatch.start({ deferInitialFlush: true });
      void (async () => {
        api.logger.info(
          "baiying-enhance: startup Redis auth sync scheduled in background; gateway ready will not wait for managed agent reseed",
        );
        await digEmployeeAuthWatch?.start();
        if (serviceStopped) {
          return;
        }
        await digEmployeeChangeSubscriber?.start();
      })().catch((err) => {
        api.logger.warn(
          `baiying-enhance: background startup sync failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      api.logger.info(
        `baiying-enhance: watchdog service modules loaded (${Math.round(performance.now() - startMs)}ms)`,
      );
    },
    stop: async () => {
      serviceStopped = true;
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
}
