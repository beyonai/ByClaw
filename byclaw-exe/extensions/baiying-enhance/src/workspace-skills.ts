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
    if (!ent.isDirectory()) {
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
    names.push(skillName);
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
