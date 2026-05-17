import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { loadAgentContentIndex, saveAgentContentIndex } from "./agent-content-index.js";
import { adaptAgentJson, type AdaptedManagedAgent } from "./agent-adapter.js";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";
import { AgentRegistryState } from "./agent-state.js";
import { MANAGED_AGENT_PREFIX, type BaiyingEnhancePluginConfig } from "./types.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import { resolveEffectiveMainAgentsMdMode, seedMainAgentAgentsMd } from "./main-workspace-seed.js";
import { seedManagedAgentWorkspace } from "./workspace-seed.js";
import {
  mergeSkillNames,
  mergeWorkspaceSkillsIntoManagedAgents,
  skillSignature,
  watchWorkspaceSkillDirs,
} from "./workspace-skills.js";

export type LoadedManagedAgent = AdaptedManagedAgent & {
  /** SHA-256 hash of the source JSON content for change detection. */
  contentHash: string;
  /** Redis key that supplied this digital employee snapshot. */
  sourceRedisKey?: string;
};

function formatAgentDeltaLine(agent: LoadedManagedAgent): string {
  const name = agent.listEntry.name?.trim() || agent.agentId;
  const src = agent.sourceRedisKey ? `redis:${agent.sourceRedisKey}` : agent.sourceFilePath ?? "(no source path)";
  return `${agent.agentId} (${name}) ← ${src}`;
}

function diffSkillNames(before: string[], after: string[]): { enabled: string[]; disabled: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    enabled: after.filter((skill) => !beforeSet.has(skill)),
    disabled: before.filter((skill) => !afterSet.has(skill)),
  };
}

function formatSkillList(skills: string[]): string {
  return skills.length > 0 ? skills.join(", ") : "(none)";
}

export async function loadManagedAgentsFromRedis(params: {
  redisJsonStore: BaiyingRedisJsonStore;
  authorizedSourceKeys: Set<string> | undefined;
  embedApiKeysFromJson: boolean;
  envApiKeyTemplate?: string;
  defaultProxyUrl?: string;
  defaultApiKey?: string;
  log: { warn: (m: string) => void };
}): Promise<LoadedManagedAgent[]> {
  const authorizedIds = params.authorizedSourceKeys
    ? [...params.authorizedSourceKeys].map((id) => id.trim()).filter((id) => /^\d+$/.test(id))
    : [];
  const out: LoadedManagedAgent[] = [];
  if (authorizedIds.length === 0) {
    return out;
  }
  for (const sourceKey of authorizedIds) {
    const result = await params.redisJsonStore.getDigEmployeeJson(sourceKey);
    if (!result) {
      params.log.warn(`baiying-enhance: Redis digital employee JSON missing/unreadable key=DIG_EMPLOYEE_${sourceKey}`);
      continue;
    }
    const res = adaptAgentJson({
      raw: result.raw,
      fileName: `${result.key}.json`,
      embedApiKeysFromJson: params.embedApiKeysFromJson,
      envApiKeyTemplate: params.envApiKeyTemplate,
      defaultProxyUrl: params.defaultProxyUrl,
      defaultApiKey: params.defaultApiKey,
    });
    if ("error" in res) {
      params.log.warn(`baiying-enhance: skip Redis key ${result.key}: ${res.error}`);
      continue;
    }
    if (res.sourceKey !== sourceKey) {
      params.log.warn(
        `baiying-enhance: skip Redis key ${result.key}: JSON resourceId/sourceKey=${res.sourceKey} does not match authorized id=${sourceKey}`,
      );
      continue;
    }
    out.push({ ...res, sourceJson: result.raw, sourceRedisKey: result.key, contentHash: result.hash });
  }
  return out;
}

export type AgentFlushNowOptions = {
  /** dig-employee auth set changed — force config write and workspace markdown re-seed for all visible agents. */
  fullWorkspaceReseed?: boolean;
  /**
   * Soft-delete / Pub/Sub delete: drop managed agent from sync even if Redis still has a stale JSON value.
   * Each entry is the numeric resource id string (same as `sourceKey`).
   */
  deletedSourceKeys?: string[];
};

/** In-process sync of agent JSON directory → OpenClaw config + optional workspace seed (triggered by Redis or explicit flush). */
export type AgentWatchdog = {
  /** @param options.deferInitialFlush When true, skip the debounced first scan (pair with `__flushNow` after dig-employee auth is ready). */
  start: (options?: { deferInitialFlush?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Run one sync immediately (same as debounced flush).
   * `fullWorkspaceReseed`: dig-employee auth set changed — re-read JSON is already done each flush;
   * also force config write and workspace markdown re-seed for all currently visible agents.
   */
  __flushNow?: (opts?: AgentFlushNowOptions) => Promise<void>;
};

export function createAgentWatchdog(params: {
  api: OpenClawPluginApi;
  registry: AgentRegistryState;
  redisJsonStore: BaiyingRedisJsonStore;
  contentIndexPath: string;
  executorPath: string;
  pluginConfig: BaiyingEnhancePluginConfig;
  debounceMs: number;
  authorizationFilter?: {
    getAuthorizedSourceKeys: () => Set<string> | undefined;
  };
}): AgentWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushInFlight = false;
  let flushQueued = false;
  /** Set by `__flushNow({ fullWorkspaceReseed: true })` (Redis auth) to mirror a full directory refresh. */
  let pendingFullWorkspaceReseed = false;
  /** Resource ids pending explicit delete (Pub/Sub DIG_EMPLOYEE_DELETED). */
  const pendingDeletedSourceKeys = new Set<string>();
  /** Content hash of each Redis agent JSON from the last successful sync (loaded from persisted index at start when enabled). */
  const prevHashes = new Map<string, string>();
  /** Effective `agents.list[].skills` signatures from the last successful sync. */
  const prevSkillSignatures = new Map<string, string>();
  /** Last successful JSON/auth-filtered baseline, before workspace-uploaded skills are merged. */
  let lastBaseManaged: LoadedManagedAgent[] = [];
  let skillRefreshInFlight = false;
  let lastSkillSyncFailureSignature = "";
  let skillScanTimer: ReturnType<typeof setInterval> | undefined;
  let closeSkillWatchers: (() => void) | undefined;

  const persistIndex = params.pluginConfig.persistAgentContentIndex !== false;
  const workspaceSkillAutoEnable = params.pluginConfig.workspaceSkillAutoEnable !== false;
  const workspaceSkillIncludeMainShared = params.pluginConfig.workspaceSkillIncludeMainShared === true;
  const workspaceSkillScanIntervalMs =
    typeof params.pluginConfig.workspaceSkillScanIntervalMs === "number" &&
    Number.isFinite(params.pluginConfig.workspaceSkillScanIntervalMs)
      ? params.pluginConfig.workspaceSkillScanIntervalMs
      : 500;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, params.debounceMs);
  };

  const refreshWorkspaceSkillsOnly = async () => {
    if (!workspaceSkillAutoEnable || skillRefreshInFlight || flushInFlight) {
      return;
    }
    if (lastBaseManaged.length === 0) {
      return;
    }
    skillRefreshInFlight = true;
    let attemptedSkillSyncSignature = "";
    try {
      const effectiveManaged = await mergeWorkspaceSkillsIntoManagedAgents({
        api: params.api,
        managed: lastBaseManaged,
        includeMainShared: workspaceSkillIncludeMainShared,
        mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
      });
      let hasSkillChanges = false;
      const cfg = params.api.runtime.config.loadConfig();
      const existingSkillsById = new Map(
        (cfg?.agents?.list ?? [])
          .filter((entry) => entry.id)
          .map((entry) => [entry.id!, mergeSkillNames(entry.skills ?? [])]),
      );
      const skillDeltaLines: string[] = [];
      const nextSkillsById = new Map<string, string[]>();
      for (const m of effectiveManaged) {
        const nextSkills = mergeSkillNames(m.listEntry.skills ?? []);
        nextSkillsById.set(m.agentId, nextSkills);
        const nextSig = skillSignature(nextSkills);
        if (prevSkillSignatures.get(m.agentId) !== nextSig) {
          hasSkillChanges = true;
        }
        const existingSkills = existingSkillsById.get(m.agentId) ?? [];
        if (skillSignature(existingSkills) !== nextSig) {
          hasSkillChanges = true;
        }
        const delta = diffSkillNames(existingSkills, nextSkills);
        if (delta.enabled.length > 0 || delta.disabled.length > 0) {
          const name = m.listEntry.name?.trim() || m.agentId;
          skillDeltaLines.push(
            `  * ${m.agentId} (${name}) enabled=[${formatSkillList(delta.enabled)}] disabled=[${formatSkillList(delta.disabled)}] active=[${formatSkillList(nextSkills)}]`,
          );
        }
      }
      if (!hasSkillChanges) {
        lastSkillSyncFailureSignature = "";
        return;
      }

      const next = structuredClone(cfg);
      const list = next.agents?.list;
      if (!Array.isArray(list)) {
        return;
      }
      let touched = 0;
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        if (!entry.id) {
          continue;
        }
        const skills = nextSkillsById.get(entry.id);
        if (!skills) {
          continue;
        }
        list[i] = { ...entry, skills };
        touched += 1;
      }
      if (touched === 0) {
        return;
      }
      attemptedSkillSyncSignature = Array.from(nextSkillsById.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, skills]) => `${id}:${skillSignature(skills)}`)
        .join("|");
      await params.api.runtime.config.writeConfigFile(next);
      lastSkillSyncFailureSignature = "";
      params.registry.replaceAll(effectiveManaged);
      prevSkillSignatures.clear();
      for (const m of effectiveManaged) {
        prevSkillSignatures.set(m.agentId, skillSignature(m.listEntry.skills ?? []));
      }
      closeSkillWatchers?.();
      closeSkillWatchers = watchWorkspaceSkillDirs({
        api: params.api,
        managed: effectiveManaged,
        includeMainShared: workspaceSkillIncludeMainShared,
        mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
        onChange: () => {
          void refreshWorkspaceSkillsOnly();
        },
        log: { warn: (m) => params.api.logger.warn(m) },
      });
      params.api.logger.info(
        `baiying-enhance: workspace skill sync — updated skills for ${skillDeltaLines.length} managed agent(s)${
          skillDeltaLines.length > 0 ? `:\n${skillDeltaLines.join("\n")}` : ""
        }`,
      );
    } catch (err) {
      const signature = attemptedSkillSyncSignature || "(unknown)";
      if (signature !== lastSkillSyncFailureSignature) {
        lastSkillSyncFailureSignature = signature;
        params.api.logger.warn(
          `baiying-enhance: workspace skill sync failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } finally {
      skillRefreshInFlight = false;
    }
  };

  const flush = async () => {
    if (flushInFlight) {
      flushQueued = true;
      return;
    }
    flushInFlight = true;
    const forceAuthReseed = pendingFullWorkspaceReseed;
    pendingFullWorkspaceReseed = false;
    const deleteBatch = [...pendingDeletedSourceKeys];
    pendingDeletedSourceKeys.clear();
    const deleteBatchSet = new Set(deleteBatch.map((k) => k.trim()).filter(Boolean));

    try {
      const authorizedSourceKeys = params.authorizationFilter?.getAuthorizedSourceKeys();
      let managed = await loadManagedAgentsFromRedis({
        redisJsonStore: params.redisJsonStore,
        authorizedSourceKeys,
        embedApiKeysFromJson: params.pluginConfig.embedApiKeysFromJson === true,
        envApiKeyTemplate: params.pluginConfig.envApiKeyTemplate,
        defaultProxyUrl: params.pluginConfig.defaultProxyUrl,
        defaultApiKey: params.pluginConfig.defaultApiKey,
        log: { warn: (m) => params.api.logger.warn(m) },
      });
      if (deleteBatchSet.size > 0) {
        managed = managed.filter((agent) => !deleteBatchSet.has(agent.sourceKey));
      }
      const filteredManaged = managed;
      lastBaseManaged = filteredManaged;
      const effectiveManaged = workspaceSkillAutoEnable
        ? await mergeWorkspaceSkillsIntoManagedAgents({
            api: params.api,
            managed: filteredManaged,
            includeMainShared: workspaceSkillIncludeMainShared,
            mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
          })
        : filteredManaged;

      const currentIds = new Set(effectiveManaged.map((m) => m.agentId));
      const added: LoadedManagedAgent[] = [];
      const updated: LoadedManagedAgent[] = [];
      const removedSet = new Set<string>();

      for (const m of effectiveManaged) {
        const prev = prevHashes.get(m.agentId);
        if (prev === undefined) {
          added.push(m);
        } else if (prev !== m.contentHash) {
          updated.push(m);
        }
      }
      for (const oldId of prevHashes.keys()) {
        if (!currentIds.has(oldId)) {
          removedSet.add(oldId);
        }
      }

      for (const sourceKey of deleteBatchSet) {
        removedSet.add(`${MANAGED_AGENT_PREFIX}${sourceKey}`);
      }

      // Every flush: drop managed agents listed in config but absent from the current authorized Redis view.
      try {
        const cfg = params.api.runtime.config.loadConfig();
        const existingList = cfg?.agents?.list ?? [];
        for (const entry of existingList) {
          if (entry.id?.startsWith(MANAGED_AGENT_PREFIX) && !currentIds.has(entry.id)) {
            removedSet.add(entry.id);
          }
        }
      } catch {
        // ignore config read errors
      }

      const removed = [...removedSet];
      let hasMissingManagedRegistrations = false;
      let hasSkillChanges = false;
      try {
        const cfg = params.api.runtime.config.loadConfig();
        const existingIds = new Set((cfg?.agents?.list ?? []).map((entry) => entry.id).filter(Boolean));
        const existingSkillsById = new Map(
          (cfg?.agents?.list ?? [])
            .filter((entry) => entry.id)
            .map((entry) => [entry.id!, skillSignature(entry.skills ?? [])]),
        );
        for (const id of currentIds) {
          if (!existingIds.has(id)) {
            hasMissingManagedRegistrations = true;
            break;
          }
        }
        for (const m of effectiveManaged) {
          const nextSig = skillSignature(m.listEntry.skills ?? []);
          if (prevSkillSignatures.has(m.agentId) && prevSkillSignatures.get(m.agentId) !== nextSig) {
            hasSkillChanges = true;
          }
          if (existingSkillsById.get(m.agentId) !== nextSig) {
            hasSkillChanges = true;
          }
        }
        for (const oldId of prevSkillSignatures.keys()) {
          if (!currentIds.has(oldId)) {
            hasSkillChanges = true;
          }
        }
      } catch {
        // ignore config read errors
      }

      const hasChanges =
        added.length > 0 ||
        updated.length > 0 ||
        removed.length > 0 ||
        hasMissingManagedRegistrations ||
        hasSkillChanges ||
        deleteBatchSet.size > 0;
      const forceFullReseed = forceAuthReseed;
      const shouldSync = hasChanges || forceFullReseed;

      if (shouldSync && (deleteBatchSet.size > 0 || forceAuthReseed || added.length > 0 || updated.length > 0 || removed.length > 0 || hasSkillChanges)) {
        const trigger =
          deleteBatchSet.size > 0
            ? `explicit delete (${[...deleteBatchSet].join(", ")})`
            : forceAuthReseed
              ? "full workspace reseed (auth)"
              : hasSkillChanges && added.length === 0 && updated.length === 0 && removed.length === 0
                ? "workspace skill sync"
                : `managed agent sync (${params.debounceMs}ms coalesce)`;
        params.api.logger.info(
          `baiying-enhance: ${trigger} — delta: +${added.length} ~${updated.length} -${removed.length}; skillChanges=${hasSkillChanges}; fullWorkspaceReseed=${forceFullReseed}`,
        );
        const detailLines: string[] = [];
        for (const a of added) {
          detailLines.push(`  + ${formatAgentDeltaLine(a)}`);
        }
        for (const a of updated) {
          detailLines.push(`  ~ ${formatAgentDeltaLine(a)}`);
        }
        for (const id of removed) {
          detailLines.push(`  - ${id}`);
        }
        if (detailLines.length > 0) {
          params.api.logger.info(`baiying-enhance: agent delta:\n${detailLines.join("\n")}`);
        } else if (forceFullReseed && effectiveManaged.length > 0) {
          params.api.logger.info(
            `baiying-enhance: no hash/list delta; reseeding all ${effectiveManaged.length} visible agent(s):\n${effectiveManaged.map((a) => `  * ${formatAgentDeltaLine(a)}`).join("\n")}`,
          );
        }
      }

      params.registry.replaceAll(effectiveManaged);

      const runMainAgentsSeed =
        params.pluginConfig.mainWorkspaceAgentsAutoSeed !== false &&
        resolveEffectiveMainAgentsMdMode(params.pluginConfig) !== "off";

      const trySeedMainAgentsMd = async () => {
        if (!runMainAgentsSeed) {
          const reasons: string[] = [];
          if (params.pluginConfig.mainWorkspaceAgentsAutoSeed === false) {
            reasons.push("mainWorkspaceAgentsAutoSeed=false");
          }
          if (resolveEffectiveMainAgentsMdMode(params.pluginConfig) === "off") {
            reasons.push("mainAgentsMdMode=off");
          }
          if (reasons.length > 0) {
            params.api.logger.info(`baiying-enhance: main AGENTS.md seed skipped (${reasons.join(", ")})`);
          }
          return;
        }
        try {
          await seedMainAgentAgentsMd({
            api: params.api,
            pluginConfig: params.pluginConfig,
            managedAgents: effectiveManaged,
            log: {
              warn: (m) => params.api.logger.warn(m),
              info: (m) => params.api.logger.info(m),
            },
          });
        } catch (err) {
          params.api.logger.warn(
            `baiying-enhance: main workspace AGENTS.md seed failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      };

      if (!shouldSync) {
        await trySeedMainAgentsMd();
        prevSkillSignatures.clear();
        for (const m of effectiveManaged) {
          prevSkillSignatures.set(m.agentId, skillSignature(m.listEntry.skills ?? []));
        }
        if (workspaceSkillAutoEnable) {
          closeSkillWatchers?.();
          closeSkillWatchers = watchWorkspaceSkillDirs({
            api: params.api,
            managed: effectiveManaged,
            includeMainShared: workspaceSkillIncludeMainShared,
            mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
            onChange: () => {
              void refreshWorkspaceSkillsOnly();
            },
            log: { warn: (m) => params.api.logger.warn(m) },
          });
        }
        return;
      }

      const next = mergeManagedAgentsIntoConfig({
        base: params.api.runtime.config.loadConfig(),
        managed: effectiveManaged,
        mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
        mergeAllowSpawnForMain: params.pluginConfig.mergeAllowSpawnForMain !== false,
      });

      await params.api.runtime.config.writeConfigFile(next);

      const parts: string[] = [];
      if (added.length > 0) {
        parts.push(`added: ${added.map((a) => formatAgentDeltaLine(a)).join("; ")}`);
      }
      if (updated.length > 0) {
        parts.push(`updated: ${updated.map((a) => formatAgentDeltaLine(a)).join("; ")}`);
      }
      if (removed.length > 0) {
        parts.push(`removed: ${removed.join(", ")}`);
      }
      params.api.logger.info(
        `baiying-enhance: synced ${effectiveManaged.length} agent(s) — ${parts.join("; ")}`,
      );

      if (params.pluginConfig.workspaceAutoSeed !== false) {
        // Force full reseed on auth visibility changes so workspace markdown stays aligned.
        const toSeed = forceFullReseed ? effectiveManaged : [...added, ...updated];
        for (const m of toSeed) {
          try {
            await seedManagedAgentWorkspace({ api: params.api, adapted: m });
          } catch (err) {
            params.api.logger.warn(
              `baiying-enhance: workspace seed failed for ${m.agentId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }

      await trySeedMainAgentsMd();

      prevHashes.clear();
      for (const m of effectiveManaged) {
        prevHashes.set(m.agentId, m.contentHash);
      }
      prevSkillSignatures.clear();
      for (const m of effectiveManaged) {
        prevSkillSignatures.set(m.agentId, skillSignature(m.listEntry.skills ?? []));
      }
      if (workspaceSkillAutoEnable) {
        closeSkillWatchers?.();
        closeSkillWatchers = watchWorkspaceSkillDirs({
          api: params.api,
          managed: effectiveManaged,
          includeMainShared: workspaceSkillIncludeMainShared,
          mainParentAgentId: params.pluginConfig.mainParentAgentId ?? "main",
          onChange: () => {
            void refreshWorkspaceSkillsOnly();
          },
          log: { warn: (m) => params.api.logger.warn(m) },
        });
      }

      if (persistIndex) {
        await saveAgentContentIndex(
          params.contentIndexPath,
          new Map(prevHashes),
          { warn: (m) => params.api.logger.warn(m) },
        );
      }
    } catch (err) {
      params.api.logger.error(
        `baiying-enhance: sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      flushInFlight = false;
      if (flushQueued) {
        flushQueued = false;
        void flush();
      }
    }
  };

  return {
    start: async (options?: { deferInitialFlush?: boolean }) => {
      params.api.logger.info(
        "baiying-enhance: agent sync engine started (Redis JSON loading only; triggers: Redis Pub/Sub, dig-employee auth, __flushNow)",
      );
      if (persistIndex) {
        const loaded = await loadAgentContentIndex(params.contentIndexPath, {
          warn: (m) => params.api.logger.warn(m),
        });
        prevHashes.clear();
        for (const [id, h] of loaded) {
          prevHashes.set(id, h);
        }
      }
      if (!options?.deferInitialFlush) {
        schedule();
      }
      if (workspaceSkillAutoEnable && workspaceSkillScanIntervalMs > 0) {
        skillScanTimer = setInterval(() => {
          void refreshWorkspaceSkillsOnly();
        }, workspaceSkillScanIntervalMs);
        skillScanTimer.unref?.();
      }
    },
    stop: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (skillScanTimer) {
        clearInterval(skillScanTimer);
        skillScanTimer = undefined;
      }
      closeSkillWatchers?.();
      closeSkillWatchers = undefined;
    },
    __flushNow: async (opts?: AgentFlushNowOptions) => {
      if (opts?.fullWorkspaceReseed) {
        pendingFullWorkspaceReseed = true;
      }
      if (opts?.deletedSourceKeys?.length) {
        for (const k of opts.deletedSourceKeys) {
          const id = String(k ?? "").trim();
          if (id) {
            pendingDeletedSourceKeys.add(id);
          }
        }
      }
      await flush();
    },
  };
}
