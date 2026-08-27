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
import { createBaiyingCallToolFactory } from "./baiying-call-tool.js";
import {
  createCodeToWikiToolFactory,
  resolveCodeToWikiSettings,
} from "./code-to-wiki-tool.js";
import {
  registerBaiyingNativeImageRouting,
} from "./image-generation/native-image-provider.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";
import { loadAuthContext, resolveAuthFilePath } from "./executor/auth.js";
import { loadPrivateParamsRuntime } from "./personal-params.js";
import { resolveBackendServiceExecEnv } from "./backend-service-discovery.js";
import { createBaiyingTaskPlanRuntime } from "./task-plan-runtime.js";
import { registerUpdateTaskPlan } from "./update-task-plan-tool.js";
import { resolveChannelSessionIdForTool } from "./channel-session-resolve.js";
import {
  extractFinalAssistantOutput,
  scheduleLangfuseFinalOutputBackfill,
} from "./langfuse-final-output.js";
import {
  markBaiyingEnhanceColdStartReady,
  markBaiyingEnhanceColdStartUnavailable,
  resetBaiyingEnhanceColdStartReadiness,
} from "./cold-start-readiness.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

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
const PLUGIN_ID = "baiying-enhance";

function resolveColdStartReadySettleMs(): number {
  const raw = Number.parseInt(process.env.BAIYING_COLD_START_READY_SETTLE_MS || "2000", 10);
  return Number.isFinite(raw) ? Math.max(0, raw) : 2000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAgentWorkspaceForTool(api: OpenClawPluginApi, agentId: string): string {
  try {
    const cfg = api.runtime?.config?.current?.() ?? api.runtime?.config?.loadConfig?.();
    const entry = cfg?.agents?.list?.find((candidate) => candidate.id === agentId);
    if (typeof entry?.workspace === "string" && entry.workspace.trim()) {
      return entry.workspace.trim();
    }
  } catch {
    // Fall back to the standard managed-agent workspace layout.
  }
  return resolveDefaultManagedWorkspacePath(agentId);
}

function warnIfConversationHooksBlocked(api: OpenClawPluginApi): void {
  try {
    const cfg =
      api.runtime?.config?.current?.() ?? api.runtime?.config?.loadConfig?.();
    const entry = cfg?.plugins?.entries?.[PLUGIN_ID] as
      | { hooks?: { allowConversationAccess?: unknown } }
      | undefined;
    if (entry?.hooks?.allowConversationAccess === true) {
      return;
    }
  } catch {
    return;
  }
  api.logger.warn(
    "baiying-enhance: OpenClaw conversation hooks may be blocked; set plugins.entries.baiying-enhance.hooks.allowConversationAccess=true so before_model_resolve can override Redis-managed models before the first inbound run",
  );
}

export function registerBaiyingEnhancePlugin(api: OpenClawPluginApi): void {
  loadBaiyingRedisEnvDefaults({
    logger: {
      info: (message) => api.logger.info(message),
      warn: (message) => api.logger.warn(message),
    },
  });
  const pluginCfg = (api.pluginConfig ?? {}) as BaiyingEnhancePluginConfig;
  const taskPlanLogger = {
    info: (message: string) => api.logger.info(message),
    warn: (message: string) => api.logger.warn(message),
  };
  registerUpdateTaskPlan({
    api,
    runtime: createBaiyingTaskPlanRuntime({
      authFilePath: pluginCfg.authFilePath,
      logger: taskPlanLogger,
    }),
    logger: taskPlanLogger,
  });
  warnIfConversationHooksBlocked(api);
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

  const baiyingCallToolFactory = createBaiyingCallToolFactory({
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
  api.logger.info("baiying-enhance: baiying_call tool factory ready");

  api.registerTool(
    (ctx) => baiyingCallToolFactory(ctx),
    { name: "baiying_call" },
  );

  const loadUserPrivateParams = async (): Promise<Record<string, string>> => {
    const authContext = await loadAuthContext(resolveAuthFilePath(pluginCfg.authFilePath));
    const runtime = await loadPrivateParamsRuntime({
      authContext,
      logger: {
        info: (message) => api.logger.info(message),
        warn: (message) => api.logger.warn(message),
        error: (message) => api.logger.error(message),
      },
    });
    return runtime?.params ?? {};
  };

  const codeToWikiToolFactory = createCodeToWikiToolFactory({
    registry,
    loadGitCredentials: async () => {
      try {
        const params = await loadUserPrivateParams();
        return {
          gitHubToken: params.GH_TOKEN,
          privateHost: params.GIT_HOST,
          privateUsername: params.GIT_USERNAME,
          privateToken: params.GIT_TOKEN,
        };
      } catch (err) {
        api.logger.warn(
          `baiying-enhance: code_to_wiki Git credential lookup skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {};
      }
    },
    resolveWorkspaceDir: (agentId) => resolveAgentWorkspaceForTool(api, agentId),
    settings: resolveCodeToWikiSettings(pluginCfg),
    logger: {
      info: (message) => api.logger.info(message),
      warn: (message) => api.logger.warn(message),
    },
  });
  api.registerTool(
    (ctx) => codeToWikiToolFactory(ctx),
    { name: "code_to_wiki" },
  );
  api.logger.info("baiying-enhance: code_to_wiki RepoWiki tool factory ready");

  registerBaiyingNativeImageRouting({
    api,
    registry,
    store: redisJsonStore,
    loadGenerateImage: async () => {
      const runtime = await import("openclaw/plugin-sdk/image-generation-runtime");
      return runtime.generateImage;
    },
  });
  api.logger.info("baiying-enhance: native image_generate Redis router ready");

  api.on("resolve_exec_env", async (event) => {
    if (event.toolName !== "exec") {
      return {};
    }
    let privateParams: Record<string, string> = {};
    try {
      privateParams = await loadUserPrivateParams();
    } catch (err) {
      api.logger.warn(
        `baiying-enhance: resolve_exec_env private params skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const backendEnv = await resolveBackendServiceExecEnv({
      logger: { warn: (message) => api.logger.warn(message) },
    });
    const safePrivateParams = { ...privateParams };
    delete safePrivateParams.BEYOND_TOKEN;
    delete safePrivateParams.BYAI_SERVICE_BASE_URL;
    return { ...safePrivateParams, ...backendEnv };
  });

  api.on("agent_end", (event, ctx) => {
    const run = async () => {
      const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
      const channelResolve = resolveChannelSessionIdForTool(ctx, sessionKey);
      if (channelResolve.source === "child") {
        return;
      }
      const output = extractFinalAssistantOutput(Array.isArray(event.messages) ? event.messages : []);
      if (!output) {
        return;
      }
      scheduleLangfuseFinalOutputBackfill({
        traceId: channelResolve.traceId,
        sessionId: channelResolve.sessionId,
        userId: process.env.USER_CODE,
        output,
        logger: {
          info: (message) => api.logger.info(message),
          warn: (message) => api.logger.warn(message),
        },
      });
    };
    void run().catch((err) => {
      api.logger.warn(
        `baiying-enhance: Langfuse final output hook failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
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
  let mainContextTemplateWatch:
    | ReturnType<typeof import("./main-context-template-watch.js").createMainContextTemplateWatch>
    | undefined;
  let serviceStopped = false;

  api.registerService({
    id: "baiying-enhance-watchdogs",
    start: async (ctx) => {
      const startMs = performance.now();
      serviceStopped = false;
      resetBaiyingEnhanceColdStartReadiness("service_starting");

      const [
        { createAgentWatchdog },
        { createDigEmployeeAuthWatch },
        { createDigEmployeeChangeSubscriber },
        { createMainContextTemplateWatch },
        { resolveEffectiveMainAgentsMdMode, loadMainAgentsTemplate, seedMainAgentAgentsMd },
      ] = await Promise.all([
        import("./agent-watchdog.js"),
        import("./dig-employee-auth-watch.js"),
        import("./dig-employee-change-subscriber.js"),
        import("./main-context-template-watch.js"),
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
      if (
        pluginCfg.mainWorkspaceAgentsAutoSeed !== false &&
        pluginCfg.mainContextTemplateWatch !== false
      ) {
        mainContextTemplateWatch = createMainContextTemplateWatch({
          redisJsonStore,
          pluginConfig: pluginCfg,
          logger: {
            info: (message) => api.logger.info(message),
            warn: (message) => api.logger.warn(message),
            error: (message) => api.logger.error(message),
          },
          onChange: async () => {
            if (serviceStopped) {
              return;
            }
            await seedMainAgentAgentsMd({
              api,
              pluginConfig: pluginCfg,
              redisJsonStore,
              managedAgents: registry.list(),
              redisContextOnly: true,
              skipSubagentRouting: true,
              log: {
                warn: (message) => api.logger.warn(message),
                info: (message) => api.logger.info(message),
              },
            });
          },
        });
      } else {
        api.logger.info(
          "baiying-enhance: main context template watcher disabled (mainWorkspaceAgentsAutoSeed=false or mainContextTemplateWatch=false)",
        );
      }
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
      void mainContextTemplateWatch?.start().catch((err) => {
        api.logger.warn(
          `baiying-enhance: main context template watcher failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      void (async () => {
        api.logger.info(
          "baiying-enhance: startup Redis auth sync scheduled in background; gateway ready will not wait for managed agent reseed",
        );
        await digEmployeeAuthWatch?.start();
        if (serviceStopped) {
          return;
        }
        const authorizedIds = digEmployeeAuthWatch?.getAuthorizedIds();
        if (authorizedIds === undefined) {
          markBaiyingEnhanceColdStartUnavailable("dig_employee_auth_unavailable");
          api.logger.warn(
            "baiying-enhance: cold-start readiness unavailable because dig-employee auth did not load",
          );
        } else {
          const settleMs = resolveColdStartReadySettleMs();
          if (settleMs > 0) {
            await delay(settleMs);
          }
          markBaiyingEnhanceColdStartReady("initial_managed_agent_sync_complete");
          api.logger.info(
            `baiying-enhance: cold-start readiness signalled after initial managed agent sync (${authorizedIds.size} authorized id(s), settleMs=${settleMs})`,
          );
        }
        await digEmployeeChangeSubscriber?.start();
      })().catch((err) => {
        markBaiyingEnhanceColdStartUnavailable("background_startup_sync_failed");
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
      await mainContextTemplateWatch?.stop();
      mainContextTemplateWatch = undefined;
      await digEmployeeAuthWatch?.stop();
      digEmployeeAuthWatch = undefined;
      await agentWatch?.stop();
      agentWatch = undefined;
      await redisJsonStore.close();
      setSharedRedisJsonStore(null);
    },
  });
}
