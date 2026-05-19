import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { BaiyingEnhancePluginConfig } from "./types.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import type { WorkspaceArchiveApi, WorkspaceArchiveKind } from "./workspace-archive-api.js";
import { resolveAgentWorkspaceDir } from "./workspace-seed.js";
import { resolveStateDir } from "./workspace-paths.js";

const DEFAULT_WORKSPACE_ARCHIVE_DIR = ".baiying-workspaces";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type ManagedWorkspaceArchiveResult = {
  agentId: string;
  activeDir: string;
  archiveDir: string;
  rotatedArchiveDir?: string;
  archived: boolean;
  error?: string;
};

export type ManagedWorkspaceDeleteResult = {
  agentId: string;
  workspaceDir: string;
  deleted: boolean;
  error?: string;
};

function expandHome(raw: string): string {
  return raw === "~" ? homedir() : path.join(homedir(), raw.slice(1));
}

export function resolveWorkspaceArchiveRoot(config: BaiyingEnhancePluginConfig = {}): string {
  const raw = config.workspaceArchiveDir?.trim() || DEFAULT_WORKSPACE_ARCHIVE_DIR;
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  if (raw.startsWith("~")) {
    return expandHome(raw);
  }
  return path.join(path.dirname(resolveStateDir()), raw);
}

function isManagedAgentId(agentId: string): boolean {
  return agentId.startsWith(MANAGED_AGENT_PREFIX);
}

function sourceKeyFromManagedAgentId(agentId: string): string | undefined {
  return isManagedAgentId(agentId) ? agentId.slice(MANAGED_AGENT_PREFIX.length) : undefined;
}

function currentUserCode(): string {
  return process.env.USER_CODE?.trim() || "";
}

function useRemoteArchive(config: BaiyingEnhancePluginConfig): boolean {
  return config.workspaceArchiveBackend !== "local";
}

function archivePathForAgent(params: {
  archiveRoot: string;
  activeWorkspaceDir: string;
}): string {
  return path.join(params.archiveRoot, path.basename(params.activeWorkspaceDir));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function movePath(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
    return;
  } catch (err) {
    const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (code !== "EXDEV") {
      throw err;
    }
  }
  await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  await fs.rm(src, { recursive: true, force: true });
}

async function rotateExistingArchive(archiveDir: string): Promise<string> {
  const parent = path.dirname(archiveDir);
  const base = path.basename(archiveDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let i = 0; i < 1000; i += 1) {
    const suffix = i === 0 ? stamp : `${stamp}-${i}`;
    const rotated = path.join(parent, `${base}.${suffix}`);
    if (!(await exists(rotated))) {
      await movePath(archiveDir, rotated);
      return rotated;
    }
  }
  throw new Error(`unable to rotate existing workspace archive after 1000 attempts: ${archiveDir}`);
}

export async function restoreManagedAgentWorkspaces(params: {
  api: OpenClawPluginApi;
  pluginConfig: BaiyingEnhancePluginConfig;
  agentIds: string[];
  log: LoggerLike;
  workspaceArchiveApi?: WorkspaceArchiveApi;
}): Promise<void> {
  if (params.pluginConfig.workspaceArchiveOnUnauthorized === false) {
    return;
  }
  if (params.workspaceArchiveApi && useRemoteArchive(params.pluginConfig)) {
    const userCode = currentUserCode();
    for (const agentId of params.agentIds) {
      if (!isManagedAgentId(agentId)) {
        continue;
      }
      const sourceKey = sourceKeyFromManagedAgentId(agentId);
      if (!sourceKey) {
        continue;
      }
      const activeDir = resolveAgentWorkspaceDir(params.api, agentId);
      if (await exists(activeDir)) {
        continue;
      }
      try {
        const restored = await params.workspaceArchiveApi.downloadWorkspace({
          userCode,
          resourceId: sourceKey,
          archiveKind: "cancel_auth",
          destinationWorkspaceDir: activeDir,
        });
        if (restored) {
          params.log.info(`baiying-enhance: restored workspace for ${agentId} from remote cancel_auth archive to ${activeDir}`);
        }
      } catch (err) {
        params.log.warn(
          `baiying-enhance: remote workspace restore failed for ${agentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return;
  }
  const archiveRoot = resolveWorkspaceArchiveRoot(params.pluginConfig);
  for (const agentId of params.agentIds) {
    if (!isManagedAgentId(agentId)) {
      continue;
    }
    const activeDir = resolveAgentWorkspaceDir(params.api, agentId);
    const archiveDir = archivePathForAgent({ archiveRoot, activeWorkspaceDir: activeDir });
    if (await exists(activeDir)) {
      continue;
    }
    if (!(await exists(archiveDir))) {
      continue;
    }
    try {
      await movePath(archiveDir, activeDir);
      params.log.info(`baiying-enhance: restored workspace for ${agentId} from ${archiveDir} to ${activeDir}`);
    } catch (err) {
      params.log.warn(
        `baiying-enhance: workspace restore failed for ${agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export async function archiveUnauthorizedManagedAgentWorkspaces(params: {
  pluginConfig: BaiyingEnhancePluginConfig;
  agents: Array<{ agentId: string; workspaceDir: string }>;
  log: LoggerLike;
  workspaceArchiveApi?: WorkspaceArchiveApi;
  archiveKind?: WorkspaceArchiveKind;
}): Promise<ManagedWorkspaceArchiveResult[]> {
  if (params.pluginConfig.workspaceArchiveOnUnauthorized === false) {
    return [];
  }
  if (params.workspaceArchiveApi && useRemoteArchive(params.pluginConfig)) {
    return archiveManagedAgentWorkspacesToRemote({
      agents: params.agents,
      archiveKind: params.archiveKind ?? "cancel_auth",
      workspaceArchiveApi: params.workspaceArchiveApi,
      log: params.log,
    });
  }
  const archiveRoot = resolveWorkspaceArchiveRoot(params.pluginConfig);
  const results: ManagedWorkspaceArchiveResult[] = [];
  for (const agent of params.agents) {
    if (!isManagedAgentId(agent.agentId)) {
      continue;
    }
    const activeDir = agent.workspaceDir;
    if (!(await exists(activeDir))) {
      continue;
    }
    const archiveDir = archivePathForAgent({ archiveRoot, activeWorkspaceDir: activeDir });
    let rotatedArchiveDir: string | undefined;
    try {
      if (await exists(archiveDir)) {
        rotatedArchiveDir = await rotateExistingArchive(archiveDir);
        params.log.info(
          `baiying-enhance: rotated existing workspace archive for ${agent.agentId} from ${archiveDir} to ${rotatedArchiveDir}`,
        );
      }
      await movePath(activeDir, archiveDir);
      params.log.info(`baiying-enhance: archived workspace for ${agent.agentId} from ${activeDir} to ${archiveDir}`);
      results.push({
        agentId: agent.agentId,
        activeDir,
        archiveDir,
        rotatedArchiveDir,
        archived: true,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      params.log.warn(
        `baiying-enhance: workspace archive failed for ${agent.agentId}: ${error}`,
      );
      results.push({
        agentId: agent.agentId,
        activeDir,
        archiveDir,
        rotatedArchiveDir,
        archived: false,
        error,
      });
    }
  }
  return results;
}

export async function archiveManagedAgentWorkspacesToRemote(params: {
  agents: Array<{ agentId: string; workspaceDir: string }>;
  archiveKind: WorkspaceArchiveKind;
  workspaceArchiveApi: WorkspaceArchiveApi;
  log: LoggerLike;
}): Promise<ManagedWorkspaceArchiveResult[]> {
  const results: ManagedWorkspaceArchiveResult[] = [];
  const userCode = currentUserCode();
  for (const agent of params.agents) {
    if (!isManagedAgentId(agent.agentId)) {
      continue;
    }
    const sourceKey = sourceKeyFromManagedAgentId(agent.agentId);
    const activeDir = agent.workspaceDir;
    if (!sourceKey) {
      continue;
    }
    if (!(await exists(activeDir))) {
      continue;
    }
    try {
      const status = await params.workspaceArchiveApi.uploadWorkspace({
        userCode,
        resourceId: sourceKey,
        archiveKind: params.archiveKind,
        workspaceDir: activeDir,
      });
      await fs.rm(activeDir, { recursive: true, force: true });
      const remoteTarget = status.objectKey ?? `remote:${params.archiveKind}`;
      params.log.info(
        `baiying-enhance: uploaded ${params.archiveKind} workspace archive for ${agent.agentId} from ${activeDir} to ${remoteTarget}; local workspace removed`,
      );
      results.push({
        agentId: agent.agentId,
        activeDir,
        archiveDir: remoteTarget,
        archived: true,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      params.log.warn(
        `baiying-enhance: remote ${params.archiveKind} workspace archive failed for ${agent.agentId}; keeping local workspace at ${activeDir}: ${error}`,
      );
      results.push({
        agentId: agent.agentId,
        activeDir,
        archiveDir: `remote:${params.archiveKind}`,
        archived: false,
        error,
      });
    }
  }
  return results;
}

export async function deleteManagedAgentWorkspaces(params: {
  agents: Array<{ agentId: string; workspaceDir: string }>;
  log: LoggerLike;
  reason: string;
  workspaceArchiveApi?: WorkspaceArchiveApi;
}): Promise<ManagedWorkspaceDeleteResult[]> {
  if (params.workspaceArchiveApi) {
    const archived = await archiveManagedAgentWorkspacesToRemote({
      agents: params.agents,
      archiveKind: "delete",
      workspaceArchiveApi: params.workspaceArchiveApi,
      log: params.log,
    });
    return archived.map((result) => ({
      agentId: result.agentId,
      workspaceDir: result.activeDir,
      deleted: result.archived,
      error: result.error,
    }));
  }
  const results: ManagedWorkspaceDeleteResult[] = [];
  for (const agent of params.agents) {
    if (!isManagedAgentId(agent.agentId)) {
      continue;
    }
    if (!(await exists(agent.workspaceDir))) {
      continue;
    }
    try {
      await fs.rm(agent.workspaceDir, { recursive: true, force: true });
      params.log.info(
        `baiying-enhance: deleted workspace for ${agent.agentId} (${params.reason}) at ${agent.workspaceDir}`,
      );
      results.push({
        agentId: agent.agentId,
        workspaceDir: agent.workspaceDir,
        deleted: true,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      params.log.warn(
        `baiying-enhance: workspace delete failed for ${agent.agentId} (${params.reason}) at ${agent.workspaceDir}: ${error}`,
      );
      results.push({
        agentId: agent.agentId,
        workspaceDir: agent.workspaceDir,
        deleted: false,
        error,
      });
    }
  }
  return results;
}

export type ActiveManagedWorkspace = {
  agentId: string;
  sourceKey: string;
  workspaceDir: string;
};

function registerActiveWorkspace(
  out: Map<string, ActiveManagedWorkspace>,
  agentId: string,
  workspaceDir: string,
): void {
  const sourceKey = sourceKeyFromManagedAgentId(agentId);
  if (!sourceKey) {
    return;
  }
  out.set(agentId, {
    agentId,
    sourceKey,
    workspaceDir,
  });
}

/** Lists on-disk managed workspaces: `workspace-baiying-agent-*` under state dir plus config overrides. */
export async function listActiveManagedWorkspaces(
  stateDir = resolveStateDir(),
  api?: OpenClawPluginApi,
): Promise<ActiveManagedWorkspace[]> {
  const activeByAgentId = new Map<string, ActiveManagedWorkspace>();
  try {
    const entries = await fs.readdir(stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(`workspace-${MANAGED_AGENT_PREFIX}`)) {
        continue;
      }
      const agentId = entry.name.slice("workspace-".length);
      const workspaceDir = path.join(stateDir, entry.name);
      if (await exists(workspaceDir)) {
        registerActiveWorkspace(activeByAgentId, agentId, workspaceDir);
      }
    }
  } catch (err) {
    const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (code !== "ENOENT") {
      throw err;
    }
  }

  if (api) {
    try {
      const cfg = api.runtime.config.loadConfig() as { agents?: { list?: Array<{ id?: string; workspace?: string }> } };
      for (const entry of cfg?.agents?.list ?? []) {
        const agentId = typeof entry?.id === "string" ? entry.id.trim() : "";
        if (!isManagedAgentId(agentId)) {
          continue;
        }
        const workspaceDir = resolveAgentWorkspaceDir(api, agentId);
        if (await exists(workspaceDir)) {
          registerActiveWorkspace(activeByAgentId, agentId, workspaceDir);
        }
      }
    } catch {
      // ignore config read errors
    }
  }

  return [...activeByAgentId.values()];
}

/**
 * Cold start: compare Redis auth dig-employee ids with mounted `workspace-baiying-agent-*` dirs.
 * Workspaces on disk but absent from the auth set are archived as cancel_auth (remote API or local dir).
 */
export async function reconcileUnauthorizedMountedWorkspacesOnColdStart(params: {
  pluginConfig: BaiyingEnhancePluginConfig;
  authorizedSourceKeys: Set<string>;
  workspaceArchiveApi?: WorkspaceArchiveApi;
  api?: OpenClawPluginApi;
  log: LoggerLike;
}): Promise<ManagedWorkspaceArchiveResult[]> {
  params.log.info(
    "baiying-enhance: cold-start workspace archive — comparing auth dig-employee ids with local workspace-baiying-agent-* directories",
  );
  return archiveUnauthorizedActiveManagedWorkspaces({
    pluginConfig: params.pluginConfig,
    authorizedSourceKeys: params.authorizedSourceKeys,
    workspaceArchiveApi: params.workspaceArchiveApi,
    api: params.api,
    checkLabel: "cold-start",
    log: params.log,
  });
}

export async function archiveUnauthorizedActiveManagedWorkspaces(params: {
  pluginConfig: BaiyingEnhancePluginConfig;
  authorizedSourceKeys: Set<string>;
  ignoredSourceKeys?: Set<string>;
  log: LoggerLike;
  checkLabel?: string;
  workspaceArchiveApi?: WorkspaceArchiveApi;
  api?: OpenClawPluginApi;
}): Promise<ManagedWorkspaceArchiveResult[]> {
  const label = params.checkLabel?.trim() || "auth";
  if (params.pluginConfig.workspaceArchiveOnUnauthorized === false) {
    params.log.info(
      `baiying-enhance: ${label} unauthorized workspace archive check skipped (workspaceArchiveOnUnauthorized=false)`,
    );
    return [];
  }

  const stateDir = resolveStateDir();
  const archiveRoot = resolveWorkspaceArchiveRoot(params.pluginConfig);
  const archiveTarget = params.workspaceArchiveApi && useRemoteArchive(params.pluginConfig) ? "remote backend API" : archiveRoot;
  const authorized = new Set([...params.authorizedSourceKeys].map((id) => id.trim()).filter(Boolean));
  const ignored = new Set([...(params.ignoredSourceKeys ?? [])].map((id) => id.trim()).filter(Boolean));
  let activeWorkspaces: ActiveManagedWorkspace[] = [];
  try {
    activeWorkspaces = await listActiveManagedWorkspaces(stateDir, params.api);
  } catch (err) {
    params.log.warn(
      `baiying-enhance: ${label} unauthorized workspace archive check failed to scan ${stateDir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }

  const unauthorized = activeWorkspaces.filter(
    (workspace) => !authorized.has(workspace.sourceKey) && !ignored.has(workspace.sourceKey),
  );
  const ignoredActiveCount = activeWorkspaces.filter((workspace) => ignored.has(workspace.sourceKey)).length;
  params.log.info(
    `baiying-enhance: ${label} unauthorized workspace archive check — stateDir=${stateDir}; archiveTarget=${archiveTarget}; authorized=${authorized.size}; activeManagedWorkspaces=${activeWorkspaces.length}; unauthorizedActiveWorkspaces=${unauthorized.length}; ignoredActiveWorkspaces=${ignoredActiveCount}`,
  );

  if (unauthorized.length === 0) {
    params.log.info(`baiying-enhance: ${label} unauthorized workspace archive check — no migration needed`);
    return [];
  }

  params.log.info(
    `baiying-enhance: ${label} unauthorized workspace archive candidates:\n${unauthorized
      .map((workspace) => `  * ${workspace.agentId} sourceKey=${workspace.sourceKey} active=${workspace.workspaceDir}`)
      .join("\n")}`,
  );

  const results = await archiveUnauthorizedManagedAgentWorkspaces({
    pluginConfig: params.pluginConfig,
    agents: unauthorized,
    workspaceArchiveApi: params.workspaceArchiveApi,
    archiveKind: "cancel_auth",
    log: params.log,
  });
  const archived = results.filter((result) => result.archived);
  const failed = results.filter((result) => !result.archived);
  params.log.info(
    `baiying-enhance: ${label} unauthorized workspace archive check completed — migrated=${archived.length}; failed=${failed.length}${
      archived.length > 0
        ? `\n${archived
            .map(
              (result) =>
                `  * ${result.agentId} ${result.activeDir} -> ${result.archiveDir}${
                  result.rotatedArchiveDir ? ` (rotatedPrevious=${result.rotatedArchiveDir})` : ""
                }`,
            )
            .join("\n")}`
        : ""
    }`,
  );
  if (failed.length > 0) {
    params.log.warn(
      `baiying-enhance: ${label} unauthorized workspace archive failures:\n${failed
        .map((result) => `  * ${result.agentId} ${result.activeDir}: ${result.error ?? "unknown error"}`)
        .join("\n")}`,
    );
  }
  return results;
}
