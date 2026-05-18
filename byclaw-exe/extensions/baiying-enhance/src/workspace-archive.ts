import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { BaiyingEnhancePluginConfig } from "./types.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import { resolveAgentWorkspaceDir } from "./workspace-seed.js";
import { resolveStateDir } from "./workspace-paths.js";

const DEFAULT_WORKSPACE_ARCHIVE_DIR = ".baiying-workspaces";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
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
}): Promise<void> {
  if (params.pluginConfig.workspaceArchiveOnUnauthorized === false) {
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
}): Promise<void> {
  if (params.pluginConfig.workspaceArchiveOnUnauthorized === false) {
    return;
  }
  const archiveRoot = resolveWorkspaceArchiveRoot(params.pluginConfig);
  for (const agent of params.agents) {
    if (!isManagedAgentId(agent.agentId)) {
      continue;
    }
    const activeDir = agent.workspaceDir;
    if (!(await exists(activeDir))) {
      continue;
    }
    const archiveDir = archivePathForAgent({ archiveRoot, activeWorkspaceDir: activeDir });
    try {
      if (await exists(archiveDir)) {
        const rotated = await rotateExistingArchive(archiveDir);
        params.log.info(
          `baiying-enhance: rotated existing workspace archive for ${agent.agentId} from ${archiveDir} to ${rotated}`,
        );
      }
      await movePath(activeDir, archiveDir);
      params.log.info(`baiying-enhance: archived workspace for ${agent.agentId} from ${activeDir} to ${archiveDir}`);
    } catch (err) {
      params.log.warn(
        `baiying-enhance: workspace archive failed for ${agent.agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
