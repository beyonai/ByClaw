import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { AgentListEntry } from "./types.js";
import { resolveAgentWorkspaceDir } from "./workspace-seed.js";
import { resolveStateDir } from "./workspace-paths.js";

const SKILLS_DIR_NAME = "skills";
const PLUGIN_SKILLS_DIR_NAME = "plugin-skills";
const SKILL_DOC_FILE_NAME = "SKILL.md";
// 平台级只读能力由镜像统一提供在 /app/skills，不复制到各数字员工 workspace。
const CORE_BUNDLED_SKILLS = ["project-context", "notice", "project-cloud-knowledge"];

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

type ScannedSkill = {
  dirName: string;
  skillName: string;
};

async function readSkillNameFromSkillFile(skillFilePath: string, dirName: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(skillFilePath, "utf8");
    return parseSkillFrontmatterName(content) ?? dirName;
  } catch {
    return undefined;
  }
}

function skillDirNameFromPath(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const normalized = raw.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  const last = parts[parts.length - 1] ?? "";
  if (last.toLowerCase() === SKILL_DOC_FILE_NAME.toLowerCase()) {
    return normalizeSkillName(parts[parts.length - 2]);
  }
  return normalizeSkillName(last);
}

function skillFilePathFromPath(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const normalized = raw.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "");
  if (
    !normalized.includes(`/${SKILLS_DIR_NAME}/`) &&
    !normalized.includes(`/${PLUGIN_SKILLS_DIR_NAME}/`)
  ) {
    return "";
  }
  const last = normalized.split("/").filter(Boolean).at(-1) ?? "";
  if (last.toLowerCase() === SKILL_DOC_FILE_NAME.toLowerCase()) {
    return normalized;
  }
  return `${normalized}/${SKILL_DOC_FILE_NAME}`;
}

async function readWorkspaceSkillNameByPath(workspaceDir: string, skillPath: unknown): Promise<string> {
  const dirName = skillDirNameFromPath(skillPath);
  if (!dirName) {
    return "";
  }
  const directSkillFilePath = skillFilePathFromPath(skillPath);
  if (directSkillFilePath) {
    const directName = await readSkillNameFromSkillFile(directSkillFilePath, dirName);
    if (directName) {
      return directName;
    }
  }
  const skillsDir = path.join(workspaceDir, SKILLS_DIR_NAME);
  try {
    await fs.access(path.join(skillsDir, dirName, SKILL_DOC_FILE_NAME));
  } catch {
    return dirName;
  }
  return readSkillName(skillsDir, dirName);
}

async function scanWorkspaceSkillNamesByPaths(
  workspaceDir: string,
  skillPaths: unknown[] | undefined,
): Promise<string[]> {
  if (!Array.isArray(skillPaths) || skillPaths.length === 0) {
    return [];
  }
  const names: string[] = [];
  for (const skillPath of skillPaths) {
    const name = await readWorkspaceSkillNameByPath(workspaceDir, skillPath);
    if (name) {
      names.push(name);
    }
  }
  return mergeSkillNames(names);
}

async function scanSkillRoot(skillsDir: string): Promise<ScannedSkill[]> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: ScannedSkill[] = [];
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
    skills.push({ dirName: skillName, skillName: await readSkillName(skillsDir, skillName) });
  }

  return skills.sort((a, b) => a.skillName.localeCompare(b.skillName));
}

function skillNamesFromScanned(skills: ScannedSkill[]): string[] {
  return mergeSkillNames(skills.map((skill) => skill.skillName));
}

export async function scanSkillRootNames(skillsDir: string): Promise<string[]> {
  const directName = await readSkillNameFromSkillFile(
    path.join(skillsDir, SKILL_DOC_FILE_NAME),
    path.basename(skillsDir),
  );
  if (directName) {
    return [directName];
  }
  return skillNamesFromScanned(await scanSkillRoot(skillsDir));
}

export async function scanWorkspaceSkillNames(workspaceDir: string): Promise<string[]> {
  return scanSkillRootNames(path.join(workspaceDir, SKILLS_DIR_NAME));
}

function resolvePluginSkillsDir(): string {
  return path.join(resolveStateDir(), PLUGIN_SKILLS_DIR_NAME);
}

export async function scanPluginSkillNames(): Promise<string[]> {
  return scanSkillRootNames(resolvePluginSkillsDir());
}

function resolveSkillNamesFromPluginRoot(rawSkills: unknown[], pluginSkills: ScannedSkill[]): string[] {
  if (pluginSkills.length === 0) {
    return mergeSkillNames(rawSkills);
  }
  const lookup = new Map<string, string>();
  for (const skill of pluginSkills) {
    lookup.set(skill.dirName, skill.skillName);
    lookup.set(skill.skillName, skill.skillName);
  }
  return mergeSkillNames(rawSkills.map((raw) => lookup.get(normalizeSkillName(raw)) ?? raw));
}

type AgentWithSkills = {
  agentId: string;
  listEntry: AgentListEntry;
  extraSkillPaths?: string[];
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
  const pluginSkills = await scanSkillRoot(resolvePluginSkillsDir());

  const out: T[] = [];
  for (const agent of params.managed) {
    const workspaceDir = resolveAgentWorkspaceDir(params.api, agent.agentId);
    const baseSkills = resolveSkillNamesFromPluginRoot(agent.listEntry.skills ?? [], pluginSkills);
    const extraSkills = await scanWorkspaceSkillNamesByPaths(workspaceDir, agent.extraSkillPaths);
    const agentSkills = await scanWorkspaceSkillNames(workspaceDir);
    const skills = mergeSkillNames(CORE_BUNDLED_SKILLS, baseSkills, extraSkills, agentSkills, sharedSkills);
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
  dirs.add(resolvePluginSkillsDir());
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
