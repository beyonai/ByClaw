import { promises as fs } from "node:fs";
import path from "node:path";

const FILENAME = "main-agents-foreign-takeover.json";

async function readWorkspaceSet(stateDir: string): Promise<Set<string>> {
  const filePath = path.join(stateDir, "baiying-enhance", FILENAME);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const j = JSON.parse(raw) as { workspaces?: unknown };
    if (!Array.isArray(j.workspaces)) {
      return new Set();
    }
    return new Set(
      j.workspaces
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .map((w) => path.resolve(w)),
    );
  } catch {
    return new Set();
  }
}

export async function isMainAgentsForeignTakeoverDone(stateDir: string, workspaceDir: string): Promise<boolean> {
  const resolved = path.resolve(workspaceDir);
  const set = await readWorkspaceSet(stateDir);
  return set.has(resolved);
}

export async function markMainAgentsForeignTakeoverDone(stateDir: string, workspaceDir: string): Promise<void> {
  const resolved = path.resolve(workspaceDir);
  const dir = path.join(stateDir, "baiying-enhance");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, FILENAME);
  const set = await readWorkspaceSet(stateDir);
  set.add(resolved);
  await fs.writeFile(filePath, JSON.stringify({ workspaces: [...set].sort() }, null, 2), "utf8");
}
