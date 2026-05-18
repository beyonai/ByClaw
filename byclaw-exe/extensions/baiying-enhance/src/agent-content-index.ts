import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Bump when the indexed JSON shape changes incompatibly. */
export const INDEX_VERSION = 1;

/**
 * Legacy default filename (next to agent JSON). Kept for tests and explicit overrides.
 * The plugin default is now under state dir — see {@link resolveDefaultContentIndexPath}.
 */
export const DEFAULT_INDEX_FILENAME = ".baiying-enhance-content-index.json";

/**
 * Default writable location for the content index: `~/.openclaw/baiying-enhance/agent-content-index-<id>.json`
 * where `<id>` is the first 16 hex chars of SHA-256(absoluteAgentDir), so different agent dirs do not collide.
 * Kept in the writable state dir rather than any deprecated resource directory.
 */
export function resolveDefaultContentIndexPath(stateDir: string, absoluteAgentDir: string): string {
  const id = createHash("sha256").update(absoluteAgentDir).digest("hex").slice(0, 16);
  return path.join(stateDir, "baiying-enhance", `agent-content-index-${id}.json`);
}

export type AgentContentIndexFile = {
  version: number;
  entries: Record<string, string>;
};

export async function loadAgentContentIndex(
  indexPath: string,
  log?: { warn: (m: string) => void },
): Promise<Map<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch {
    return new Map();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      log?.warn(`baiying-enhance: agent content index invalid (not object): ${indexPath}`);
      return new Map();
    }
    const p = parsed as Partial<AgentContentIndexFile>;
    if (p.version !== INDEX_VERSION) {
      log?.warn(
        `baiying-enhance: agent content index version mismatch (${String(p.version)} vs ${INDEX_VERSION}), ignoring: ${indexPath}`,
      );
      return new Map();
    }
    if (!p.entries || typeof p.entries !== "object") {
      return new Map();
    }
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(p.entries)) {
      if (typeof v === "string" && v.length > 0) {
        m.set(k, v);
      }
    }
    return m;
  } catch {
    log?.warn(`baiying-enhance: agent content index corrupt, ignoring: ${indexPath}`);
    return new Map();
  }
}

/**
 * Atomically replace the index file (write temp in same dir, then rename).
 */
export async function saveAgentContentIndex(
  indexPath: string,
  entries: Map<string, string>,
  log?: { warn: (m: string) => void },
): Promise<void> {
  const dir = path.dirname(indexPath);
  await fs.mkdir(dir, { recursive: true });
  const payload: AgentContentIndexFile = {
    version: INDEX_VERSION,
    entries: Object.fromEntries(entries),
  };
  const base = path.basename(indexPath);
  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}-${base}`);
  const data = `${JSON.stringify(payload)}\n`;
  try {
    await fs.writeFile(tmp, data, "utf8");
    await fs.rename(tmp, indexPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
    log?.warn(
      `baiying-enhance: failed to save agent content index: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
