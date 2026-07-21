import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import {
  loadInstalledHubSkillRefs,
  syncHubSkillsForManagedAgents,
} from "./hub-skill-sync.js";
import { mutateOpenClawConfigFile } from "./config-writer.js";
import { resolveAgentIdFromSessionKey } from "./session-agent-id.js";

const SNAPSHOT_INVALIDATION_ENTRY = "__baiying_enhance_reload";
let standaloneInvalidationRevision = 0;

type SyncHubSkills = typeof syncHubSkillsForManagedAgents;

export function createStandaloneHubSkillRunSync(params: {
  api: OpenClawPluginApi;
  redisJsonStore?: BaiyingRedisJsonStore;
  stateDir?: string;
  syncHubSkills?: SyncHubSkills;
  invalidateSnapshot?: () => Promise<void>;
}): (agentId: string | undefined) => Promise<void> {
  const inFlight = new Map<string, Promise<Awaited<ReturnType<SyncHubSkills>>>>();
  const syncHubSkills = params.syncHubSkills ?? syncHubSkillsForManagedAgents;
  const invalidateSnapshot =
    params.invalidateSnapshot ??
    (async () => {
      await mutateOpenClawConfigFile(params.api, (base) => {
        const next = structuredClone(base) as any;
        next.skills = next.skills ?? {};
        next.skills.entries = next.skills.entries ?? {};
        next.skills.entries[SNAPSHOT_INVALIDATION_ENTRY] = {
          enabled: false,
          config: {
            reason: "hub-skill-run-sync",
            revision: `${Date.now()}-${++standaloneInvalidationRevision}`,
          },
        };
        return next;
      });
    });

  return async (agentId: string | undefined): Promise<void> => {
    const normalizedAgentId = agentId?.trim();
    if (!normalizedAgentId) {
      return;
    }
    const runtimeConfig = params.api.runtime.config as typeof params.api.runtime.config & {
      current?: () => any;
    };
    const cfg = runtimeConfig.current?.() ?? runtimeConfig.loadConfig();
    const agent = cfg.agents?.list?.find(
      (candidate: { id?: string }) => candidate.id === normalizedAgentId,
    );
    const skillCodes = Array.isArray(agent?.skills)
      ? agent.skills.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const refs = await loadInstalledHubSkillRefs({
      skillCodes,
      stateDir: params.stateDir,
    });
    const results = await Promise.all(
      refs.map((ref) => {
        const existing = inFlight.get(ref.skillCode);
        if (existing) {
          return existing;
        }
        const run = syncHubSkills({
          managed: [{ hubSkills: [ref] }],
          redisJsonStore: params.redisJsonStore,
          logger: {
            info: (message) => params.api.logger.info(message),
            warn: (message) => params.api.logger.warn(message),
          },
          stateDir: params.stateDir,
          trigger: "agent-run",
        }).finally(() => {
          if (inFlight.get(ref.skillCode) === run) {
            inFlight.delete(ref.skillCode);
          }
        });
        inFlight.set(ref.skillCode, run);
        return run;
      }),
    );
    const downloaded = results.flatMap((result) => result.downloaded);
    if (downloaded.length > 0) {
      await invalidateSnapshot();
      params.api.logger.info(
        `baiying-enhance: hub skill run refresh completed trigger=agent-run agentId=${normalizedAgentId} skillCodes=${downloaded.join(",")}`,
      );
    }
    const failed = results.flatMap((result) => result.failed);
    if (failed.length > 0) {
      throw new Error(`Hub Skill run check failed: ${failed.join(",")}`);
    }
  };
}

export type HubSkillRunSyncHookDeps = {
  getSyncBeforeRun: (() => ((agentId: string | undefined) => Promise<void>) | undefined);
  standaloneSyncBeforeRun?: (agentId: string | undefined) => Promise<void>;
};

export function registerHubSkillRunSyncHook(
  api: OpenClawPluginApi,
  deps: HubSkillRunSyncHookDeps,
): void {
  api.on("before_dispatch", async (event, ctx) => {
    const syncBeforeRun = deps.getSyncBeforeRun() ?? deps.standaloneSyncBeforeRun;
    const sessionKey = ctx?.sessionKey?.trim() || event?.sessionKey?.trim();
    const agentId = resolveAgentIdFromSessionKey(sessionKey) ?? ctx?.agentId?.trim();
    api.logger.info(
      `baiying-enhance: hub skill run check start agentId=${agentId ?? "(unknown)"} syncReady=${Boolean(syncBeforeRun)}`,
    );
    if (!syncBeforeRun) {
      return;
    }
    try {
      await syncBeforeRun(agentId);
    } catch (err) {
      api.logger.warn(
        `baiying-enhance: hub skill run check failed for agentId=${agentId ?? "(unknown)"}; blocking dispatch to preserve strong consistency: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        handled: true,
        text: "Hub Skill 运行前检查失败，已阻止本次任务以保证版本一致性，请稍后重试。",
      };
    }
  });
}
