import fs from "node:fs";
import path from "node:path";
import { ENV, PATHS, SKILL_PATHS } from "./constants.js";
import type { ByclawSkillResource, JsonRecord } from "./types.js";

function isVirtualOpenClawPath(value: string): boolean {
  return value === SKILL_PATHS.virtualRoot || value.startsWith(`${SKILL_PATHS.virtualRoot}/`);
}

function withoutUndefined<T extends JsonRecord>(value: T): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safePathPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SKILL_PATHS.safePathPartMaxLength) || SKILL_PATHS.fallbackDirName
  );
}

function defaultStateDir(cwd: string): string {
  const configured = process.env[ENV.openclawStateDir];
  return configured && configured.trim()
    ? path.resolve(configured.trim())
    : path.join(cwd, PATHS.openclawStateDir);
}

function skillDirName(skill: ByclawSkillResource): string {
  return safePathPart(skill.code || skill.name || skill.id);
}

function docPathForSkillDir(skillDir: string): string {
  return path.join(skillDir, PATHS.skillDocFileName);
}

function localPathForVirtualOpenClawPath(params: {
  cwd: string;
  agentId?: string;
  skill: ByclawSkillResource;
  virtualPath: string;
}): string | undefined {
  const normalized = params.virtualPath.replace(/\/+$/g, "");
  const skillsMarker = SKILL_PATHS.skillsMarker;
  const markerIndex = normalized.indexOf(skillsMarker);
  const tail =
    markerIndex >= 0
      ? normalized.slice(markerIndex + skillsMarker.length).replace(/\/SKILL\.md$/iu, "")
      : "";
  const dirName = tail ? tail.split("/").filter(Boolean)[0] : skillDirName(params.skill);
  if (!dirName) {
    return undefined;
  }

  const stateSkillDir = path.join(defaultStateDir(params.cwd), PATHS.skillsDir, dirName);
  if (fs.existsSync(docPathForSkillDir(stateSkillDir))) {
    return stateSkillDir;
  }

  if (params.agentId && normalized.includes(`/workspace-baiying-agent-${params.agentId}/skills/`)) {
    return path.join(
      params.cwd,
      PATHS.openclawDir,
      `workspace-baiying-agent-${params.agentId}`,
      PATHS.skillsDir,
      dirName,
    );
  }

  return path.join(params.cwd, PATHS.openclawDir, PATHS.workspaceDir, PATHS.skillsDir, dirName);
}

function candidateSkillDirs(params: {
  cwd: string;
  agentId?: string;
  skill: ByclawSkillResource;
}): Array<{ dir: string; source: string }> {
  const { cwd, agentId, skill } = params;
  const candidates: Array<{ dir: string; source: string }> = [];
  const rawPath = skill.skillPath?.trim();
  const rawDocPath = skill.skillDocObjectKey?.trim();

  if (rawPath) {
    if (path.isAbsolute(rawPath) && !isVirtualOpenClawPath(rawPath)) {
      candidates.push({ dir: rawPath, source: SKILL_PATHS.skillPathSource });
    } else if (isVirtualOpenClawPath(rawPath)) {
      const local = localPathForVirtualOpenClawPath({ cwd, agentId, skill, virtualPath: rawPath });
      if (local) {
        candidates.push({ dir: local, source: SKILL_PATHS.virtualSkillPathSource });
      }
    } else {
      candidates.push({ dir: path.resolve(cwd, rawPath), source: SKILL_PATHS.relativeSkillPathSource });
    }
  }

  if (rawDocPath) {
    const rawDocDir = rawDocPath.endsWith(`/${PATHS.skillDocFileName}`)
      ? path.dirname(rawDocPath)
      : rawDocPath;
    if (path.isAbsolute(rawDocDir) && !isVirtualOpenClawPath(rawDocDir)) {
      candidates.push({ dir: rawDocDir, source: SKILL_PATHS.skillDocObjectKeySource });
    } else if (isVirtualOpenClawPath(rawDocDir)) {
      const local = localPathForVirtualOpenClawPath({ cwd, agentId, skill, virtualPath: rawDocDir });
      if (local) {
        candidates.push({ dir: local, source: SKILL_PATHS.virtualSkillDocObjectKeySource });
      }
    } else {
      candidates.push({ dir: path.resolve(cwd, rawDocDir), source: SKILL_PATHS.relativeSkillDocObjectKeySource });
    }
  }

  const dirName = skillDirName(skill);
  const stateDir = defaultStateDir(cwd);
  for (const name of [dirName, safePathPart(skill.name), safePathPart(skill.id)]) {
    if (name) {
      candidates.push({ dir: path.join(stateDir, PATHS.skillsDir, name), source: SKILL_PATHS.stateSource });
    }
  }
  if (agentId) {
    candidates.push({
      dir: path.join(cwd, PATHS.openclawDir, `workspace-baiying-agent-${agentId}`, PATHS.skillsDir, dirName),
      source: SKILL_PATHS.agentWorkspaceSource,
    });
  }
  candidates.push({
    dir: path.join(cwd, PATHS.openclawDir, PATHS.workspaceDir, PATHS.skillsDir, dirName),
    source: SKILL_PATHS.workspaceSource,
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const resolved = path.resolve(candidate.dir);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    candidate.dir = resolved;
    return true;
  });
}

export function resolveByclawSkillPaths(params: {
  cwd: string;
  agentId?: string;
  skill: ByclawSkillResource;
}): JsonRecord {
  const candidates = candidateSkillDirs(params);
  const selected =
    candidates.find((candidate) => fs.existsSync(docPathForSkillDir(candidate.dir))) ||
    candidates.find((candidate) => fs.existsSync(candidate.dir)) ||
    candidates[0];
  const skillPath = selected?.dir || path.join(defaultStateDir(params.cwd), PATHS.skillsDir, skillDirName(params.skill));
  const skillDocPath = docPathForSkillDir(skillPath);

  return withoutUndefined({
    skillPath,
    skillDocPath,
    skillDocObjectKey: skillDocPath,
    originalSkillPath: params.skill.skillPath && params.skill.skillPath !== skillPath ? params.skill.skillPath : undefined,
    originalSkillDocObjectKey:
      params.skill.skillDocObjectKey && params.skill.skillDocObjectKey !== skillDocPath
        ? params.skill.skillDocObjectKey
        : undefined,
    pathResolution: {
      source: selected?.source || SKILL_PATHS.stateSource,
      exists: fs.existsSync(skillPath),
      skillDocExists: fs.existsSync(skillDocPath),
    },
  });
}

export function compactByclawSkill(params: {
  cwd: string;
  agentId?: string;
  skill: ByclawSkillResource;
}): JsonRecord {
  return withoutUndefined({
    id: params.skill.id,
    name: params.skill.name,
    code: params.skill.code,
    description: params.skill.description,
    ...resolveByclawSkillPaths(params),
    skillType: params.skill.skillType,
  });
}
