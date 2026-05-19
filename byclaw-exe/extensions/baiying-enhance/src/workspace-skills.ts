import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { AgentListEntry } from "./types.js";
import { resolveAgentWorkspaceDir } from "./workspace-seed.js";

const SKILLS_DIR_NAME = "skills";
const SKILL_DOC_FILE_NAME = "SKILL.md";

function normalizeSkillName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function mergeSkillNames(...groups: unknown[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const name = normalizeSkillName(raw);
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function skillSignature(skills: unknown[]): string {
  return mergeSkillNames(skills).join("\u0000");
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function parseSkillFrontmatterName(content: string): string | undefined {
  const text = content.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (line === "---" || line === "...") {
      break;
    }
    const match = /^name\s*:\s*(.*)$/.exec(lines[i] ?? "");
    if (!match) {
      continue;
    }
    const value = unquoteYamlScalar(match[1] ?? "");
    return value || undefined;
  }
  return undefined;
}

async function readSkillName(skillsDir: string, dirName: string): Promise<string> {
  const skillFilePath = path.join(skillsDir, dirName, SKILL_DOC_FILE_NAME);
  try {
    const content = await fs.readFile(skillFilePath, "utf8");
    return parseSkillFrontmatterName(content) ?? dirName;
  } catch {
    return dirName;
  }
}

async function isDirectoryEntry(parentDir: string, ent: Awaited<ReturnType<typeof fs.readdir>>[number]): Promise<boolean> {
  if (ent.isDirectory()) {
    return true;
  }
  if (ent.isFile() || ent.isSymbolicLink()) {
    return false;
  }
  // Some FUSE/rclone mounts report directory entries as DT_UNKNOWN. Fall back to stat
  // so periodic scans still discover uploaded workspace skills on object-store mounts.
  try {
    return (await fs.stat(path.join(parentDir, ent.name))).isDirectory();
  } catch {
    return false;
  }
}

export async function scanWorkspaceSkillNames(workspaceDir: string): Promise<string[]> {
  const skillsDir = path.join(workspaceDir, SKILLS_DIR_NAME);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    if (!(await isDirectoryEntry(skillsDir, ent))) {
      continue;
    }
    const skillName = normalizeSkillName(ent.name);
    if (!skillName) {
      continue;
    }
    try {
      await fs.access(path.join(skillsDir, ent.name, SKILL_DOC_FILE_NAME));
    } catch {
      continue;
    }
    names.push(await readSkillName(skillsDir, skillName));
  }

  return mergeSkillNames(names.sort((a, b) => a.localeCompare(b)));
}

type AgentWithSkills = {
  agentId: string;
  listEntry: AgentListEntry;
};

export async function mergeWorkspaceSkillsIntoManagedAgents<T extends AgentWithSkills>(params: {
  api: OpenClawPluginApi;
  managed: T[];
  includeMainShared: boolean;
  mainParentAgentId: string;
}): Promise<T[]> {
  const sharedSkills = params.includeMainShared
    ? await scanWorkspaceSkillNames(resolveAgentWorkspaceDir(params.api, params.mainParentAgentId))
    : [];

  const out: T[] = [];
  for (const agent of params.managed) {
    const agentSkills = await scanWorkspaceSkillNames(
      resolveAgentWorkspaceDir(params.api, agent.agentId),
    );
    const skills = mergeSkillNames(agent.listEntry.skills ?? [], agentSkills, sharedSkills);
    out.push({
      ...agent,
      listEntry: {
        ...agent.listEntry,
        skills,
      },
    });
  }
  return out;
}

export function watchWorkspaceSkillDirs(params: {
  api: OpenClawPluginApi;
  managed: AgentWithSkills[];
  includeMainShared: boolean;
  mainParentAgentId: string;
  onChange: () => void;
  log: { warn: (m: string) => void };
}): () => void {
  const dirs = new Set<string>();
  if (params.includeMainShared) {
    dirs.add(path.join(resolveAgentWorkspaceDir(params.api, params.mainParentAgentId), SKILLS_DIR_NAME));
  }
  for (const agent of params.managed) {
    dirs.add(path.join(resolveAgentWorkspaceDir(params.api, agent.agentId), SKILLS_DIR_NAME));
  }

  const watchers: FSWatcher[] = [];
  for (const dir of dirs) {
    try {
      watchers.push(
        watch(dir, { persistent: false }, () => {
          params.onChange();
        }),
      );
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
      if (code !== "ENOENT") {
        params.log.warn(
          `baiying-enhance: workspace skill watch failed for ${dir}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return () => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // ignore close failures
      }
    }
  };
}
