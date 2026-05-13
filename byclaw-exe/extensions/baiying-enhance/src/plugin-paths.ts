import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Snapshot root shipped with this extension (`.../baiying-enhance/resources/`).
 *
 * - When bundled as `dist/index.js`, snapshots live at `../resources`.
 * - When running sources from `src/*.ts` (tsx/vitest), use `../resources` from `src/`.
 * - Fallback: legacy OpenClaw skills layout (may be empty until sync).
 */
export function resolveBundledBaiyingResourcesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "..", "resources"), path.join(here, "resources")];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) {
        return path.resolve(c);
      }
    } catch {
      /* ignore */
    }
  }
  return path.resolve(path.join(homedir(), ".openclaw", "skills", "baiying", "resources"));
}
