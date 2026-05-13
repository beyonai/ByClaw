import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import { loadAgentContentIndex, saveAgentContentIndex } from "./agent-content-index.js";
import { adaptAgentJson, type AdaptedManagedAgent } from "./agent-adapter.js";
import { mergeManagedAgentsIntoConfig } from "./agent-registry.js";
import { AgentRegistryState } from "./agent-state.js";
import { MANAGED_AGENT_PREFIX, type BaiyingEnhancePluginConfig } from "./types.js";
import { resolveEffectiveMainAgentsMdMode, seedMainAgentAgentsMd } from "./main-workspace-seed.js";
import { seedManagedAgentWorkspace } from "./workspace-seed.js";

export async function collectAgentJsonFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    const p = path.join(rootDir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".json")) {
      out.push(p);
    }
    if (ent.isDirectory()) {
      const cfgPath = path.join(p, "config.json");
      try {
        await fs.access(cfgPath);
        out.push(cfgPath);
      } catch {
        // no config.json in this subdirectory
      }
    }
  }
  return out;
}

/** Read a JSON file and return both the parsed object and a content hash. */
async function readJsonWithHash(filePath: string): Promise<{ raw: unknown; hash: string } | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(content).digest("hex");
  return { raw, hash };
}

export type LoadedManagedAgent = AdaptedManagedAgent & {
  /** SHA-256 hash of the source JSON content for change detection. */
  contentHash: string;
};

function formatAgentDeltaLine(agent: LoadedManagedAgent): string {
  const name = agent.listEntry.name?.trim() || agent.agentId;
  const src = agent.sourceFilePath ?? "(no source path)";
  return `${agent.agentId} (${name}) ← ${src}`;
}

export async function loadManagedAgentsFromDir(params: {
  rootDir: string;
  embedApiKeysFromJson: boolean;
  envApiKeyTemplate?: string;
  defaultProxyUrl?: string;
  defaultApiKey?: string;
  log: { warn: (m: string) => void };
}): Promise<LoadedManagedAgent[]> {
  const files = await collectAgentJsonFiles(params.rootDir);
  const out: LoadedManagedAgent[] = [];
  for (const filePath of files) {
    const result = await readJsonWithHash(filePath);
    if (!result) {
      params.log.warn(`baiying-enhance: failed to read ${filePath}`);
      continue;
    }
    const res = adaptAgentJson({
      raw: result.raw,
      fileName: path.basename(filePath),
      embedApiKeysFromJson: params.embedApiKeysFromJson,
      envApiKeyTemplate: params.envApiKeyTemplate,
      defaultProxyUrl: params.defaultProxyUrl,
      defaultApiKey: params.defaultApiKey,
    });
    if ("error" in res) {
      params.log.warn(`baiying-enhance: skip ${filePath}: ${res.error}`);
      continue;
    }
    out.push({ ...res, sourceFilePath: filePath, contentHash: result.hash });
  }
  return out;
}

export type AgentFlushNowOptions = {
  /** dig-employee auth set changed — force config write and workspace markdown re-seed for all visible agents. */
  fullWorkspaceReseed?: boolean;
  /**
   * Soft-delete / Pub/Sub delete: unlink `AGENT_<id>.json` when present, drop managed agent from sync even if the file remains.
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
  absoluteDir: string;
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
  /** Content hash of each agent's source JSON from the last successful sync (and loaded from disk index at start when enabled). */
  const prevHashes = new Map<string, string>();

  const persistIndex = params.pluginConfig.persistAgentContentIndex !== false;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, params.debounceMs);
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

    const tryUnlinkAgentJson = async (sourceKey: string) => {
      const id = sourceKey.trim();
      if (!id) {
        return;
      }
      const flat = path.join(params.absoluteDir, `AGENT_${id}.json`);
      try {
        await fs.unlink(flat);
      } catch {
        // ignore missing file
      }
    };

    for (const key of deleteBatchSet) {
      await tryUnlinkAgentJson(key);
    }

    try {
      let managed = await loadManagedAgentsFromDir({
        rootDir: params.absoluteDir,
        embedApiKeysFromJson: params.pluginConfig.embedApiKeysFromJson === true,
        envApiKeyTemplate: params.pluginConfig.envApiKeyTemplate,
        defaultProxyUrl: params.pluginConfig.defaultProxyUrl,
        defaultApiKey: params.pluginConfig.defaultApiKey,
        log: { warn: (m) => params.api.logger.warn(m) },
      });
      if (deleteBatchSet.size > 0) {
        managed = managed.filter((agent) => !deleteBatchSet.has(agent.sourceKey));
      }
      const authorizedSourceKeys = params.authorizationFilter?.getAuthorizedSourceKeys();
      const filteredManaged =
        authorizedSourceKeys
          ? managed.filter((agent) => authorizedSourceKeys.has(agent.sourceKey))
          : managed;

      const currentIds = new Set(filteredManaged.map((m) => m.agentId));
      const added: LoadedManagedAgent[] = [];
      const updated: LoadedManagedAgent[] = [];
      const removedSet = new Set<string>();

      for (const m of filteredManaged) {
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

      // Every flush: drop managed agents listed in config but missing from disk (e.g. files removed while gateway was down).
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
      try {
        const cfg = params.api.runtime.config.loadConfig();
        const existingIds = new Set((cfg?.agents?.list ?? []).map((entry) => entry.id).filter(Boolean));
        for (const id of currentIds) {
          if (!existingIds.has(id)) {
            hasMissingManagedRegistrations = true;
            break;
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
        deleteBatchSet.size > 0;
      const forceFullReseed = forceAuthReseed;
      const shouldSync = hasChanges || forceFullReseed;

      if (shouldSync && (deleteBatchSet.size > 0 || forceAuthReseed || added.length > 0 || updated.length > 0 || removed.length > 0)) {
        const trigger =
          deleteBatchSet.size > 0
            ? `explicit delete (${[...deleteBatchSet].join(", ")})`
            : forceAuthReseed
              ? "full workspace reseed (auth)"
              : `managed agent sync (${params.debounceMs}ms coalesce)`;
        params.api.logger.info(
          `baiying-enhance: ${trigger} — delta: +${added.length} ~${updated.length} -${removed.length}; fullWorkspaceReseed=${forceFullReseed}`,
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
        } else if (forceFullReseed && filteredManaged.length > 0) {
          params.api.logger.info(
            `baiying-enhance: no hash/list delta; reseeding all ${filteredManaged.length} visible agent(s):\n${filteredManaged.map((a) => `  * ${formatAgentDeltaLine(a)}`).join("\n")}`,
          );
        }
      }

      params.registry.replaceAll(filteredManaged);

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
            managedAgents: filteredManaged,
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
        return;
      }

      const next = mergeManagedAgentsIntoConfig({
        base: params.api.runtime.config.loadConfig(),
        managed: filteredManaged,
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
        `baiying-enhance: synced ${filteredManaged.length} agent(s) — ${parts.join("; ")}`,
      );

      if (params.pluginConfig.workspaceAutoSeed !== false) {
        // Force full reseed on auth visibility changes so workspace markdown stays aligned.
        const toSeed = forceFullReseed ? filteredManaged : [...added, ...updated];
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
      for (const m of filteredManaged) {
        prevHashes.set(m.agentId, m.contentHash);
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
      try {
        await fs.mkdir(params.absoluteDir, { recursive: true });
      } catch {
        // ignore
      }
      params.api.logger.info(
        "baiying-enhance: agent sync engine started (directory scan on flush only; triggers: Redis Pub/Sub, dig-employee auth, __flushNow)",
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
    },
    stop: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
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
